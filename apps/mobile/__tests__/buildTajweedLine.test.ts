import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTajweedLine } from '../src/reader/buildTajweedLine';

/**
 * Al-Fatihah's real tajweed markup, read straight from the data file rather
 * than hand-copied into a fixture. A hand-copied fixture can silently drift
 * from the real markup (that happened here once already — see the fix
 * report for this round) and the whole point of this suite is to exercise
 * the real adjacent-run structure words like 1:1:3 have, where one rule's
 * closing tag is immediately followed by another rule's opening tag with no
 * plain text between them. That structure is exactly what offset arithmetic
 * can get wrong, so the test must run against the real thing.
 *
 * Expected Arabic substrings below are likewise never hand-typed — Arabic
 * combining marks are easy to get byte-for-byte wrong while looking
 * identical on screen — they are derived from this same markup by stripping
 * the `<rule>` tags, so a comparison can only fail for a real reason.
 */
const AL_FATIHAH_PATH = path.resolve(
  import.meta.dirname,
  '../../../packages/quran-data/text/1.json',
);
const AL_FATIHAH: { ayahs: { ayah: number; words: { id: string; tajweed: string }[] }[] } =
  JSON.parse(readFileSync(AL_FATIHAH_PATH, 'utf-8'));

const AYAH_1 = AL_FATIHAH.ayahs.find(a => a.ayah === 1);
if (!AYAH_1) throw new Error('Fixture setup: Al-Fatihah ayah 1 not found in packages/quran-data');

// "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ" — the four words of the Bismillah.
const BISMILLAH = AYAH_1.words.slice(0, 4).map(w => ({ id: w.id, tajweed: w.tajweed }));
const WORD_3 = BISMILLAH[2]; // 1:1:3 — ٱلرَّحْمَـٰنِ

/** The word's visible text with every `<rule>`/`</rule>` tag stripped — the
 * same string `buildTajweedLine` concatenates into `text`, computed
 * independently of it. */
const plainTextOf = (tajweed: string) => tajweed.replace(/<\/?rule[^>]*>/g, '');

/** The ayah-number marker's colour comes from the theme's `palette.textMuted`
 * (see `theme.tsx`); these tests pass their own so a hard-coded grey cannot
 * pass for it. */
const MUTED = '#777777';

describe('buildTajweedLine', () => {
  it('concatenates every word into one string, space-joined, with the ﴿n﴾ marker last', () => {
    const { text } = buildTajweedLine(BISMILLAH, 1, null, MUTED);
    const expected = `${BISMILLAH.map(w => plainTextOf(w.tajweed)).join(' ')}  ﴿1﴾`;
    expect(text).toBe(expected);
  });

  it('never inserts anything between a run and the next run of the SAME word', () => {
    // The join this task exists to fix breaks exactly here: a space (or any
    // other character) between "ٱل" and "رَّحْمَـٰنِ" would be exactly the kind
    // of gap a nested-<Text> boundary used to leave on Android.
    const { text } = buildTajweedLine(BISMILLAH, 1, null, MUTED);
    const word3 = plainTextOf(WORD_3.tajweed);
    expect(text).toContain(word3);
    // The word's first two characters (ٱ, ل) are each their own coloured
    // run; a space inserted at that specific boundary is the exact bug this
    // guards against.
    const withInjectedGap = `${word3.slice(0, 2)} ${word3.slice(2)}`;
    expect(text).not.toContain(withInjectedGap);
  });

  it('applies the exact range sequence for 1:1:3, whose rules have no plain text between them', () => {
    // Real markup: <rule class=ham_wasl>ٱ</rule><rule class=laam_shamsiyah>ل</rule>رَّحْمَ<rule class=madda_normal>ـٰ</rule>نِ
    // — ham_wasl's closing tag is immediately followed by laam_shamsiyah's
    // opening tag, so these two coloured runs are adjacent with zero-length
    // plain text between them. This is the hardest case for offset
    // arithmetic (see the fix report for this round) and the one the
    // previous version of this fixture accidentally dropped.
    const { text, ranges } = buildTajweedLine(BISMILLAH, 1, null, MUTED);
    const word3 = plainTextOf(WORD_3.tajweed);
    const wordStart = text.indexOf(word3);
    expect(wordStart).toBeGreaterThanOrEqual(0);
    const wordEnd = wordStart + word3.length;

    const wordRanges = ranges.filter(r => r.start >= wordStart && r.end <= wordEnd);
    expect(wordRanges).toEqual([
      { start: wordStart, end: wordStart + 1, color: '#6b7280' }, // ٱ — ham_wasl
      { start: wordStart + 1, end: wordStart + 2, color: '#6b7280' }, // ل — laam_shamsiyah
      { start: wordStart + 9, end: wordStart + 11, color: '#1d4ed8' }, // ـٰ — madda_normal
    ]);

    // The two uncoloured stretches the ranges above skip over — "رَّحْمَ"
    // between the grey runs and the blue one, and "نِ" after it — must
    // still be present, unbroken, in the final string.
    expect(text.slice(wordStart + 2, wordStart + 9)).toBe(word3.slice(2, 9));
    expect(text.slice(wordStart + 11, wordEnd)).toBe(word3.slice(11));
  });

  it('every range points at the substring it claims to colour', () => {
    const { text, ranges } = buildTajweedLine(BISMILLAH, 1, null, MUTED);
    for (const range of ranges) {
      expect(range.start).toBeLessThan(range.end);
      expect(range.end).toBeLessThanOrEqual(text.length);
    }
    // The three ham_wasl-rule alifs (ٱ), one each in words 2, 3 and 4 — word
    // 1 ("بِسْمِ") carries no rule at all in the real markup, so it
    // contributes no range.
    const alef = plainTextOf(BISMILLAH[1].tajweed)[0];
    const hamWaslRuns = ranges.filter(r => text.slice(r.start, r.end) === alef);
    expect(hamWaslRuns).toHaveLength(3);
  });

  it('colours the trailing ayah-number marker with the colour it is GIVEN, not a constant', () => {
    const { text, ranges } = buildTajweedLine(BISMILLAH, 1, null, MUTED);
    const last = ranges[ranges.length - 1];
    expect(text.slice(last.start, last.end)).toBe('  ﴿1﴾');
    expect(last.color).toBe(MUTED);

    // The dark scheme's muted grey: the marker follows the theme, so the
    // same ayah built under the other scheme carries the other colour.
    const dark = buildTajweedLine(BISMILLAH, 1, null, '#9ca3af');
    const darkLast = dark.ranges[dark.ranges.length - 1];
    expect(darkLast.color).toBe('#9ca3af');
    expect(darkLast).toEqual({ ...last, color: '#9ca3af' });
  });

  it('computes the highlight from the active word\'s own offsets, not a fixed position', () => {
    const { text, highlight } = buildTajweedLine(BISMILLAH, 1, WORD_3.id, MUTED);
    expect(highlight).not.toBeNull();
    expect(text.slice(highlight!.start, highlight!.end)).toBe(plainTextOf(WORD_3.tajweed));
  });

  it('has no highlight when the active word belongs to a different ayah', () => {
    const { highlight } = buildTajweedLine(BISMILLAH, 1, '2:5:1', MUTED);
    expect(highlight).toBeNull();
  });
});
