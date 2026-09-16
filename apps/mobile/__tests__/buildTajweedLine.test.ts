import { describe, expect, it } from 'vitest';
import { buildTajweedLine } from '../src/reader/buildTajweedLine';

// Bismillah, split into words the way the generated text data does, each
// carrying Quran.com's tajweed markup.
const BISMILLAH = [
  { id: '1:1:1', tajweed: '<rule class=ham_wasl>ب</rule>ِسْمِ' },
  { id: '1:1:2', tajweed: '<rule class=ham_wasl>ٱ</rule>للَّهِ' },
  { id: '1:1:3', tajweed: '<rule class=ham_wasl>ٱ</rule>لرَّحْمَـٰنِ' },
  { id: '1:1:4', tajweed: '<rule class=ham_wasl>ٱ</rule>لرَّحِيمِ' },
];

describe('buildTajweedLine', () => {
  it('concatenates every word into one string, space-joined, with the ﴿n﴾ marker last', () => {
    const { text } = buildTajweedLine(BISMILLAH, 1, null);
    expect(text).toBe('بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ  ﴿1﴾');
  });

  it('never inserts anything between a run and the next run of the SAME word', () => {
    // The join this task exists to fix breaks exactly here: a space (or any
    // other character) between "ٱل" and "رَّحْمَـٰنِ" would be exactly the kind
    // of gap a nested-<Text> boundary used to leave on Android.
    const { text } = buildTajweedLine(BISMILLAH, 1, null);
    expect(text).toContain('ٱلرَّحْمَـٰنِ');
    expect(text).not.toContain('ٱل رَّحْمَـٰنِ');
  });

  it('every range points at the substring it claims to colour', () => {
    const { text, ranges } = buildTajweedLine(BISMILLAH, 1, null);
    for (const range of ranges) {
      expect(range.start).toBeLessThan(range.end);
      expect(range.end).toBeLessThanOrEqual(text.length);
    }
    // The four leading "ham_wasl" alifs are each their own coloured run.
    const hamWaslRuns = ranges.filter(r => text.slice(r.start, r.end) === 'ٱ');
    expect(hamWaslRuns).toHaveLength(3); // "ب" (word 1) has no rule and gets no range
  });

  it('colours the trailing ayah-number marker, appended after the last word', () => {
    const { text, ranges } = buildTajweedLine(BISMILLAH, 1, null);
    const last = ranges[ranges.length - 1];
    expect(text.slice(last.start, last.end)).toBe('  ﴿1﴾');
    expect(last.color).toBe('#999999');
  });

  it('computes the highlight from the active word\'s own offsets, not a fixed position', () => {
    const { text, highlight } = buildTajweedLine(BISMILLAH, 1, '1:1:3');
    expect(highlight).not.toBeNull();
    expect(text.slice(highlight!.start, highlight!.end)).toBe('ٱلرَّحْمَـٰنِ');
  });

  it('has no highlight when the active word belongs to a different ayah', () => {
    const { highlight } = buildTajweedLine(BISMILLAH, 1, '2:5:1');
    expect(highlight).toBeNull();
  });
});
