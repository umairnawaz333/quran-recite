import { parseTajweed } from '@quran/core';
import { colourFor } from './tajweedColours';
// Relative, not by package name — see the same import in TajweedLine.tsx for
// why: this local Expo module has no package.json to resolve by name.
import type { ColorRange, HighlightRange } from '../../modules/tajweed-text/src';

export interface TajweedLineWord {
  id: string;
  tajweed: string;
}

/** Where one word landed in `text`, so a tapped character offset can be
 * resolved back to the word it belongs to. */
export interface WordRange {
  id: string;
  start: number;
  end: number;
}

export interface TajweedLineContent {
  text: string;
  ranges: ColorRange[];
  highlight: HighlightRange | null;
  words: WordRange[];
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
  /**
   * The trailing ﴿n﴾ marker's colour — the theme's `palette.textMuted`,
   * passed in rather than named here, because the marker is drawn as an
   * ordinary `ForegroundColorSpan` in this line's ranges and so has to
   * follow the light/dark scheme like every other colour (see `theme.tsx`:
   * colours live only there). Required on purpose: a default would let a
   * fixed grey survive a scheme change unnoticed.
   */
  ayahNumberColor: string,
): TajweedLineContent {
  let text = '';
  const ranges: ColorRange[] = [];
  const wordRanges: WordRange[] = [];
  let highlight: HighlightRange | null = null;

  words.forEach((word, i) => {
    const wordStart = text.length;
    for (const run of parseTajweed(word.tajweed)) {
      const runStart = text.length;
      text += run.text;
      const colour = colourFor(run.rules);
      if (colour) ranges.push({ start: runStart, end: text.length, color: colour });
    }
    wordRanges.push({ id: word.id, start: wordStart, end: text.length });
    if (word.id === activeWordId) {
      highlight = { start: wordStart, end: text.length };
    }
    if (i < words.length - 1) text += ' ';
  });

  const numberStart = text.length;
  text += `  ﴿${ayahNumber}﴾`;
  ranges.push({ start: numberStart, end: text.length, color: ayahNumberColor });

  return { text, ranges, highlight, words: wordRanges };
}
