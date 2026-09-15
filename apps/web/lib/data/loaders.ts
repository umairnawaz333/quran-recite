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
function textPath(id: number): string {
  // The web builds from apps/web (Vercel's rootDirectory, and the root npm
  // script delegates into this workspace), so cwd is deterministic. Kept
  // cwd-relative rather than import.meta-relative because this module is
  // compiled by Next for server components, where the emitted module format
  // is not guaranteed to provide import.meta.dirname.
  return path.join(process.cwd(), '..', '..', 'packages', 'quran-data', 'text', `${id}.json`);
}

export function getSurahText(id: number): SurahText {
  return JSON.parse(readFileSync(textPath(id), 'utf8')) as SurahText;
}

export function getSurahTimings(id: number): SurahTimings {
  return JSON.parse(
    readFileSync(
      path.join(process.cwd(), 'public', 'timings', 'abdulbasit-murattal', `${id}.json`),
      'utf8',
    ),
  ) as SurahTimings;
}
