/**
 * Controllable timings, injected through the seam `@quran/core`'s
 * `configureTimings({ store })` already provides: a store is consulted
 * before the network, so registering one here means `loadTimings` never
 * fetches and every test decides exactly when (and whether) a surah's
 * timings resolve. That control is the whole point — the provider's
 * stale-token discipline and its "the old surah stays live while the new one
 * loads" rule only exist in the window between the call and the resolution.
 */
import type { SurahTimings, TimingsStore } from '@quran/core';

const WORDS_PER_AYAH = 2;
const AYAH_MS = 4000;

const pad = (n: number) => String(n).padStart(3, '0');

/** Two words per ayah: [0, 2000) and [2000, 4000) local milliseconds. */
export function buildTimings(surahId: number, ayahCount: number): SurahTimings {
  return {
    surah: surahId,
    reciterId: 'abdulbasit-murattal',
    surahDurationMs: ayahCount * AYAH_MS,
    ayahs: Array.from({ length: ayahCount }, (_, i) => {
      const ayah = i + 1;
      return {
        ayah,
        audioUrl: `/audio/abdulbasit-murattal/${pad(surahId)}${pad(ayah)}.mp3`,
        startOffsetMs: i * AYAH_MS,
        durationMs: AYAH_MS,
        words: Array.from({ length: WORDS_PER_AYAH }, (__, w) => ({
          id: `${surahId}:${ayah}:${w + 1}`,
          position: w + 1,
          startMs: w * (AYAH_MS / WORDS_PER_AYAH),
          endMs: (w + 1) * (AYAH_MS / WORDS_PER_AYAH),
          estimated: false,
        })),
      };
    }),
  };
}

interface Pending {
  resolve(timings: SurahTimings): void;
  reject(err: unknown): void;
}

const registry = new Map<number, SurahTimings>();
const held = new Set<number>();
const failing = new Set<number>();
const pending = new Map<number, Pending>();

/** Every surah id `loadTimings` has asked this store for. */
export const timingsReads: number[] = [];

/** `surahId` resolves immediately with `ayahCount` ayahs. */
export function provideTimings(surahId: number, ayahCount: number): void {
  registry.set(surahId, buildTimings(surahId, ayahCount));
}

/** `surahId` does not resolve until `releaseTimings(surahId)` is called. */
export function holdTimings(surahId: number, ayahCount: number): void {
  provideTimings(surahId, ayahCount);
  held.add(surahId);
}

export function releaseTimings(surahId: number): void {
  const waiter = pending.get(surahId);
  const timings = registry.get(surahId);
  if (!waiter || !timings) throw new Error(`nothing is waiting on timings for surah ${surahId}`);
  pending.delete(surahId);
  held.delete(surahId);
  waiter.resolve(timings);
}

/** `surahId`'s timings cannot be loaded at all. */
export function failTimings(surahId: number): void {
  failing.add(surahId);
}

export const timingsStore: TimingsStore = {
  read(surahId: number): Promise<SurahTimings | null> {
    timingsReads.push(surahId);
    if (failing.has(surahId)) {
      return Promise.reject(new Error(`timings unavailable for surah ${surahId}`));
    }
    if (held.has(surahId)) {
      return new Promise<SurahTimings>((resolve, reject) => {
        pending.set(surahId, { resolve, reject });
      });
    }
    const timings = registry.get(surahId);
    if (timings) return Promise.resolve(timings);
    // Never `null`: that would fall through to a real network fetch.
    return Promise.reject(new Error(`no timings registered for surah ${surahId}`));
  },
  async write() {},
};

export function resetTimings(): void {
  registry.clear();
  held.clear();
  failing.clear();
  pending.clear();
  timingsReads.length = 0;
}
