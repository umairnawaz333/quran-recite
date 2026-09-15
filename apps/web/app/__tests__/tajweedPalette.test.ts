import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Every tajweed rule in the data must have a colour.
 *
 * Three did not — `qalaqah`, `madda_obligatory_mottasel` and
 * `madda_obligatory_monfasel` — because the stylesheet spelled them
 * differently, so ~9,000 words rendered uncoloured in production with nothing
 * failing. A palette is only correct relative to the data it styles, so the
 * two are compared here rather than by eye.
 */
const PRESENTATIONAL = new Set(['custom-alef-maksora']);

describe('tajweed palette', () => {
  it('styles every rule class present in the text', () => {
    const textDir = path.resolve(import.meta.dirname, '../../../../packages/quran-data/text');
    const inData = new Set<string>();
    for (const file of readdirSync(textDir)) {
      const surah = JSON.parse(readFileSync(path.join(textDir, file), 'utf8'));
      for (const ayah of surah.ayahs) {
        for (const word of ayah.words) {
          for (const m of word.tajweed.matchAll(/<rule class=([A-Za-z_-]+)>/g)) {
            inData.add(m[1]);
          }
        }
      }
    }

    const css = readFileSync(path.resolve(import.meta.dirname, '../globals.css'), 'utf8');
    const styled = new Set([...css.matchAll(/rule\.([A-Za-z_-]+)/g)].map(m => m[1]));

    const unstyled = [...inData].filter(r => !styled.has(r) && !PRESENTATIONAL.has(r));
    expect(unstyled).toEqual([]);
  });
});
