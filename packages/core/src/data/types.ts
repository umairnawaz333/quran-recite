import type { WordTiming } from '../normalize/types';

export interface SurahMeta {
  id: number;
  nameArabic: string;
  nameSimple: string;
  nameEnglish: string;
  ayahCount: number;
  revelationPlace: string;
  /** False until this surah's data has been fetched. */
  available: boolean;
}

export interface SurahWord {
  /** "surah:ayah:position" */
  id: string;
  position: number;
  /** Tajweed markup, may contain <rule class="..."> elements. */
  tajweed: string;
  indopak: string;
}

export interface SurahText {
  surah: number;
  ayahs: { ayah: number; words: SurahWord[] }[];
}

export interface AyahTiming {
  ayah: number;
  /** Local path, e.g. "/audio/abdulbasit-murattal/001001.mp3". */
  audioUrl: string;
  /** Where this ayah begins on the global surah timeline. */
  startOffsetMs: number;
  /** Seeded from the API's integer seconds; corrected at runtime. */
  durationMs: number;
  words: WordTiming[];
}

export interface SurahTimings {
  surah: number;
  reciterId: string;
  surahDurationMs: number;
  ayahs: AyahTiming[];
}

export type { WordTiming };
