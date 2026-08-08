import { readFileSync } from 'node:fs';
import path from 'node:path';
import surahs from '@/data/surahs.json';
import type { SurahMeta, SurahText, SurahTimings } from './types';

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

/**
 * Read from disk rather than imported.
 *
 * A dynamic `import()`/`require()` of a templated path cannot be statically
 * analysed by the bundler, and listing 114 static imports is worse. These are
 * only ever called from server components during the static export, so reading
 * the file directly at build time is both correct and simplest.
 */
function readJson<T>(...segments: string[]): T {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), 'data', ...segments), 'utf8'),
  ) as T;
}

export function getSurahText(id: number): SurahText {
  return readJson<SurahText>('text', `${id}.json`);
}

export function getSurahTimings(id: number): SurahTimings {
  return readJson<SurahTimings>('timings', 'abdulbasit-murattal', `${id}.json`);
}
