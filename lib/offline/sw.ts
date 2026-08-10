/// <reference lib="webworker" />
import { selectEvictions, RUNTIME_BUDGET_BYTES, type CacheEntry } from './evictions';

declare const self: ServiceWorkerGlobalScope;

/*
 * Audio cache for the Quran reader.
 *
 *   PINNED  — surahs the user explicitly downloaded. Never evicted.
 *   RUNTIME — audio fetched during ordinary playback, capped and evicted
 *             least-recently-used.
 *
 * The runtime cache exists because GitHub release assets carry no
 * cache-control header, so without it every replay re-downloads.
 *
 * Audio files are immutable — a given ayah's bytes never change — so a cache
 * hit is always correct and never needs revalidating.
 */
const PINNED = 'quran-audio-pinned-v1';
const RUNTIME = 'quran-audio-runtime-v1';
const DB_NAME = 'quran-offline';
const STORE = 'runtime-index';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

// ---- IndexedDB (a worker cannot use localStorage) --------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'url' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbAll(): Promise<CacheEntry[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as CacheEntry[]) || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(entry: CacheEntry): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(urls: string[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    urls.forEach(url => store.delete(url));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function enforceBudget(): Promise<void> {
  const entries = await idbAll();
  const victims = selectEvictions(entries, RUNTIME_BUDGET_BYTES);
  if (victims.length === 0) return;
  const cache = await caches.open(RUNTIME);
  await Promise.all(victims.map(url => cache.delete(url)));
  await idbDelete(victims);
}

// ---- Fetch interception ----------------------------------------------------

async function serveAudio(request: Request): Promise<Response> {
  const pinned = await caches.open(PINNED);
  const pinnedHit = await pinned.match(request.url);
  if (pinnedHit) return pinnedHit;

  const runtime = await caches.open(RUNTIME);
  const runtimeHit = await runtime.match(request.url);
  if (runtimeHit) {
    // Touch it so the LRU order reflects real use.
    const size = Number(runtimeHit.headers.get('content-length')) || 0;
    void idbPut({ url: request.url, size, lastUsed: Date.now() }).catch(() => {});
    return runtimeHit;
  }

  const response = await fetch(request);
  if (response.ok) {
    const buf = await response.clone().arrayBuffer();
    await runtime.put(request.url, new Response(buf, { headers: response.headers }));
    await idbPut({ url: request.url, size: buf.byteLength, lastUsed: Date.now() });
    void enforceBudget().catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !url.pathname.endsWith('.mp3')) return;
  event.respondWith(serveAudio(event.request).catch(() => fetch(event.request)));
});

// ---- Download / delete / status --------------------------------------------

async function downloadSurah(surahId: number, urls: string[], client: Client): Promise<void> {
  const cache = await caches.open(PINNED);
  const added: string[] = [];
  let done = 0;
  let bytes = 0;

  for (const url of urls) {
    if (await cache.match(url)) { done += 1; continue; }   // resumable
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const buf = await res.arrayBuffer();
      await cache.put(url, new Response(buf, { headers: res.headers }));
      added.push(url);
      bytes += buf.byteLength;
      done += 1;
    } catch (err) {
      // Roll back so a partial surah is never reported as available offline.
      await Promise.all(added.map(u => cache.delete(u)));
      client.postMessage({
        type: 'failed',
        surahId,
        reason: (err as Error)?.name === 'QuotaExceededError' ? 'quota' : 'network',
      });
      return;
    }
    if (done % 10 === 0 || done === urls.length) {
      client.postMessage({ type: 'progress', surahId, done, total: urls.length, bytes });
    }
  }
  client.postMessage({ type: 'complete', surahId, total: urls.length, bytes });
}

async function deleteSurah(surahId: number, client: Client): Promise<void> {
  const cache = await caches.open(PINNED);
  const keys = await cache.keys();
  const prefix = `/audio-${String(surahId).padStart(3, '0')}/`;
  const victims = keys.filter(req => req.url.includes(prefix));
  await Promise.all(victims.map(req => cache.delete(req)));
  client.postMessage({ type: 'deleted', surahId, removed: victims.length });
}

async function reportStatus(client: Client): Promise<void> {
  const cache = await caches.open(PINNED);
  const keys = await cache.keys();
  const bySurah: Record<number, number> = {};
  for (const req of keys) {
    const match = req.url.match(/\/audio-(\d{3})\//);
    if (!match) continue;
    const id = Number(match[1]);
    bySurah[id] = (bySurah[id] || 0) + 1;
  }
  const estimate = navigator.storage?.estimate
    ? await navigator.storage.estimate()
    : { usage: 0, quota: 0 };
  client.postMessage({
    type: 'status', bySurah, usage: estimate.usage ?? 0, quota: estimate.quota ?? 0,
  });
}

self.addEventListener('message', event => {
  const msg = event.data || {};
  const client = event.source as Client | null;
  if (!client) return;
  if (msg.type === 'download') event.waitUntil(downloadSurah(msg.surahId, msg.urls, client));
  if (msg.type === 'delete') event.waitUntil(deleteSurah(msg.surahId, client));
  if (msg.type === 'status') event.waitUntil(reportStatus(client));
});
