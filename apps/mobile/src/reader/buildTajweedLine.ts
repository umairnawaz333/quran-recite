import { parseTajweed } from '@quran/core';
import { colourFor } from './tajweedColours';
import type { ColorRange, HighlightRange } from '../../modules/tajweed-text/src';

/** Matches the web's `.word--active` tint and `ReaderScreen.tsx`'s
 * `styles.highlight` — see `TajweedTextView.kt`'s `HIGHLIGHT_COLOR`, which
 * this mirrors for anyone reading the JS side only. Not passed to the
 * native view: the highlight colour is fixed there, non-configurable, on
 * purpose (see its class doc). */
const AYAH_NUMBER_COLOR = '#999999';

export interface TajweedLineWord {
  id: string;
  tajweed: string;
}

export interface TajweedLineContent {
  text: string;
  ranges: ColorRange[];
  highlight: HighlightRange | null;
}

/**
 * Builds ONE string for the whole ayah — every tajweed word plus the
 * trailing ﴿n﴾ marker — recording each run's character offsets in the same
 * pass that concatenates them. Doing this in a single pass (rather than
 * concatenating first and re-scanning after) is what keeps the offsets and
 * the string from drifting apart.
 *
 * Kept free of any `react-native` import so it can be unit-tested under
 * Node (see `__tests__/buildTajweedLine.test.ts`) and reused verbatim by
 * `TajweedLine`'s Android branch.
 */
export function buildTajweedLine(
  words: TajweedLineWord[],
  ayahNumber: number,
  activeWordId: string | null,
): TajweedLineContent {
  let text = '';
  const ranges: ColorRange[] = [];
  let highlight: HighlightRange | null = null;

  words.forEach((word, i) => {
    const wordStart = text.length;
    for (const run of parseTajweed(word.tajweed)) {
      const runStart = text.length;
      text += run.text;
      const colour = colourFor(run.rules);
      if (colour) ranges.push({ start: runStart, end: text.length, color: colour });
    }
    if (word.id === activeWordId) {
      highlight = { start: wordStart, end: text.length };
    }
    if (i < words.length - 1) text += ' ';
  });

  const numberStart = text.length;
  text += `  ﴿${ayahNumber}﴾`;
  ranges.push({ start: numberStart, end: text.length, color: AYAH_NUMBER_COLOR });

  return { text, ranges, highlight };
}
