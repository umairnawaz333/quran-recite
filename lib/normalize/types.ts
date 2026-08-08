/** [startWordIndex, endWordIndexExclusive, startMs, endMs] — a word RANGE. */
export type RawSegment = [number, number, number, number];

export interface NormalizeWord {
  /** 1-based position within the ayah. */
  position: number;
  /** Text used for proportional splitting. Tajweed markup is fine; it is stripped. */
  text: string;
}

export interface WordTiming {
  /** "surah:ayah:position", e.g. "1:4:2" */
  id: string;
  position: number;
  startMs: number;
  endMs: number;
  /** True when the timing was interpolated rather than read from the source. */
  estimated: boolean;
  /** Present when this word shares a source segment with its neighbours. */
  groupId?: string;
}

export interface NormalizeInput {
  surah: number;
  ayah: number;
  words: NormalizeWord[];
  segments: RawSegment[];
}

export interface NormalizeResult {
  timings: WordTiming[];
  mergedGroups: number;
  interpolatedWords: number;
  uncoveredWords: number;
}
