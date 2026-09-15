import surahs from '@quran/data/surahs.json';
import type { SurahMeta } from '@quran/core';

export function getSurahList(): SurahMeta[] {
  return surahs as SurahMeta[];
}

export function getSurahMeta(id: number): SurahMeta | undefined {
  return getSurahList().find(s => s.id === id);
}
