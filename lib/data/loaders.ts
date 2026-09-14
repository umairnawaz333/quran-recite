import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SurahText, SurahTimings } from '@quran/core';

export { getSurahList, getSurahMeta, getAvailableSurahIds } from './surahIndex';

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
  return JSON.parse(
    readFileSync(
      path.join(process.cwd(), 'public', 'timings', 'abdulbasit-murattal', `${id}.json`),
      'utf8',
    ),
  ) as SurahTimings;
}
