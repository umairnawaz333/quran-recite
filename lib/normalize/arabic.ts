/**
 * Arabic marks that do not represent a recited letter.
 * - U+064B–U+0652: tanween, harakat, shadda, sukun
 * - U+0653–U+0655: maddah and hamza above/below
 * - U+0670: superscript (dagger) alef
 * - U+06D6–U+06ED: Quranic annotation marks (small high seen, sajdah, etc.)
 * - U+0640: tatweel (kashida) — a stretching glyph, not a letter
 */
const NON_LETTER_MARKS = /[ً-ْٓ-ٰٕۖ-ۭـ]/g;

const HTML_TAG = /<[^>]*>/g;

/**
 * Counts recited base letters, ignoring diacritics and markup.
 * Used to apportion a merged audio segment across the words it covers.
 */
export function countBaseLetters(text: string): number {
  return text
    .replace(HTML_TAG, '')
    .replace(NON_LETTER_MARKS, '')
    .replace(/\s+/g, '').length;
}
