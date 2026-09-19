import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { getSurahList } from '../src/data/surahs';

const ASSET = new URL('../modules/car-media/android/src/main/assets/car-library.json', import.meta.url);

describe('car-library.json', () => {
  it('is exactly the surah list the app uses, in the shape the car service reads', () => {
    const asset = JSON.parse(readFileSync(ASSET, 'utf8'));
    const expected = getSurahList().map(({ id, nameSimple, nameArabic, nameEnglish, ayahCount }) =>
      ({ id, nameSimple, nameArabic, nameEnglish, ayahCount }));
    expect(asset).toEqual(expected);
    expect(asset).toHaveLength(114);
  });
});
