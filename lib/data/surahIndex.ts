import surahs from '@/data/surahs.json';
import type { SurahMeta } from './types';

/**
 * The surah index, sourced from a plain JSON import with no filesystem
 * dependency. Kept separate from `loaders.ts` (which reads ayah text and
 * timings from disk via `node:fs`) so that client components — such as the
 * layout-level `PlayerProvider`, which needs surah names for the persistent
 * player bar — can depend on this without pulling `node:fs` into the browser
 * bundle.
 */
export function getSurahList(): SurahMeta[] {
  return surahs as SurahMeta[];
}

export function getSurahMeta(id: number): SurahMeta | undefined {
  return getSurahList().find(s => s.id === id);
}

/** Available surah ids, used to generate static routes. */
export function getAvailableSurahIds(): number[] {
  return getSurahList().filter(s => s.available).map(s => s.id);
}
