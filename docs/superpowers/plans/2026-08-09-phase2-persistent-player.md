# Phase 2 — Persistent Player, Offline Audio, Resume: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep recitation playing across page navigation, let users download surahs for offline listening, and resume exactly where they left off.

**Architecture:** The player (`AyahPlaylist` + `SyncEngine` + `Timeline`) moves out of the surah page and into a `PlayerProvider` mounted in `app/layout.tsx`, which the App Router keeps alive across client-side navigation. The word registry stays page-owned and attaches to the provider by surah id, so highlights are painted only when the mounted page is the surah that is playing. A service worker caches audio: explicitly downloaded surahs are pinned, and everything else played goes through a 100 MB least-recently-used cache.

**Tech Stack:** Next.js 16 (App Router, `output: 'export'`), React 19, TypeScript, Tailwind v4, Vitest 4 + jsdom, Playwright (already installed), Service Worker + Cache Storage + IndexedDB.

**Spec:** `docs/superpowers/specs/2026-08-09-phase2-persistent-player-design.md`
**Branch:** `phase-2-player`

## Global Constraints

- **`lib/sync/` must not import React.** It is pure TypeScript and is not modified by this plan.
- **Highlights are painted only when the attached registry's surah is the playing surah.** Browsing surah 5 while surah 2 plays must never paint surah 5's words.
- **Audio files are immutable** — a given ayah's bytes never change — so cached audio is never stale.
- **The service worker cannot use `localStorage`.** Its bookkeeping lives in IndexedDB.
- **Runtime cache budget: 100 MB.** Pinned downloads are exempt and are only ever removed by explicit deletion.
- **Audio origin** comes from `NEXT_PUBLIC_AUDIO_BASE_URL`; `resolveAudioUrl` maps `/audio/abdulbasit-murattal/002255.mp3` to `{BASE}/audio-002/002255.mp3`. Filenames are `SSSAAA.mp3`.
- **Static export** (`output: 'export'`): no server routes. `sw.js` is served from `public/`.
- **Do not commit anything under `public/audio/`** — it is gitignored and served from GitHub Releases.
- Existing suite is **111 tests**; none may break.

### Interfaces that already exist and must not change

```ts
// lib/sync/engine.ts
class SyncEngine {
  attach(getTimeMs: () => number, words: WordTiming[]): void;
  setWords(words: WordTiming[]): void;
  onChange(listener: (wordId: string | null) => void): () => void;  // replays last value to late subscribers
  detach(): void;
}

// lib/audio/playlist.ts
class AyahPlaylist {
  constructor(ayahs: AyahTiming[]);
  get currentAyahIndex(): number;
  get isPlaying(): boolean;
  get current(): HTMLAudioElement;
  localTimeMs(): number;
  play(): void; pause(): void;
  seekToAyah(index: number, localMs?: number): void;
  next(): void; prev(): void;
  setVolume(volume: number): void;
  on(event: 'ayahchange'|'state'|'ended'|'error'|'loading'|'duration', cb: Function): () => void;
  destroy(): void;
}

// lib/sync/timeline.ts
class Timeline {
  constructor(ayahs: AyahTiming[]);
  get totalMs(): number;
  globalToLocal(globalMs: number): { ayahIndex: number; localMs: number };
  localToGlobal(ayahIndex: number, localMs: number): number;
  setActualDuration(ayahIndex: number, durationMs: number, playheadAyahIndex: number): void;
}

// lib/reader/wordRegistry.ts
class WordRegistry {
  register(id: string, el: HTMLElement | null): void;
  setActive(id: string | null, estimated: boolean): void;
  clear(): void;
}
```

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/player/lastPosition.ts` | Read/write the saved listening position |
| `lib/player/timingsLoader.ts` | Fetch and memoise a surah's timings at runtime |
| `components/player/PlayerProvider.tsx` | Owns playlist/engine/timeline; exposes state and actions |
| `components/player/usePlayer.ts` | Context hook |
| `components/player/PlayerBar.tsx` | The always-visible player |
| `lib/offline/evictions.ts` | Pure LRU selection — the correctness-critical part |
| `lib/offline/db.ts` | IndexedDB access for the runtime cache index |
| `lib/offline/downloadManager.ts` | Page-side messaging to the service worker |
| `lib/offline/registerServiceWorker.ts` | Registration, guarded for unsupported browsers |
| `public/sw.js` | Fetch interception, pinned + runtime caches, download/delete |
| `app/downloads/page.tsx` | Storage screen |
| `app/surah/[id]/SurahClient.tsx` | Rewritten as a provider consumer |
| `app/layout.tsx` | Mounts `PlayerProvider` and `PlayerBar` |
| `lib/data/loaders.ts` | `getSurahTimings` reads the new `public/timings/` path |

---

## Task 1: Move timings into `public/`

The provider must load timings for a surah whose page is not mounted, so the files need to be fetchable at runtime.

**Files:**
- Move: `data/timings/` → `public/timings/`
- Modify: `lib/data/loaders.ts:37`
- Modify: `scripts/fetch-quran-data.ts` (write path)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing
- Produces: `/timings/abdulbasit-murattal/{id}.json` fetchable over HTTP; `getSurahTimings(id)` unchanged in signature

- [ ] **Step 1: Move the files with git**

```bash
mkdir -p public/timings
git mv data/timings/abdulbasit-murattal public/timings/abdulbasit-murattal
```

- [ ] **Step 2: Point the loader at the new path**

In `lib/data/loaders.ts`, change `getSurahTimings`:

```ts
export function getSurahTimings(id: number): SurahTimings {
  return JSON.parse(
    readFileSync(
      path.join(process.cwd(), 'public', 'timings', 'abdulbasit-murattal', `${id}.json`),
      'utf8',
    ),
  ) as SurahTimings;
}
```

Note `readJson` is hard-coded to the `data/` root, so this function reads the file directly rather than using it. Leave `getSurahText` using `readJson` unchanged.

- [ ] **Step 3: Point the fetch script at the new path**

In `scripts/fetch-quran-data.ts`, the timings output directory currently sits under `DATA`. Add near the other path constants:

```ts
const TIMINGS_DIR = path.join(ROOT, 'public', 'timings', RECITER_SLUG);
```

Replace every `path.join(DATA, 'timings', RECITER_SLUG, ...)` with `path.join(TIMINGS_DIR, ...)`, including the `mkdir` call in `main()`.

- [ ] **Step 4: Verify data integrity survived the move**

Run:

```bash
node -e "
const fs=require('fs'); let bad=0, words=0;
for(let s=1;s<=114;s++){
  const t=JSON.parse(fs.readFileSync('data/text/'+s+'.json','utf8'));
  const m=JSON.parse(fs.readFileSync('public/timings/abdulbasit-murattal/'+s+'.json','utf8'));
  const tw=new Set(t.ayahs.flatMap(a=>a.words.map(w=>w.id)));
  const mw=new Set(m.ayahs.flatMap(a=>a.words.map(w=>w.id)));
  words+=tw.size;
  if(tw.size!==mw.size||![...tw].every(x=>mw.has(x))) bad++;
}
console.log('words:',words,'mismatches:',bad);
"
```

Expected exactly: `words: 77429 mismatches: 0`

- [ ] **Step 5: Verify the build and suite**

Run: `npx vitest run` — expect 111 passing.
Run: `npm run build` — expect success.
Run: `ls out/timings/abdulbasit-murattal/1.json` — the file must be in the export, since the client fetches it.

- [ ] **Step 6: Commit**

```bash
git add -A data public/timings lib/data/loaders.ts scripts/fetch-quran-data.ts
git commit -m "refactor: serve timings from public/ so the client can fetch them"
```

---

## Task 2: Saved listening position

**Files:**
- Create: `lib/player/lastPosition.ts`
- Test: `lib/player/__tests__/lastPosition.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface LastPosition { surahId: number; ayah: number; localMs: number; updatedAt: number }`
  - `readLastPosition(): LastPosition | null`
  - `writeLastPosition(pos: Omit<LastPosition, 'updatedAt'>): void`
  - `clearLastPosition(): void`

- [ ] **Step 1: Write the failing test**

Create `lib/player/__tests__/lastPosition.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { readLastPosition, writeLastPosition, clearLastPosition } from '../lastPosition';

const KEY = 'quran.lastPosition';

describe('lastPosition', () => {
  beforeEach(() => localStorage.clear());

  it('returns null when nothing is stored', () => {
    expect(readLastPosition()).toBeNull();
  });

  it('round-trips a position', () => {
    writeLastPosition({ surahId: 2, ayah: 45, localMs: 1500 });
    const got = readLastPosition();
    expect(got?.surahId).toBe(2);
    expect(got?.ayah).toBe(45);
    expect(got?.localMs).toBe(1500);
  });

  it('stamps updatedAt', () => {
    writeLastPosition({ surahId: 1, ayah: 1, localMs: 0 });
    expect(readLastPosition()!.updatedAt).toBeGreaterThan(0);
  });

  // A corrupt entry must never break the page that reads it.
  it('returns null for malformed JSON', () => {
    localStorage.setItem(KEY, 'not json{');
    expect(readLastPosition()).toBeNull();
  });

  it('returns null when fields are missing or the wrong type', () => {
    localStorage.setItem(KEY, JSON.stringify({ surahId: 'two', ayah: 1, localMs: 0 }));
    expect(readLastPosition()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ ayah: 1, localMs: 0 }));
    expect(readLastPosition()).toBeNull();
  });

  it('rejects out-of-range surah ids', () => {
    localStorage.setItem(KEY, JSON.stringify({ surahId: 0, ayah: 1, localMs: 0, updatedAt: 1 }));
    expect(readLastPosition()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ surahId: 115, ayah: 1, localMs: 0, updatedAt: 1 }));
    expect(readLastPosition()).toBeNull();
  });

  it('rejects a non-positive ayah', () => {
    localStorage.setItem(KEY, JSON.stringify({ surahId: 1, ayah: 0, localMs: 0, updatedAt: 1 }));
    expect(readLastPosition()).toBeNull();
  });

  it('clears', () => {
    writeLastPosition({ surahId: 3, ayah: 7, localMs: 10 });
    clearLastPosition();
    expect(readLastPosition()).toBeNull();
  });

  it('survives localStorage throwing', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => writeLastPosition({ surahId: 1, ayah: 1, localMs: 0 })).not.toThrow();
    spy.mockRestore();
  });
});
```

Add `import { vi } from 'vitest';` to the import line.

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run lib/player/__tests__/lastPosition.test.ts`
Expected: FAIL — cannot resolve `../lastPosition`.

- [ ] **Step 3: Implement**

Create `lib/player/lastPosition.ts`:

```ts
const KEY = 'quran.lastPosition';

export interface LastPosition {
  surahId: number;
  ayah: number;
  localMs: number;
  updatedAt: number;
}

function isValid(value: unknown): value is LastPosition {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.surahId === 'number' && v.surahId >= 1 && v.surahId <= 114 &&
    typeof v.ayah === 'number' && v.ayah >= 1 &&
    typeof v.localMs === 'number' && v.localMs >= 0 &&
    typeof v.updatedAt === 'number'
  );
}

/**
 * Never throws. A corrupt or absent entry reads as "no saved position" — the
 * home page must not break because of leftover storage from an older version.
 */
export function readLastPosition(): LastPosition | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeLastPosition(pos: Omit<LastPosition, 'updatedAt'>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...pos, updatedAt: Date.now() }));
  } catch {
    // Storage full or blocked (private browsing). Losing the bookmark is
    // acceptable; breaking playback is not.
  }
}

export function clearLastPosition(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run lib/player/__tests__/lastPosition.test.ts`
Expected: 9 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/player
git commit -m "feat: persist and restore the last listening position"
```

---

## Task 3: Runtime timings loader

**Files:**
- Create: `lib/player/timingsLoader.ts`
- Test: `lib/player/__tests__/timingsLoader.test.ts`

**Interfaces:**
- Consumes: `SurahTimings` from `@/lib/data/types`
- Produces:
  - `loadTimings(surahId: number): Promise<SurahTimings>`
  - `primeTimings(surahId: number, timings: SurahTimings): void`
  - `resetTimingsCache(): void` — test-only helper

- [ ] **Step 1: Write the failing test**

Create `lib/player/__tests__/timingsLoader.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { loadTimings, primeTimings, resetTimingsCache } from '../timingsLoader';
import type { SurahTimings } from '@/lib/data/types';

const fake = (surah: number): SurahTimings => ({
  surah, reciterId: 'abdulbasit-murattal', surahDurationMs: 1000,
  ayahs: [{ ayah: 1, audioUrl: '/audio/abdulbasit-murattal/001001.mp3', startOffsetMs: 0, durationMs: 1000, words: [] }],
});

describe('timingsLoader', () => {
  beforeEach(() => { resetTimingsCache(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('fetches a surah and returns its timings', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => fake(2) });
    vi.stubGlobal('fetch', fetchMock);

    const got = await loadTimings(2);
    expect(got.surah).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith('/timings/abdulbasit-murattal/2.json');
  });

  it('memoises so a second load makes no request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => fake(2) });
    vi.stubGlobal('fetch', fetchMock);

    await loadTimings(2);
    await loadTimings(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Two callers racing must share one request, not fire two.
  it('dedupes concurrent loads of the same surah', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => fake(3) });
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([loadTimings(3), loadTimings(3)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('primed timings are returned without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    primeTimings(5, fake(5));
    const got = await loadTimings(5);
    expect(got.surah).toBe(5);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects on a failed response and does not cache the failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, json: async () => fake(9) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadTimings(9)).rejects.toThrow();
    await expect(loadTimings(9)).resolves.toMatchObject({ surah: 9 });
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run lib/player/__tests__/timingsLoader.test.ts`
Expected: FAIL — cannot resolve `../timingsLoader`.

- [ ] **Step 3: Implement**

Create `lib/player/timingsLoader.ts`:

```ts
import type { SurahTimings } from '@/lib/data/types';

const RECITER = 'abdulbasit-murattal';

const cache = new Map<number, SurahTimings>();
const inFlight = new Map<number, Promise<SurahTimings>>();

/**
 * A surah page already has its timings from the server render. Handing them
 * over avoids a redundant fetch when the user presses play on that page.
 */
export function primeTimings(surahId: number, timings: SurahTimings): void {
  cache.set(surahId, timings);
}

export function loadTimings(surahId: number): Promise<SurahTimings> {
  const cached = cache.get(surahId);
  if (cached) return Promise.resolve(cached);

  // Share one request between concurrent callers.
  const existing = inFlight.get(surahId);
  if (existing) return existing;

  const request = fetch(`/timings/${RECITER}/${surahId}.json`)
    .then(res => {
      if (!res.ok) throw new Error(`timings ${res.status} for surah ${surahId}`);
      return res.json() as Promise<SurahTimings>;
    })
    .then(timings => {
      cache.set(surahId, timings);
      return timings;
    })
    .finally(() => {
      // A failure must not be cached — the next attempt should retry.
      inFlight.delete(surahId);
    });

  inFlight.set(surahId, request);
  return request;
}

/** Test-only: drops all memoised state. */
export function resetTimingsCache(): void {
  cache.clear();
  inFlight.clear();
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run lib/player/__tests__/timingsLoader.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/player/timingsLoader.ts lib/player/__tests__/timingsLoader.test.ts
git commit -m "feat: fetch and memoise surah timings at runtime"
```

---

## Task 4: LRU eviction selection

The correctness-critical half of the runtime cache, kept pure so it needs no browser.

**Files:**
- Create: `lib/offline/evictions.ts`
- Test: `lib/offline/__tests__/evictions.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface CacheEntry { url: string; size: number; lastUsed: number }`
  - `selectEvictions(entries: CacheEntry[], budgetBytes: number): string[]`
  - `RUNTIME_BUDGET_BYTES = 100 * 1024 * 1024`

- [ ] **Step 1: Write the failing test**

Create `lib/offline/__tests__/evictions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { selectEvictions, RUNTIME_BUDGET_BYTES } from '../evictions';

const e = (url: string, size: number, lastUsed: number) => ({ url, size, lastUsed });

describe('selectEvictions', () => {
  it('evicts nothing when under budget', () => {
    expect(selectEvictions([e('a', 10, 1), e('b', 10, 2)], 100)).toEqual([]);
  });

  it('evicts nothing when exactly at budget', () => {
    expect(selectEvictions([e('a', 50, 1), e('b', 50, 2)], 100)).toEqual([]);
  });

  it('evicts the least recently used first', () => {
    const entries = [e('new', 60, 300), e('old', 60, 100), e('mid', 60, 200)];
    expect(selectEvictions(entries, 100)).toEqual(['old', 'mid']);
  });

  it('stops as soon as it is back under budget', () => {
    const entries = [e('old', 80, 100), e('new', 10, 200)];
    // Removing 'old' alone brings 90 down to 10.
    expect(selectEvictions(entries, 50)).toEqual(['old']);
  });

  it('handles an empty cache', () => {
    expect(selectEvictions([], 100)).toEqual([]);
  });

  it('evicts everything when a single entry still exceeds the budget', () => {
    expect(selectEvictions([e('huge', 500, 1)], 100)).toEqual(['huge']);
  });

  it('breaks lastUsed ties deterministically by url', () => {
    const entries = [e('b', 60, 100), e('a', 60, 100)];
    expect(selectEvictions(entries, 60)).toEqual(['a']);
  });

  it('exposes a 100 MB budget', () => {
    expect(RUNTIME_BUDGET_BYTES).toBe(104857600);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run lib/offline/__tests__/evictions.test.ts`
Expected: FAIL — cannot resolve `../evictions`.

- [ ] **Step 3: Implement**

Create `lib/offline/evictions.ts`:

```ts
export interface CacheEntry {
  url: string;
  size: number;
  lastUsed: number;
}

/** Runtime cache budget. Pinned downloads are exempt from this. */
export const RUNTIME_BUDGET_BYTES = 100 * 1024 * 1024;

/**
 * Chooses which cached audio files to drop so the runtime cache fits its
 * budget, least-recently-used first.
 *
 * Pure by design: this is the part that has to be right, and keeping it free
 * of Cache Storage and IndexedDB means it can be tested exhaustively without
 * a browser.
 */
export function selectEvictions(entries: CacheEntry[], budgetBytes: number): string[] {
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (total <= budgetBytes) return [];

  // Oldest first; url breaks ties so the result is deterministic.
  const ordered = [...entries].sort(
    (a, b) => a.lastUsed - b.lastUsed || a.url.localeCompare(b.url),
  );

  const victims: string[] = [];
  let remaining = total;
  for (const entry of ordered) {
    if (remaining <= budgetBytes) break;
    victims.push(entry.url);
    remaining -= entry.size;
  }
  return victims;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run lib/offline/__tests__/evictions.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/offline
git commit -m "feat: add pure LRU eviction selection for the runtime audio cache"
```

---

## Task 5: The service worker

**Files:**
- Create: `public/sw.js`
- Create: `lib/offline/registerServiceWorker.ts`
- Test: `lib/offline/__tests__/registerServiceWorker.test.ts`

**Interfaces:**
- Consumes: eviction logic is duplicated in plain JS inside `sw.js` (see note below)
- Produces:
  - `registerServiceWorker(): Promise<ServiceWorkerRegistration | null>`
  - Message protocol: page sends `{type:'download'|'delete'|'status', surahId?, urls?}`; worker replies `{type:'progress'|'complete'|'failed'|'status', ...}`

**Note on duplication:** `sw.js` is plain JavaScript loaded outside the bundler, so it cannot import from `lib/`. The eviction rule is therefore expressed twice: once in `lib/offline/evictions.ts` (tested) and once inline in `sw.js`. Keep the inline copy a faithful transcription and reference the tested module in a comment — this is deliberate, not an oversight.

- [ ] **Step 1: Write the service worker**

Create `public/sw.js`:

```js
/*
 * Audio cache for the Quran reader.
 *
 * Two caches:
 *   PINNED  — surahs the user explicitly downloaded. Never evicted.
 *   RUNTIME — audio fetched during ordinary playback, capped at 100 MB and
 *             evicted least-recently-used.
 *
 * The runtime cache exists because GitHub release assets carry no
 * cache-control header, so without it every replay re-downloads.
 *
 * Audio files are immutable — a given ayah's bytes never change — so a cache
 * hit is always correct and never needs revalidating.
 *
 * The eviction rule mirrors lib/offline/evictions.ts, which is unit-tested.
 * This file cannot import it: a service worker runs outside the bundler.
 */
const PINNED = 'quran-audio-pinned-v1';
const RUNTIME = 'quran-audio-runtime-v1';
const RUNTIME_BUDGET_BYTES = 100 * 1024 * 1024;

const DB_NAME = 'quran-offline';
const STORE = 'runtime-index';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

// ---- IndexedDB helpers (the worker cannot use localStorage) ----------------

function openDb() {
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

async function idbAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(entry) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(urls) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    urls.forEach(url => store.delete(url));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---- Eviction (mirrors lib/offline/evictions.ts) ---------------------------

function selectEvictions(entries, budgetBytes) {
  const total = entries.reduce((sum, e) => sum + e.size, 0);
  if (total <= budgetBytes) return [];
  const ordered = [...entries].sort(
    (a, b) => a.lastUsed - b.lastUsed || a.url.localeCompare(b.url),
  );
  const victims = [];
  let remaining = total;
  for (const entry of ordered) {
    if (remaining <= budgetBytes) break;
    victims.push(entry.url);
    remaining -= entry.size;
  }
  return victims;
}

async function enforceBudget() {
  const entries = await idbAll();
  const victims = selectEvictions(entries, RUNTIME_BUDGET_BYTES);
  if (victims.length === 0) return;
  const cache = await caches.open(RUNTIME);
  await Promise.all(victims.map(url => cache.delete(url)));
  await idbDelete(victims);
}

// ---- Fetch interception ----------------------------------------------------

const isAudio = url => url.pathname.endsWith('.mp3');

async function serveAudio(request) {
  const pinned = await caches.open(PINNED);
  const pinnedHit = await pinned.match(request.url);
  if (pinnedHit) return pinnedHit;

  const runtime = await caches.open(RUNTIME);
  const runtimeHit = await runtime.match(request.url);
  if (runtimeHit) {
    // Touch it so the LRU order reflects real use.
    const size = Number(runtimeHit.headers.get('content-length')) || 0;
    idbPut({ url: request.url, size, lastUsed: Date.now() }).catch(() => {});
    return runtimeHit;
  }

  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    const buf = await copy.arrayBuffer();
    await runtime.put(request.url, new Response(buf, { headers: response.headers }));
    await idbPut({ url: request.url, size: buf.byteLength, lastUsed: Date.now() });
    enforceBudget().catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !isAudio(url)) return;
  event.respondWith(serveAudio(event.request).catch(() => fetch(event.request)));
});

// ---- Download / delete / status --------------------------------------------

async function downloadSurah(surahId, urls, client) {
  const cache = await caches.open(PINNED);
  let done = 0;
  let bytes = 0;
  const added = [];

  for (const url of urls) {
    if (await cache.match(url)) { done += 1; continue; }   // resumable
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      const buf = await res.arrayBuffer();
      await cache.put(url, new Response(buf, { headers: res.headers }));
      added.push(url);
      bytes += buf.byteLength;
      done += 1;
    } catch (err) {
      // Roll back this download so a partial surah is never reported as
      // available offline.
      await Promise.all(added.map(u => cache.delete(u)));
      client.postMessage({
        type: 'failed', surahId,
        reason: String(err && err.name === 'QuotaExceededError' ? 'quota' : 'network'),
      });
      return;
    }
    if (done % 10 === 0 || done === urls.length) {
      client.postMessage({ type: 'progress', surahId, done, total: urls.length, bytes });
    }
  }
  client.postMessage({ type: 'complete', surahId, total: urls.length, bytes });
}

async function deleteSurah(surahId, client) {
  const cache = await caches.open(PINNED);
  const keys = await cache.keys();
  const prefix = `/audio-${String(surahId).padStart(3, '0')}/`;
  const victims = keys.filter(req => req.url.includes(prefix));
  await Promise.all(victims.map(req => cache.delete(req)));
  client.postMessage({ type: 'deleted', surahId, removed: victims.length });
}

async function reportStatus(client) {
  const cache = await caches.open(PINNED);
  const keys = await cache.keys();
  const bySurah = {};
  for (const req of keys) {
    const match = req.url.match(/\/audio-(\d{3})\//);
    if (!match) continue;
    const id = Number(match[1]);
    bySurah[id] = (bySurah[id] || 0) + 1;
  }
  const estimate = navigator.storage && navigator.storage.estimate
    ? await navigator.storage.estimate()
    : { usage: 0, quota: 0 };
  client.postMessage({ type: 'status', bySurah, usage: estimate.usage, quota: estimate.quota });
}

self.addEventListener('message', event => {
  const msg = event.data || {};
  const client = event.source;
  if (!client) return;
  if (msg.type === 'download') event.waitUntil(downloadSurah(msg.surahId, msg.urls, client));
  if (msg.type === 'delete') event.waitUntil(deleteSurah(msg.surahId, client));
  if (msg.type === 'status') event.waitUntil(reportStatus(client));
});
```

- [ ] **Step 2: Write the failing registration test**

Create `lib/offline/__tests__/registerServiceWorker.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerServiceWorker } from '../registerServiceWorker';

afterEach(() => { vi.unstubAllGlobals(); });

describe('registerServiceWorker', () => {
  it('returns null when service workers are unsupported', async () => {
    vi.stubGlobal('navigator', {});
    expect(await registerServiceWorker()).toBeNull();
  });

  it('registers sw.js at the root scope', async () => {
    const register = vi.fn().mockResolvedValue({ scope: '/' });
    vi.stubGlobal('navigator', { serviceWorker: { register } });

    const reg = await registerServiceWorker();
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(reg).toEqual({ scope: '/' });
  });

  // A blocked worker (private browsing, insecure context) must degrade to
  // "no caching", never crash the app.
  it('returns null when registration rejects', async () => {
    const register = vi.fn().mockRejectedValue(new Error('blocked'));
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    expect(await registerServiceWorker()).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to see it fail**

Run: `npx vitest run lib/offline/__tests__/registerServiceWorker.test.ts`
Expected: FAIL — cannot resolve `../registerServiceWorker`.

- [ ] **Step 4: Implement registration**

Create `lib/offline/registerServiceWorker.ts`:

```ts
/**
 * Registers the audio cache worker. Returns null rather than throwing when
 * service workers are unavailable — private browsing, an insecure context, or
 * a browser that does not support them. The app works without caching; it must
 * not fail to load because of it.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `npx vitest run lib/offline/__tests__/registerServiceWorker.test.ts`
Expected: 3 passing.

- [ ] **Step 6: Commit**

```bash
git add public/sw.js lib/offline/registerServiceWorker.ts lib/offline/__tests__/registerServiceWorker.test.ts
git commit -m "feat: add audio caching service worker with pinned and LRU caches"
```

---

## Task 6: Download manager

**Files:**
- Create: `lib/offline/downloadManager.ts`
- Test: `lib/offline/__tests__/downloadManager.test.ts`

**Interfaces:**
- Consumes: `loadTimings` from Task 3, `resolveAudioUrl` from `@/lib/data/audioUrl`
- Produces:
  - `interface OfflineStatus { bySurah: Record<number, number>; usage: number; quota: number }`
  - `downloadSurah(surahId: number, onProgress?: (done: number, total: number) => void): Promise<void>`
  - `deleteSurah(surahId: number): Promise<void>`
  - `getStatus(): Promise<OfflineStatus>`
  - `isOfflineSupported(): boolean`

- [ ] **Step 1: Write the failing test**

Create `lib/offline/__tests__/downloadManager.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadSurah, deleteSurah, getStatus, isOfflineSupported } from '../downloadManager';
import { primeTimings, resetTimingsCache } from '@/lib/player/timingsLoader';
import type { SurahTimings } from '@/lib/data/types';

const timings = (surah: number, n: number): SurahTimings => ({
  surah, reciterId: 'abdulbasit-murattal', surahDurationMs: n * 1000,
  ayahs: Array.from({ length: n }, (_, i) => ({
    ayah: i + 1,
    audioUrl: `/audio/abdulbasit-murattal/${String(surah).padStart(3,'0')}${String(i+1).padStart(3,'0')}.mp3`,
    startOffsetMs: i * 1000, durationMs: 1000, words: [],
  })),
});

/** Stands in for the worker: records what was posted, replies on demand. */
function mockWorker() {
  const posted: any[] = [];
  const listeners: ((e: MessageEvent) => void)[] = [];
  vi.stubGlobal('navigator', {
    serviceWorker: {
      controller: { postMessage: (m: any) => posted.push(m) },
      addEventListener: (_: string, cb: any) => listeners.push(cb),
      removeEventListener: (_: string, cb: any) => {
        const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1);
      },
    },
  });
  return {
    posted,
    reply: (data: any) => listeners.forEach(cb => cb({ data } as MessageEvent)),
  };
}

beforeEach(() => { resetTimingsCache(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('downloadManager', () => {
  it('reports offline unsupported without a controller', () => {
    vi.stubGlobal('navigator', {});
    expect(isOfflineSupported()).toBe(false);
  });

  it('sends every ayah url for the surah', async () => {
    const w = mockWorker();
    primeTimings(114, timings(114, 6));

    const promise = downloadSurah(114);
    await vi.waitFor(() => expect(w.posted.length).toBe(1));

    expect(w.posted[0].type).toBe('download');
    expect(w.posted[0].surahId).toBe(114);
    expect(w.posted[0].urls).toHaveLength(6);
    // Urls must be resolved to the real audio origin, not the stored path.
    expect(w.posted[0].urls[0]).toContain('114001.mp3');

    w.reply({ type: 'complete', surahId: 114, total: 6, bytes: 100 });
    await expect(promise).resolves.toBeUndefined();
  });

  it('surfaces progress', async () => {
    const w = mockWorker();
    primeTimings(114, timings(114, 6));
    const onProgress = vi.fn();

    const promise = downloadSurah(114, onProgress);
    await vi.waitFor(() => expect(w.posted.length).toBe(1));

    w.reply({ type: 'progress', surahId: 114, done: 3, total: 6, bytes: 50 });
    expect(onProgress).toHaveBeenCalledWith(3, 6);

    w.reply({ type: 'complete', surahId: 114, total: 6, bytes: 100 });
    await promise;
  });

  it('rejects with a quota message when storage runs out', async () => {
    const w = mockWorker();
    primeTimings(2, timings(2, 3));

    const promise = downloadSurah(2);
    await vi.waitFor(() => expect(w.posted.length).toBe(1));
    w.reply({ type: 'failed', surahId: 2, reason: 'quota' });

    await expect(promise).rejects.toThrow(/storage/i);
  });

  it('ignores messages about other surahs', async () => {
    const w = mockWorker();
    primeTimings(114, timings(114, 6));
    const onProgress = vi.fn();

    const promise = downloadSurah(114, onProgress);
    await vi.waitFor(() => expect(w.posted.length).toBe(1));

    w.reply({ type: 'progress', surahId: 2, done: 99, total: 99, bytes: 0 });
    expect(onProgress).not.toHaveBeenCalled();

    w.reply({ type: 'complete', surahId: 114, total: 6, bytes: 1 });
    await promise;
  });

  it('deletes a surah', async () => {
    const w = mockWorker();
    const promise = deleteSurah(5);
    await vi.waitFor(() => expect(w.posted.length).toBe(1));
    expect(w.posted[0]).toMatchObject({ type: 'delete', surahId: 5 });
    w.reply({ type: 'deleted', surahId: 5, removed: 3 });
    await expect(promise).resolves.toBeUndefined();
  });

  it('reads status', async () => {
    const w = mockWorker();
    const promise = getStatus();
    await vi.waitFor(() => expect(w.posted.length).toBe(1));
    w.reply({ type: 'status', bySurah: { 1: 7 }, usage: 1000, quota: 5000 });
    await expect(promise).resolves.toEqual({ bySurah: { 1: 7 }, usage: 1000, quota: 5000 });
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run lib/offline/__tests__/downloadManager.test.ts`
Expected: FAIL — cannot resolve `../downloadManager`.

- [ ] **Step 3: Implement**

Create `lib/offline/downloadManager.ts`:

```ts
import { loadTimings } from '@/lib/player/timingsLoader';
import { resolveAudioUrl } from '@/lib/data/audioUrl';

export interface OfflineStatus {
  /** surah id -> number of ayah files stored */
  bySurah: Record<number, number>;
  usage: number;
  quota: number;
}

export function isOfflineSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    !!navigator.serviceWorker.controller
  );
}

function controller(): ServiceWorker {
  const sw = navigator.serviceWorker?.controller;
  if (!sw) throw new Error('Offline storage is unavailable in this browser.');
  return sw;
}

/**
 * Sends one request to the worker and resolves when it answers about THIS
 * surah. Messages about other surahs are ignored, so two downloads running at
 * once cannot resolve each other's promises.
 */
function request<T>(
  message: Record<string, unknown>,
  isDone: (data: any) => boolean,
  onMessage?: (data: any) => void,
  extract?: (data: any) => T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handler = (event: MessageEvent) => {
      const data = event.data || {};
      onMessage?.(data);
      if (data.type === 'failed' && data.surahId === message.surahId) {
        navigator.serviceWorker.removeEventListener('message', handler);
        reject(new Error(
          data.reason === 'quota'
            ? 'Not enough storage to download this surah. Free space by deleting other downloads.'
            : 'Download failed. Check your connection and try again.',
        ));
        return;
      }
      if (isDone(data)) {
        navigator.serviceWorker.removeEventListener('message', handler);
        resolve(extract ? extract(data) : (undefined as T));
      }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    controller().postMessage(message);
  });
}

export async function downloadSurah(
  surahId: number,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const timings = await loadTimings(surahId);
  const urls = timings.ayahs.map(a => resolveAudioUrl(a.audioUrl));

  return request<void>(
    { type: 'download', surahId, urls },
    data => data.type === 'complete' && data.surahId === surahId,
    data => {
      if (data.type === 'progress' && data.surahId === surahId) {
        onProgress?.(data.done, data.total);
      }
    },
  );
}

export function deleteSurah(surahId: number): Promise<void> {
  return request<void>(
    { type: 'delete', surahId },
    data => data.type === 'deleted' && data.surahId === surahId,
  );
}

export function getStatus(): Promise<OfflineStatus> {
  return request<OfflineStatus>(
    { type: 'status' },
    data => data.type === 'status',
    undefined,
    data => ({ bySurah: data.bySurah ?? {}, usage: data.usage ?? 0, quota: data.quota ?? 0 }),
  );
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run lib/offline/__tests__/downloadManager.test.ts`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/offline/downloadManager.ts lib/offline/__tests__/downloadManager.test.ts
git commit -m "feat: add offline download manager over the service worker"
```

---

## Task 7: PlayerProvider

The heart of this plan.

**Files:**
- Create: `components/player/PlayerProvider.tsx`, `components/player/usePlayer.ts`
- Test: `components/player/__tests__/PlayerProvider.test.tsx`

**Interfaces:**
- Consumes: `AyahPlaylist`, `SyncEngine`, `Timeline`, `WordRegistry`, `loadTimings`, `primeTimings`, `readLastPosition`, `writeLastPosition`
- Produces: `PlayerProvider`, `usePlayer(): PlayerState & PlayerActions` (shapes exactly as in the Global Constraints of the spec)

- [ ] **Step 1: Write the failing test**

Create `components/player/__tests__/PlayerProvider.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { PlayerProvider } from '../PlayerProvider';
import { usePlayer } from '../usePlayer';
import { primeTimings, resetTimingsCache } from '@/lib/player/timingsLoader';
import { WordRegistry } from '@/lib/reader/wordRegistry';
import type { SurahTimings } from '@/lib/data/types';

const timings = (surah: number): SurahTimings => ({
  surah, reciterId: 'abdulbasit-murattal', surahDurationMs: 4000,
  ayahs: [
    { ayah: 1, audioUrl: `/audio/abdulbasit-murattal/${String(surah).padStart(3,'0')}001.mp3`,
      startOffsetMs: 0, durationMs: 4000,
      words: [
        { id: `${surah}:1:1`, position: 1, startMs: 600, endMs: 970, estimated: false },
        { id: `${surah}:1:2`, position: 2, startMs: 980, endMs: 1560, estimated: true },
      ] },
  ],
});

function Probe() {
  const p = usePlayer();
  return (
    <div>
      <span data-testid="surah">{p.surahId ?? 'none'}</span>
      <span data-testid="playing">{String(p.isPlaying)}</span>
      <span data-testid="loading">{String(p.isLoading)}</span>
      <button onClick={() => p.playSurah(2)}>play2</button>
      <button onClick={() => p.toggle()}>toggle</button>
    </div>
  );
}

beforeEach(() => {
  resetTimingsCache();
  localStorage.clear();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

const setup = () => render(<PlayerProvider><Probe /></PlayerProvider>);

describe('PlayerProvider', () => {
  it('starts with nothing playing', () => {
    setup();
    expect(screen.getByTestId('surah').textContent).toBe('none');
    expect(screen.getByTestId('playing').textContent).toBe('false');
  });

  it('loads a surah and begins playing', async () => {
    primeTimings(2, timings(2));
    setup();
    await act(async () => { screen.getByText('play2').click(); });
    await waitFor(() => expect(screen.getByTestId('surah').textContent).toBe('2'));
  });

  // The loading state must not clear until audio actually produces sound —
  // otherwise the button says "Pause" while nothing is playing, which is what
  // made highlighting look broken in Phase 1.
  it('stays loading until the audio element reports playing', async () => {
    primeTimings(2, timings(2));
    setup();
    await act(async () => { screen.getByText('play2').click(); });
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('true'));
  });

  it('writes the last position when the surah changes', async () => {
    primeTimings(2, timings(2));
    setup();
    await act(async () => { screen.getByText('play2').click(); });
    await waitFor(() => {
      const raw = localStorage.getItem('quran.lastPosition');
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw!).surahId).toBe(2);
    });
  });
});

describe('registry attachment', () => {
  function AttachProbe({ surahId, registry }: { surahId: number; registry: WordRegistry }) {
    const p = usePlayer();
    return <button onClick={() => p.attachRegistry(surahId, registry)}>attach</button>;
  }

  it('paints only when the attached surah is the playing surah', async () => {
    primeTimings(2, timings(2));
    const wrong = new WordRegistry();
    const spy = vi.spyOn(wrong, 'setActive');

    render(
      <PlayerProvider>
        <Probe />
        <AttachProbe surahId={5} registry={wrong} />
      </PlayerProvider>,
    );

    await act(async () => { screen.getByText('attach').click(); });
    await act(async () => { screen.getByText('play2').click(); });

    // Surah 5's registry must never be touched while surah 2 plays.
    await waitFor(() => expect(screen.getByTestId('surah').textContent).toBe('2'));
    expect(spy).not.toHaveBeenCalledWith(expect.stringMatching(/^2:/), expect.anything());
  });

  it('detaching leaves playback running', async () => {
    primeTimings(2, timings(2));
    const registry = new WordRegistry();
    let detach: (() => void) | undefined;

    function Attach() {
      const p = usePlayer();
      return <button onClick={() => { detach = p.attachRegistry(2, registry); }}>attach</button>;
    }

    render(<PlayerProvider><Probe /><Attach /></PlayerProvider>);
    await act(async () => { screen.getByText('play2').click(); });
    await act(async () => { screen.getByText('attach').click(); });
    await act(async () => { detach?.(); });

    expect(screen.getByTestId('surah').textContent).toBe('2');
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run components/player/__tests__/PlayerProvider.test.tsx`
Expected: FAIL — cannot resolve `../PlayerProvider`.

- [ ] **Step 3: Implement the context hook**

Create `components/player/usePlayer.ts`:

```ts
'use client';

import { createContext, useContext } from 'react';
import type { SurahTimings } from '@/lib/data/types';
import type { WordRegistry } from '@/lib/reader/wordRegistry';

export interface PlayerState {
  surahId: number | null;
  surahName: string | null;
  ayah: number;
  ayahIndex: number;
  totalAyahs: number;
  isPlaying: boolean;
  isLoading: boolean;
  currentMs: number;
  totalMs: number;
  volume: number;
  error: string | null;
}

export interface PlayerActions {
  playSurah(surahId: number, opts?: { ayah?: number; localMs?: number; autoplay?: boolean }): Promise<void>;
  playWord(wordId: string): void;
  toggle(): void;
  next(): void;
  prev(): void;
  seek(globalMs: number): void;
  setVolume(volume: number): void;
  primeTimings(surahId: number, timings: SurahTimings): void;
  attachRegistry(surahId: number, registry: WordRegistry): () => void;
}

export type PlayerContextValue = PlayerState & PlayerActions;

export const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayer(): PlayerContextValue {
  const value = useContext(PlayerContext);
  if (!value) throw new Error('usePlayer must be used inside <PlayerProvider>');
  return value;
}
```

- [ ] **Step 4: Implement the provider**

Create `components/player/PlayerProvider.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AyahPlaylist } from '@/lib/audio/playlist';
import { SyncEngine } from '@/lib/sync/engine';
import { Timeline } from '@/lib/sync/timeline';
import { loadTimings, primeTimings as primeTimingsCache } from '@/lib/player/timingsLoader';
import { readLastPosition, writeLastPosition } from '@/lib/player/lastPosition';
import { getSurahList } from '@/lib/data/loaders';
import { PlayerContext, type PlayerState } from './usePlayer';
import type { SurahTimings } from '@/lib/data/types';
import type { WordRegistry } from '@/lib/reader/wordRegistry';

const NAMES = new Map(getSurahList().map(s => [s.id, s.nameSimple]));

const INITIAL: PlayerState = {
  surahId: null, surahName: null, ayah: 1, ayahIndex: 0, totalAyahs: 0,
  isPlaying: false, isLoading: false, currentMs: 0, totalMs: 0,
  volume: 1, error: null,
};

/**
 * Owns playback for the whole app.
 *
 * Mounted in the root layout, which the App Router keeps alive across
 * client-side navigation — that is what lets recitation continue while the
 * user browses. The word registry stays owned by the surah page, because the
 * DOM nodes belong to it; the page attaches its registry here and the provider
 * writes to it only while that page's surah is the one playing.
 */
export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PlayerState>(INITIAL);

  const playlistRef = useRef<AyahPlaylist | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const timingsRef = useRef<SurahTimings | null>(null);
  const attachedRef = useRef<{ surahId: number; registry: WordRegistry } | null>(null);
  const playingSurahRef = useRef<number | null>(null);

  const patch = useCallback((next: Partial<PlayerState>) => {
    setState(prev => ({ ...prev, ...next }));
  }, []);

  /** Paint the highlight only when the mounted page is the playing surah. */
  const paint = useCallback((wordId: string | null) => {
    const attached = attachedRef.current;
    if (!attached || attached.surahId !== playingSurahRef.current) return;
    const words = timingsRef.current?.ayahs[playlistRef.current?.currentAyahIndex ?? 0]?.words ?? [];
    const word = words.find(w => w.id === wordId);
    attached.registry.setActive(wordId, word?.estimated ?? false);
  }, []);

  const teardown = useCallback(() => {
    engineRef.current?.detach();
    playlistRef.current?.destroy();
    engineRef.current = null;
    playlistRef.current = null;
    timelineRef.current = null;
  }, []);

  const playSurah = useCallback(async (
    surahId: number,
    opts: { ayah?: number; localMs?: number; autoplay?: boolean } = {},
  ) => {
    const { ayah, localMs = 0, autoplay = true } = opts;

    let timings: SurahTimings;
    try {
      timings = await loadTimings(surahId);
    } catch {
      patch({ error: 'Could not load this surah. Please try again.' });
      return;
    }

    teardown();

    const playlist = new AyahPlaylist(timings.ayahs);
    const engine = new SyncEngine();
    const timeline = new Timeline(timings.ayahs);

    playlistRef.current = playlist;
    engineRef.current = engine;
    timelineRef.current = timeline;
    timingsRef.current = timings;
    playingSurahRef.current = surahId;

    engine.onChange(paint);

    playlist.on('ayahchange', index => {
      engine.setWords(timings.ayahs[index]?.words ?? []);
      const ayahNumber = timings.ayahs[index]?.ayah ?? 1;
      patch({ ayahIndex: index, ayah: ayahNumber, error: null });
      writeLastPosition({ surahId, ayah: ayahNumber, localMs: 0 });
    });
    playlist.on('state', playing => patch({ isPlaying: playing }));
    playlist.on('loading', loading => patch({ isLoading: loading }));
    playlist.on('error', () => patch({
      error: 'Unable to load this recitation.', isLoading: false,
    }));
    playlist.on('ended', () => {
      paint(null);
      patch({ isPlaying: false });
    });
    playlist.on('duration', (index, durationMs) => {
      timeline.setActualDuration(index, durationMs, playlist.currentAyahIndex);
      patch({ totalMs: timeline.totalMs });
    });

    const startIndex = ayah
      ? Math.max(0, timings.ayahs.findIndex(a => a.ayah === ayah))
      : 0;

    engine.attach(() => playlist.localTimeMs(), timings.ayahs[startIndex]?.words ?? []);
    playlist.seekToAyah(startIndex, localMs);

    patch({
      surahId,
      surahName: NAMES.get(surahId) ?? null,
      ayah: timings.ayahs[startIndex]?.ayah ?? 1,
      ayahIndex: startIndex,
      totalAyahs: timings.ayahs.length,
      totalMs: timeline.totalMs,
      error: null,
      // Held true until the audio element actually produces sound, so the UI
      // never claims to be playing while the file is still downloading.
      isLoading: autoplay,
    });

    writeLastPosition({ surahId, ayah: timings.ayahs[startIndex]?.ayah ?? 1, localMs });

    if (autoplay) playlist.play();
  }, [patch, paint, teardown]);

  const toggle = useCallback(() => {
    const playlist = playlistRef.current;
    if (!playlist) {
      const saved = readLastPosition();
      if (saved) void playSurah(saved.surahId, { ayah: saved.ayah, localMs: saved.localMs });
      return;
    }
    if (playlist.isPlaying) playlist.pause();
    else { patch({ isLoading: true }); playlist.play(); }
  }, [patch, playSurah]);

  const playWord = useCallback((wordId: string) => {
    const playlist = playlistRef.current;
    const timings = timingsRef.current;
    if (!playlist || !timings) return;
    const [, ayahStr] = wordId.split(':');
    const index = timings.ayahs.findIndex(a => a.ayah === Number(ayahStr));
    if (index === -1) return;
    const word = timings.ayahs[index].words.find(w => w.id === wordId);
    engineRef.current?.setWords(timings.ayahs[index].words);
    playlist.seekToAyah(index, word?.startMs ?? 0);
    patch({ isLoading: true });
    playlist.play();
  }, [patch]);

  const attachRegistry = useCallback((surahId: number, registry: WordRegistry) => {
    attachedRef.current = { surahId, registry };
    // Reattaching mid-playback should highlight the current word immediately
    // rather than waiting for the next word boundary.
    if (surahId === playingSurahRef.current) {
      engineRef.current?.onChange(paint);
    }
    return () => {
      if (attachedRef.current?.registry === registry) attachedRef.current = null;
    };
  }, [paint]);

  const seek = useCallback((globalMs: number) => {
    const playlist = playlistRef.current;
    const timeline = timelineRef.current;
    const timings = timingsRef.current;
    if (!playlist || !timeline || !timings) return;
    const { ayahIndex, localMs } = timeline.globalToLocal(globalMs);
    engineRef.current?.setWords(timings.ayahs[ayahIndex]?.words ?? []);
    playlist.seekToAyah(ayahIndex, localMs);
    patch({ currentMs: globalMs, ayahIndex, ayah: timings.ayahs[ayahIndex]?.ayah ?? 1 });
  }, [patch]);

  const setVolume = useCallback((volume: number) => {
    playlistRef.current?.setVolume(volume);
    patch({ volume });
  }, [patch]);

  // Restore the saved position so the bar can offer it, without playing.
  useEffect(() => {
    const saved = readLastPosition();
    if (saved) {
      setState(prev => ({
        ...prev,
        surahId: saved.surahId,
        surahName: NAMES.get(saved.surahId) ?? null,
        ayah: saved.ayah,
      }));
    }
  }, []);

  // Progress ticks at a human rate; the highlight runs at frame rate.
  useEffect(() => {
    const id = window.setInterval(() => {
      const playlist = playlistRef.current;
      const timeline = timelineRef.current;
      if (!playlist || !timeline) return;
      patch({ currentMs: timeline.localToGlobal(playlist.currentAyahIndex, playlist.localTimeMs()) });
    }, 250);
    return () => window.clearInterval(id);
  }, [patch]);

  useEffect(() => teardown, [teardown]);

  const value = useMemo(() => ({
    ...state,
    playSurah, playWord, toggle, seek, setVolume,
    next: () => playlistRef.current?.next(),
    prev: () => playlistRef.current?.prev(),
    primeTimings: primeTimingsCache,
    attachRegistry,
  }), [state, playSurah, playWord, toggle, seek, setVolume, attachRegistry]);

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `npx vitest run components/player/__tests__/PlayerProvider.test.tsx`
Expected: 6 passing. If `isLoading` assertions fail, check that `patch({ isLoading: autoplay })` runs before `playlist.play()`.

- [ ] **Step 6: Commit**

```bash
git add components/player
git commit -m "feat: move playback into a layout-level PlayerProvider"
```

---

## Task 8: PlayerBar

**Files:**
- Create: `components/player/PlayerBar.tsx`
- Test: `components/player/__tests__/PlayerBar.test.tsx`

**Interfaces:**
- Consumes: `usePlayer`, `ProgressBar`, `PlayerIcons`
- Produces: `PlayerBar` — renders nothing when there is no surah and no saved position

- [ ] **Step 1: Write the failing test**

Create `components/player/__tests__/PlayerBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayerBar } from '../PlayerBar';
import { PlayerContext, type PlayerContextValue } from '../usePlayer';

const value = (over: Partial<PlayerContextValue> = {}): PlayerContextValue => ({
  surahId: null, surahName: null, ayah: 1, ayahIndex: 0, totalAyahs: 0,
  isPlaying: false, isLoading: false, currentMs: 0, totalMs: 0, volume: 1, error: null,
  playSurah: vi.fn(), playWord: vi.fn(), toggle: vi.fn(), next: vi.fn(), prev: vi.fn(),
  seek: vi.fn(), setVolume: vi.fn(), primeTimings: vi.fn(), attachRegistry: vi.fn(() => () => {}),
  ...over,
});

const renderBar = (over?: Partial<PlayerContextValue>) =>
  render(<PlayerContext.Provider value={value(over)}><PlayerBar /></PlayerContext.Provider>);

describe('PlayerBar', () => {
  it('renders nothing with no surah and no saved position', () => {
    const { container } = renderBar();
    expect(container.firstChild).toBeNull();
  });

  it('shows the surah and ayah once something is loaded', () => {
    renderBar({ surahId: 2, surahName: 'Al-Baqarah', ayah: 45, totalAyahs: 286 });
    expect(screen.getByText(/Al-Baqarah/)).toBeInTheDocument();
    expect(screen.getByText(/45/)).toBeInTheDocument();
  });

  it('offers play when paused and pause when playing', () => {
    renderBar({ surahId: 2, surahName: 'Al-Baqarah', isPlaying: false });
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
  });

  // The Phase 1 bug: the button claimed "Pause" while audio was still loading.
  it('shows a loading state rather than pause while audio loads', () => {
    renderBar({ surahId: 2, surahName: 'Al-Baqarah', isPlaying: true, isLoading: true });
    expect(screen.getByRole('button', { name: /loading/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^pause$/i })).toBeNull();
  });

  it('surfaces an error', () => {
    renderBar({ surahId: 2, surahName: 'Al-Baqarah', error: 'Unable to load this recitation.' });
    expect(screen.getByRole('alert')).toHaveTextContent(/unable to load/i);
  });

  it('links to the playing surah', () => {
    renderBar({ surahId: 36, surahName: 'Ya-Sin' });
    expect(screen.getByRole('link', { name: /Ya-Sin/ })).toHaveAttribute('href', '/surah/36');
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run components/player/__tests__/PlayerBar.test.tsx`
Expected: FAIL — cannot resolve `../PlayerBar`.

- [ ] **Step 3: Implement**

Create `components/player/PlayerBar.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePlayer } from './usePlayer';
import { ProgressBar } from '@/components/ProgressBar';
import { PlayIcon, PauseIcon, PrevIcon, NextIcon, SpinnerIcon } from '@/components/PlayerIcons';

const BUTTON =
  'grid place-items-center rounded-full transition ' +
  'outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 ' +
  'active:scale-95';

/**
 * The player, visible on every page. It is also the resume affordance: when
 * nothing is playing but a previous position was saved, it shows that position
 * with a play button, which is why no separate "continue reading" card exists.
 */
export function PlayerBar() {
  const p = usePlayer();

  // Nothing has ever played and nothing was saved — show no chrome at all.
  if (p.surahId === null) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white/95 backdrop-blur">
      {p.error && (
        <div role="alert" className="bg-red-50 px-4 py-2 text-center text-sm text-red-800">
          {p.error}
        </div>
      )}

      <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-3">
        <ProgressBar valueMs={p.currentMs} totalMs={p.totalMs} onSeek={p.seek} />

        <div className="flex items-center justify-between gap-3">
          <Link
            href={`/surah/${p.surahId}`}
            className="min-w-0 flex-1 truncate text-sm text-neutral-700 hover:text-neutral-900"
          >
            <span className="font-medium">{p.surahName}</span>
            <span className="ml-2 text-neutral-400 tabular-nums">
              {p.ayah}{p.totalAyahs ? ` / ${p.totalAyahs}` : ''}
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <button type="button" aria-label="Previous ayah" onClick={p.prev}
              className={`${BUTTON} size-10 text-neutral-600 hover:bg-neutral-100`}>
              <PrevIcon className="size-5" />
            </button>

            <button
              type="button"
              aria-label={p.isLoading ? 'Loading' : p.isPlaying ? 'Pause' : 'Play'}
              onClick={p.toggle}
              className={`${BUTTON} size-14 bg-neutral-900 text-white shadow-sm hover:bg-neutral-700`}
            >
              {p.isLoading
                ? <SpinnerIcon className="size-6 animate-spin" />
                : p.isPlaying ? <PauseIcon className="size-6" /> : <PlayIcon className="size-6" />}
            </button>

            <button type="button" aria-label="Next ayah" onClick={p.next}
              className={`${BUTTON} size-10 text-neutral-600 hover:bg-neutral-100`}>
              <NextIcon className="size-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run components/player/__tests__/PlayerBar.test.tsx`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add components/player/PlayerBar.tsx components/player/__tests__/PlayerBar.test.tsx
git commit -m "feat: add the always-visible player bar"
```

---

## Task 9: Wire the layout and rewrite the surah page

**Files:**
- Modify: `app/layout.tsx`
- Rewrite: `app/surah/[id]/SurahClient.tsx`
- Create: `components/offline/ServiceWorkerRegistrar.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2–8
- Produces: a working app where playback survives navigation

- [ ] **Step 1: Add the service worker registrar**

Create `components/offline/ServiceWorkerRegistrar.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { registerServiceWorker } from '@/lib/offline/registerServiceWorker';

/** Renders nothing; exists so registration runs once on the client. */
export function ServiceWorkerRegistrar() {
  useEffect(() => { void registerServiceWorker(); }, []);
  return null;
}
```

- [ ] **Step 2: Mount the provider and bar in the layout**

Replace `app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import { OfflineBanner } from '@/components/OfflineBanner';
import { PlayerProvider } from '@/components/player/PlayerProvider';
import { PlayerBar } from '@/components/player/PlayerBar';
import { ServiceWorkerRegistrar } from '@/components/offline/ServiceWorkerRegistrar';
import './globals.css';

export const metadata: Metadata = {
  title: 'Quran',
  description: 'Listen to the Quran and follow every word.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerRegistrar />
        <OfflineBanner />
        {/* The provider lives here so audio survives client-side navigation. */}
        <PlayerProvider>
          {children}
          <PlayerBar />
        </PlayerProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Rewrite the surah page as a consumer**

Replace `app/surah/[id]/SurahClient.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { QuranReader } from '@/components/QuranReader';
import { ScriptToggle } from '@/components/ScriptToggle';
import { JumpToAyahPill } from '@/components/JumpToAyahPill';
import type { Script } from '@/components/QuranWord';
import { WordRegistry } from '@/lib/reader/wordRegistry';
import { useAutoScroll } from '@/lib/reader/useAutoScroll';
import { usePlayer } from '@/components/player/usePlayer';
import type { SurahMeta, SurahText, SurahTimings } from '@/lib/data/types';

const SCRIPT_KEY = 'quran.script';

interface Props {
  meta: SurahMeta;
  text: SurahText;
  timings: SurahTimings;
}

export function SurahClient({ meta, text, timings }: Props) {
  const registry = useMemo(() => new WordRegistry(), []);
  const player = usePlayer();
  const [script, setScript] = useState<Script>('tajweed');

  const isThisSurahPlaying = player.surahId === meta.id;
  const activeAyah = isThisSurahPlaying ? player.ayah : 1;
  const { suspended, resume } = useAutoScroll(activeAyah, isThisSurahPlaying && player.isPlaying);

  useEffect(() => {
    const saved = window.localStorage.getItem(SCRIPT_KEY);
    if (saved === 'tajweed' || saved === 'indopak') setScript(saved);
  }, []);

  const changeScript = useCallback((next: Script) => {
    setScript(next);
    window.localStorage.setItem(SCRIPT_KEY, next);
  }, []);

  // Hand our timings to the provider so pressing play costs no extra fetch.
  useEffect(() => {
    player.primeTimings(meta.id, timings);
  }, [player, meta.id, timings]);

  // Register our DOM word map. The provider paints into it only while this
  // surah is the one playing.
  useEffect(() => {
    const detach = player.attachRegistry(meta.id, registry);
    return () => { detach(); registry.clear(); };
  }, [player, meta.id, registry]);

  const handleWordClick = useCallback((wordId: string) => {
    if (isThisSurahPlaying) { player.playWord(wordId); resume(); return; }
    const [, ayahStr] = wordId.split(':');
    void player.playSurah(meta.id, { ayah: Number(ayahStr) }).then(resume);
  }, [player, meta.id, isThisSurahPlaying, resume]);

  const handleAyahPlay = useCallback((ayah: number) => {
    void player.playSurah(meta.id, { ayah }).then(resume);
  }, [player, meta.id, resume]);

  return (
    <main className="min-h-screen bg-white">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← All surahs
        </Link>
        <ScriptToggle script={script} onChange={changeScript} />
      </header>

      <div className="mx-auto max-w-3xl px-4 text-center">
        <h1 className="text-3xl">{meta.nameArabic}</h1>
        <p className="text-neutral-500">{meta.nameSimple} · {meta.nameEnglish}</p>
        <p className="mt-1 text-xs text-neutral-400">AbdulBaset AbdulSamad · Murattal</p>
      </div>

      <QuranReader
        text={text}
        script={script}
        registry={registry}
        activeAyah={activeAyah}
        onWordClick={handleWordClick}
        onAyahPlay={handleAyahPlay}
      />

      <JumpToAyahPill visible={suspended && isThisSurahPlaying && player.isPlaying} onClick={resume} />
    </main>
  );
}
```

- [ ] **Step 4: Verify build and suite**

Run: `npx vitest run` — every test must pass, including the Phase 1 suite.
Run: `npx tsc --noEmit` — clean.
Run: `npm run build` — success.

- [ ] **Step 5: Verify by hand**

Run `npm run dev`, then:
- Open `/surah/1/`, press play, confirm words highlight
- Navigate to `/` — audio keeps playing, the bar stays visible
- Open `/surah/2/` — audio still surah 1, and surah 2's words are NOT highlighted
- Go back to `/surah/1/` — the highlight resumes on the current word
- Reload the page — the bar shows the last position with a play button

- [ ] **Step 6: Commit**

```bash
git add app/layout.tsx "app/surah/[id]/SurahClient.tsx" components/offline
git commit -m "feat: play through navigation via the layout-level provider"
```

---

## Task 10: Downloads screen

**Files:**
- Create: `app/downloads/page.tsx`, `components/offline/SurahDownloadRow.tsx`
- Test: `components/offline/__tests__/SurahDownloadRow.test.tsx`
- Modify: `app/page.tsx` (link to the screen)

**Interfaces:**
- Consumes: `downloadSurah`, `deleteSurah`, `getStatus`, `isOfflineSupported`, `getSurahList`
- Produces: `/downloads` route

- [ ] **Step 1: Write the failing test**

Create `components/offline/__tests__/SurahDownloadRow.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SurahDownloadRow } from '../SurahDownloadRow';

const meta = { id: 2, nameArabic: 'البقرة', nameSimple: 'Al-Baqarah', nameEnglish: 'The Cow', ayahCount: 286, revelationPlace: 'madinah', available: true };

describe('SurahDownloadRow', () => {
  it('offers download when not stored', () => {
    render(<SurahDownloadRow meta={meta} storedCount={0} onDownload={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument();
  });

  it('offers delete when fully stored', () => {
    render(<SurahDownloadRow meta={meta} storedCount={286} onDownload={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  // A partial download must not read as available offline.
  it('shows partial progress rather than claiming availability', () => {
    render(<SurahDownloadRow meta={meta} storedCount={100} onDownload={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/100\s*\/\s*286/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
  });

  it('calls onDownload', async () => {
    const onDownload = vi.fn();
    render(<SurahDownloadRow meta={meta} storedCount={0} onDownload={onDownload} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /download/i }));
    expect(onDownload).toHaveBeenCalledWith(2);
  });

  it('disables the button while downloading', () => {
    render(<SurahDownloadRow meta={meta} storedCount={0} downloading={{ done: 10, total: 286 }} onDownload={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole('button', { name: /downloading/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run components/offline/__tests__/SurahDownloadRow.test.tsx`
Expected: FAIL — cannot resolve `../SurahDownloadRow`.

- [ ] **Step 3: Implement the row**

Create `components/offline/SurahDownloadRow.tsx`:

```tsx
'use client';

import type { SurahMeta } from '@/lib/data/types';

interface Props {
  meta: SurahMeta;
  storedCount: number;
  downloading?: { done: number; total: number };
  onDownload: (surahId: number) => void;
  onDelete: (surahId: number) => void;
}

export function SurahDownloadRow({ meta, storedCount, downloading, onDownload, onDelete }: Props) {
  const complete = storedCount >= meta.ayahCount && meta.ayahCount > 0;
  const partial = storedCount > 0 && !complete;

  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="truncate font-medium">{meta.nameSimple}</div>
        <div className="text-xs text-neutral-500">
          {complete && 'Available offline'}
          {/* Partial storage is reported honestly rather than as "available". */}
          {partial && `${storedCount} / ${meta.ayahCount} ayahs stored`}
          {!complete && !partial && `${meta.ayahCount} ayahs`}
        </div>
      </div>

      {downloading ? (
        <button type="button" disabled
          className="rounded-full bg-neutral-100 px-3 py-1 text-sm text-neutral-500">
          Downloading {Math.round((downloading.done / Math.max(downloading.total, 1)) * 100)}%
        </button>
      ) : complete ? (
        <button type="button" onClick={() => onDelete(meta.id)}
          className="rounded-full px-3 py-1 text-sm text-red-700 hover:bg-red-50">
          Delete
        </button>
      ) : (
        <button type="button" onClick={() => onDownload(meta.id)}
          className="rounded-full bg-neutral-900 px-3 py-1 text-sm text-white hover:bg-neutral-700">
          Download
        </button>
      )}
    </li>
  );
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run components/offline/__tests__/SurahDownloadRow.test.tsx`
Expected: 5 passing.

- [ ] **Step 5: Implement the screen**

Create `app/downloads/page.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getSurahList } from '@/lib/data/loaders';
import { SurahDownloadRow } from '@/components/offline/SurahDownloadRow';
import {
  downloadSurah, deleteSurah, getStatus, isOfflineSupported, type OfflineStatus,
} from '@/lib/offline/downloadManager';

const MB = 1024 * 1024;
const surahs = getSurahList().filter(s => s.available);

export default function DownloadsPage() {
  const [status, setStatus] = useState<OfflineStatus | null>(null);
  const [supported, setSupported] = useState(true);
  const [busy, setBusy] = useState<Record<number, { done: number; total: number }>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isOfflineSupported()) { setSupported(false); return; }
    try { setStatus(await getStatus()); } catch { setSupported(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleDownload = useCallback(async (surahId: number) => {
    setError(null);
    setBusy(b => ({ ...b, [surahId]: { done: 0, total: 1 } }));
    try {
      await downloadSurah(surahId, (done, total) =>
        setBusy(b => ({ ...b, [surahId]: { done, total } })));
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(b => { const next = { ...b }; delete next[surahId]; return next; });
    }
  }, [refresh]);

  const handleDelete = useCallback(async (surahId: number) => {
    await deleteSurah(surahId);
    await refresh();
  }, [refresh]);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 pb-40">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">← All surahs</Link>
      <h1 className="mt-4 text-2xl font-semibold">Offline downloads</h1>

      {!supported && (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Offline storage is not available in this browser. Recitation still plays
          normally over the network.
        </p>
      )}

      {status && (
        <p className="mt-2 text-sm text-neutral-500">
          Using {(status.usage / MB).toFixed(0)} MB
          {status.quota ? ` of about ${(status.quota / MB).toFixed(0)} MB available` : ''}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {supported && (
        <ul className="mt-6 divide-y divide-neutral-100 rounded-xl border border-neutral-200">
          {surahs.map(meta => (
            <SurahDownloadRow
              key={meta.id}
              meta={meta}
              storedCount={status?.bySurah[meta.id] ?? 0}
              downloading={busy[meta.id]}
              onDownload={handleDownload}
              onDelete={handleDelete}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 6: Link it from the home page**

In `app/page.tsx`, inside the `<header>` block, after the tagline paragraph, add:

```tsx
<Link href="/downloads" className="mt-3 inline-block text-sm text-neutral-500 underline hover:text-neutral-900">
  Offline downloads
</Link>
```

Add `import Link from 'next/link';` at the top if it is not already imported.

- [ ] **Step 7: Verify**

Run: `npx vitest run` — all passing.
Run: `npm run build` — success, with `/downloads` among the routes.

- [ ] **Step 8: Commit**

```bash
git add app/downloads app/page.tsx components/offline
git commit -m "feat: add the offline downloads screen"
```

---

## Task 11: Playwright regression tests

**Files:**
- Create: `e2e/player.spec.ts`, `playwright.config.ts`
- Modify: `package.json` (script)

**Interfaces:**
- Consumes: the built app
- Produces: `npm run test:e2e`

- [ ] **Step 1: Add the config**

Create `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:3000' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
```

Install the test runner:

```bash
npm install -D @playwright/test
```

Add to `package.json` scripts:

```json
"test:e2e": "playwright test"
```

- [ ] **Step 2: Write the tests**

Create `e2e/player.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('playback survives navigation and the highlight reattaches', async ({ page }) => {
  await page.goto('/surah/1/');
  await page.getByRole('button', { name: 'Play' }).click();

  // Wait for a word to actually highlight before judging anything else.
  await expect(page.locator('.word--active')).toHaveCount(1, { timeout: 20_000 });

  await page.goto('/');
  // The bar persists and still names the surah.
  await expect(page.getByRole('link', { name: /Al-Fatihah/ })).toBeVisible();

  await page.goto('/surah/1/');
  await expect(page.locator('.word--active')).toHaveCount(1, { timeout: 20_000 });
});

test('a different surah page is not highlighted while another plays', async ({ page }) => {
  await page.goto('/surah/1/');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('.word--active')).toHaveCount(1, { timeout: 20_000 });

  await page.goto('/surah/2/');
  // Surah 2's words must stay untouched while surah 1 plays.
  await page.waitForTimeout(2000);
  await expect(page.locator('.word--active')).toHaveCount(0);
});

// The Phase 1 defect: the control claimed "Pause" while audio was still loading.
test('the control never claims to be playing while audio is still loading', async ({ page }) => {
  await page.goto('/surah/2/');
  await page.getByRole('button', { name: 'Play' }).click();

  const pauseVisible = await page.getByRole('button', { name: 'Pause' }).isVisible().catch(() => false);
  const highlighted = await page.locator('.word--active').count();
  // If it says Pause, a word must already be highlighted.
  expect(pauseVisible && highlighted === 0).toBe(false);
});

test('the saved position is offered after a reload', async ({ page }) => {
  await page.goto('/surah/1/');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('.word--active')).toHaveCount(1, { timeout: 20_000 });

  await page.goto('/');
  await page.reload();
  await expect(page.getByRole('link', { name: /Al-Fatihah/ })).toBeVisible();
});
```

- [ ] **Step 3: Run them**

Run: `npm run test:e2e`
Expected: 4 passing. If the first test times out waiting for a highlight, audio is not reaching the browser — check `NEXT_PUBLIC_AUDIO_BASE_URL` is set locally or that `public/audio/` is populated.

- [ ] **Step 4: Commit**

```bash
git add e2e playwright.config.ts package.json package-lock.json
git commit -m "test: add end-to-end coverage for cross-navigation playback"
```

---

## Task 12: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/DATA_SOURCES.md`

- [ ] **Step 1: Update the README**

Add a section describing: playback continuing across navigation, offline downloads and the `/downloads` screen, resume, and the fact that audio caching is handled by a service worker with a 100 MB runtime budget plus unlimited pinned downloads. Correct the "How it works" section to mention the provider now owns playback.

Update the test command note to describe both `npm test` and `npm run test:e2e`.

- [ ] **Step 2: Note the data move in DATA_SOURCES.md**

Change the word-timings section's stated path from `data/timings/` to `public/timings/`, and say why: the client fetches them at runtime so the player can advance through a surah whose page is not mounted.

- [ ] **Step 3: Verify and commit**

Run: `npx vitest run && npm run build`

```bash
git add README.md docs/DATA_SOURCES.md
git commit -m "docs: describe the persistent player, offline downloads and resume"
```

---

## Self-Review

**Spec coverage.**

| Spec section | Task |
|---|---|
| §2 provider architecture | 7, 9 |
| §2 registry attach protocol | 7, 9 |
| §2 data layout change | 1 |
| §3 service worker, two caches | 5 |
| §3 LRU eviction | 4 |
| §3 download manager + messages | 6 |
| §3 downloads screen + quota | 10 |
| §4 resume | 2, 7, 8 |
| §5 player UI | 8, 9 |
| §5 loading-state fix | 7, 8, 11 |
| §6 error handling | 2, 5, 6, 7, 10 |
| §7 testing | 2, 3, 4, 5, 6, 7, 8, 10, 11 |
| §8 risks | mitigations land in 4, 7, 10 |

**Placeholder scan:** no TBDs, no "handle errors appropriately", no "similar to Task N" — each task repeats the code it needs.

**Type consistency:** `PlayerState` and `PlayerActions` are defined once in `usePlayer.ts` (Task 7) and consumed unchanged by `PlayerBar` (Task 8) and `SurahClient` (Task 9). `OfflineStatus` is defined in `downloadManager.ts` (Task 6) and consumed by the downloads page (Task 10). `CacheEntry`/`selectEvictions` (Task 4) are mirrored deliberately in `sw.js` (Task 5), which is called out in that task rather than left as an accident. `attachRegistry` returns a detach function in every place it appears.

**Known gap, stated deliberately:** `sw.js` duplicates the eviction rule because a service worker cannot import from the bundle. The tested copy is the source of truth; Task 5 says so in the file's own comment.
