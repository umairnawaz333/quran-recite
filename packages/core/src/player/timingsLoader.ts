import type { SurahTimings } from '../data/types';

const RECITER = 'abdulbasit-murattal';

const cache = new Map<number, SurahTimings>();
const inFlight = new Map<number, Promise<SurahTimings>>();

export interface TimingsStore {
  read(surahId: number): Promise<SurahTimings | null>;
  write(surahId: number, timings: SurahTimings): Promise<void>;
}

let baseUrl = '';
let store: TimingsStore | undefined;

/**
 * Supplies the base every timings request is resolved against, plus an
 * optional persistent store consulted before the network. Left unconfigured,
 * the web keeps its historical root-relative request.
 */
export function configureTimings(opts: { baseUrl?: string; store?: TimingsStore }): void {
  if (opts.baseUrl !== undefined) baseUrl = opts.baseUrl.replace(/\/+$/, '');
  if (opts.store !== undefined) store = opts.store;
}

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

  const request = (async () => {
    const stored = await store?.read(surahId);
    if (stored) return stored;

    const res = await fetch(`${baseUrl}/timings/${RECITER}/${surahId}.json`);
    if (!res.ok) throw new Error(`timings ${res.status} for surah ${surahId}`);
    const timings = (await res.json()) as SurahTimings;
    await store?.write(surahId, timings);
    return timings;
  })()
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

/**
 * Test-only: drops all memoised state *and* configuration — the cache, any
 * in-flight requests, the configured base URL, and the configured store.
 * Configuration has to go too: `configureTimings`'s `store` can only be set,
 * never unset (`if (opts.store !== undefined)`), so without this a store
 * configured in one test would otherwise leak into every test that runs
 * after it.
 */
export function resetTimingsCache(): void {
  cache.clear();
  inFlight.clear();
  baseUrl = '';
  store = undefined;
}
