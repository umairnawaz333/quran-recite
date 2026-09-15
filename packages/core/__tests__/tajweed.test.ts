import { describe, it, expect } from 'vitest';
import { parseTajweed } from '../src/normalize/tajweed';

describe('parseTajweed', () => {
  it('returns a single unruled run for plain text', () => {
    expect(parseTajweed('للَّهِ')).toEqual([{ text: 'للَّهِ', rules: [] }]);
  });

  it('splits a rule from the text that follows it', () => {
    // 1:1:2 in the real data.
    expect(parseTajweed('<rule class=ham_wasl>ٱ</rule>للَّهِ')).toEqual([
      { text: 'ٱ', rules: ['ham_wasl'] },
      { text: 'للَّهِ', rules: [] },
    ]);
  });

  it('keeps sequential rules separate', () => {
    expect(
      parseTajweed('<rule class=ham_wasl>ٱ</rule><rule class=laam_shamsiyah>ل</rule>رَّح'),
    ).toEqual([
      { text: 'ٱ', rules: ['ham_wasl'] },
      { text: 'ل', rules: ['laam_shamsiyah'] },
      { text: 'رَّح', rules: [] },
    ]);
  });

  it('records nested rules outermost first', () => {
    // The shape that occurs 1,321 times: a madda wrapping a glyph substitution.
    expect(
      parseTajweed('<rule class=madda_normal><rule class=custom-alef-maksora>ٰ</rule></rule>'),
    ).toEqual([{ text: 'ٰ', rules: ['madda_normal', 'custom-alef-maksora'] }]);
  });

  it('handles a word mixing nesting, sequence and bare text', () => {
    // 1:6:2, the deepest real word.
    expect(
      parseTajweed(
        '<rule class=ham_wasl>ٱ</rule><rule class=laam_shamsiyah>ل</rule>صِّر' +
          '<rule class=madda_normal><rule class=custom-alef-maksora>ٰ</rule></rule>طَ',
      ),
    ).toEqual([
      { text: 'ٱ', rules: ['ham_wasl'] },
      { text: 'ل', rules: ['laam_shamsiyah'] },
      { text: 'صِّر', rules: [] },
      { text: 'ٰ', rules: ['madda_normal', 'custom-alef-maksora'] },
      { text: 'طَ', rules: [] },
    ]);
  });

  it('emits no empty runs', () => {
    const runs = parseTajweed('<rule class=slnt>ا</rule><rule class=ghunnah>ن</rule>');
    expect(runs.every(r => r.text.length > 0)).toBe(true);
    expect(runs).toHaveLength(2);
  });

  it('returns an empty array for empty input', () => {
    expect(parseTajweed('')).toEqual([]);
  });

  it('treats an unclosed rule as covering the remaining text rather than dropping it', () => {
    // Defensive: never silently lose Quran text to malformed markup.
    expect(parseTajweed('<rule class=ghunnah>نا')).toEqual([
      { text: 'نا', rules: ['ghunnah'] },
    ]);
  });
});
