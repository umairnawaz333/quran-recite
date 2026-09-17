import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { RULE_COLOURS } from '../src/reader/tajweedColours';

/**
 * Every tajweed rule in the data must have a colour on mobile too.
 *
 * The web learned this the hard way: three rule classes were spelled
 * differently in its stylesheet and ~9,000 words rendered uncoloured in
 * production with nothing failing. The mobile palette is a hand-copy of the
 * corrected web palette, so the same drift is possible here and is guarded
 * the same way — against the data, not by eye.
 */
const PRESENTATIONAL = new Set(['custom-alef-maksora']);

describe('mobile tajweed palette', () => {
  it('colours every rule class present in the text', () => {
    const textDir = path.resolve(import.meta.dirname, '../../../packages/quran-data/text');
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

    const uncoloured = [...inData].filter(r => !(r in RULE_COLOURS) && !PRESENTATIONAL.has(r));
    expect(uncoloured).toEqual([]);
  });
});
