import type { StyleProp, ViewStyle } from 'react-native';

/**
 * A tajweed colour applied to `text.slice(start, end)`. Character offsets
 * into the ONE string the whole ayah is built from — never word indices —
 * because the native side applies these as `ForegroundColorSpan`s directly
 * over that string. See `TajweedLine.tsx`, the only place these are built.
 */
export interface ColorRange {
  start: number;
  end: number;
  color: string;
}

/**
 * The recited word's character range. Drawn as a `BackgroundColorSpan` on
 * the native side, and ONLY that — never a text-colour change, since the
 * tajweed colours underneath must stay visible while a word is playing.
 */
export interface HighlightRange {
  start: number;
  end: number;
}

export interface TajweedTextViewProps {
  /**
   * The whole line as ONE string. Never split it — every offset in `ranges`
   * and `highlight` is a character index into this exact string, and the
   * native view builds a single `SpannableString` from it so Android shapes
   * it as one run (see the module README... there isn't one — see
   * `TajweedTextView.kt`'s class doc for why this is load-bearing).
   */
  text: string;
  /** Tajweed colour spans over character ranges of `text`. */
  ranges: ColorRange[];
  /** The currently-recited word's range, or `null` when nothing is active. */
  highlight: HighlightRange | null;
  /** Resolved on the native side: first the family registered by
   * `expo-font` (see `fonts.ts`), falling back to the Amiri Quran asset
   * bundled with this module. See `TajweedTextView.kt`. */
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  /** The base text colour for any character `ranges` doesn't cover. */
  color: string;
  style?: StyleProp<ViewStyle>;
}
