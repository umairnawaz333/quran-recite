import type { SurahTimings } from '../data/types';

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
