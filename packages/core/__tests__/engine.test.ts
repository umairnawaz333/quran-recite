import { describe, it, expect } from 'vitest';
import { findActiveWordIndex } from '../src/sync/engine';
import type { WordTiming } from '../src/normalize/types';

const t = (position: number, startMs: number, endMs: number): WordTiming => ({
  id: `1:1:${position}`, position, startMs, endMs, estimated: false,
});

// Real Al-Fatihah 1:1 timings
const WORDS = [t(1, 600, 970), t(2, 980, 1560), t(3, 1570, 2520), t(4, 2530, 3920)];

describe('findActiveWordIndex', () => {
  it('finds the word containing the time', () => {
    expect(findActiveWordIndex(WORDS, 700)).toBe(0);
    expect(findActiveWordIndex(WORDS, 2000)).toBe(2);
  });

  it('is inclusive of startMs and exclusive of endMs', () => {
    expect(findActiveWordIndex(WORDS, 600)).toBe(0);
    expect(findActiveWordIndex(WORDS, 970)).toBe(-1);   // in the gap
    expect(findActiveWordIndex(WORDS, 980)).toBe(1);
  });

  it('returns -1 before the first word (leading silence)', () => {
    expect(findActiveWordIndex(WORDS, 0)).toBe(-1);
    expect(findActiveWordIndex(WORDS, 599)).toBe(-1);
  });

  it('returns -1 after the last word', () => {
    expect(findActiveWordIndex(WORDS, 3920)).toBe(-1);
    expect(findActiveWordIndex(WORDS, 99999)).toBe(-1);
  });

  it('returns -1 for an empty timing list', () => {
    expect(findActiveWordIndex([], 100)).toBe(-1);
  });
});
