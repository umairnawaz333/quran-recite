import { describe, it, expect } from 'vitest';
import { countBaseLetters, stripPrivateUse, countRecitationWeight } from '../arabic';

describe('countBaseLetters', () => {
  it('counts plain letters', () => {
    expect(countBaseLetters('بسم')).toBe(3);
  });

  it('ignores fatha, kasra, sukun and shadda', () => {
    // بِسْمِ — 3 letters, 3 marks
    expect(countBaseLetters('بِسْمِ')).toBe(3);
  });

  it('ignores superscript alef and Quranic annotation marks', () => {
    // ٱلرَّحۡمَـٰنِ — hamzat wasl + ل ر ح م ـٰ ن
    expect(countBaseLetters('ٱلرَّحۡمَـٰنِ')).toBe(6);
  });

  it('ignores tatweel', () => {
    expect(countBaseLetters('بــســم')).toBe(3);
  });

  it('strips HTML tajweed rule markup before counting', () => {
    expect(countBaseLetters('<rule class=ham_wasl>ٱ</rule>للَّهِ')).toBe(4);
  });

  it('returns 0 for an empty string', () => {
    expect(countBaseLetters('')).toBe(0);
  });

  it('never returns 0 for a string containing only marks', () => {
    expect(countBaseLetters('ِّ')).toBe(0);
  });

  it('counts dotless beh and dotless qaf as letters', () => {
    expect(countBaseLetters('ٮٯ')).toBe(2);
  });

  it('does not silently delete Arabic-Indic digits', () => {
    expect(countBaseLetters('٠١')).toBe(2);
  });

  it('strips IndoPak sukun U+06E1', () => {
    // بِسۡمِ — b + i (mark) + s + INDOPAK_SUKUN + m + i (mark)
    expect(countBaseLetters('بِسۡمِ')).toBe(3);
  });
});

describe('countRecitationWeight', () => {
  // Real data: surah 1 ayah 4 — مَـٰلِكِ يَوۡمِ ٱلدِّينِ
  it('counts a dagger-alef elongation as extra weight: مَـٰلِكِ = 3 letters + 1', () => {
    expect(countRecitationWeight('مَـٰلِكِ')).toBe(4);
  });

  it('agrees with the letter count when there is no elongation: يَوۡمِ = 3', () => {
    expect(countRecitationWeight('يَوۡمِ')).toBe(3);
  });

  it('counts shadda-lengthened ٱلدِّينِ = 5', () => {
    expect(countRecitationWeight('ٱلدِّينِ')).toBe(5);
  });

  it('agrees with countBaseLetters when no elongation mark is present', () => {
    const text = 'بِسۡمِ';
    expect(countRecitationWeight(text)).toBe(countBaseLetters(text));
  });
});

describe('stripPrivateUse', () => {
  const cps = (t: string) => [...t].map(c => c.codePointAt(0)!);

  it('removes Private Use Area characters', () => {
    // Real data: word 1:7:9 carried U+E022, which rendered as a tofu box.
    const input = '\u0646\u064E\uE022';
    expect(cps(stripPrivateUse(input))).toEqual([0x0646, 0x064e]);
  });

  it('keeps genuine Unicode waqf marks sitting beside them', () => {
    // From 1:7:4 — U+E021 must go, U+06D9 must stay.
    const input = '\u0645\u06E1\uE021\u06D9';
    expect(cps(stripPrivateUse(input))).toEqual([0x0645, 0x06e1, 0x06d9]);
  });

  it('covers the whole PUA block, not just the codepoints seen so far', () => {
    expect(stripPrivateUse('\uE000a\uF8FF')).toBe('a');
  });

  it('leaves ordinary Arabic untouched', () => {
    const word = '\u0628\u0650\u0633\u06E1\u0645\u0650';
    expect(stripPrivateUse(word)).toBe(word);
  });

  it('handles an empty string', () => {
    expect(stripPrivateUse('')).toBe('');
  });
});
