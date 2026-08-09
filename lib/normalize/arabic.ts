/**
 * Arabic marks that do not represent a recited letter.
 * - U+064B–U+0655: tanween, harakat, shadda, sukun, maddah, hamza above/below
 * - U+0670: superscript (dagger) alef
 * - U+06D6–U+06ED: Quranic annotation marks (small high seen, sajdah, etc.)
 * - U+0640: tatweel (kashida) — a stretching glyph, not a letter
 */
const NON_LETTER_MARKS = /[ً-ٰٕۖ-ۭـ]/g;

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

/** Marks that lengthen a vowel: superscript (dagger) alef (U+0670), and maddah (U+0653). */
const LONG_VOWEL_MARKS = /[\u0670\u0653]/g;

/**
 * Weight used to apportion a shared audio segment across words.
 *
 * Base letters plus elongation marks: a long vowel takes real time to recite,
 * so it counts here even though it is not a letter.
 */
export function countRecitationWeight(text: string): number {
  const plain = text.replace(HTML_TAG, '');
  const elongations = (plain.match(LONG_VOWEL_MARKS) ?? []).length;
  return countBaseLetters(text) + elongations;
}

/**
 * Quran.com's IndoPak text embeds Private Use Area characters (U+E000–U+F8FF)
 * that only render in their own proprietary IndoPak font. In any other font
 * they appear as tofu boxes — 1,363 words across all 114 surahs are affected.
 *
 * They are safe to drop: they are decorative glyph variants, and the standard
 * Unicode waqf marks they accompany (U+06D6–U+06ED) are present separately and
 * render correctly. The Uthmani/tajweed text contains none of them.
 */
const PRIVATE_USE = /[\uE000-\uF8FF]/g;

export function stripPrivateUse(text: string): string {
  return text.replace(PRIVATE_USE, '');
}
