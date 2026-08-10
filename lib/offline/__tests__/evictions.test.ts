import { describe, it, expect } from 'vitest';
import { selectEvictions, RUNTIME_BUDGET_BYTES } from '../evictions';

const e = (url: string, size: number, lastUsed: number) => ({ url, size, lastUsed });

describe('selectEvictions', () => {
  it('evicts nothing when under budget', () => {
    expect(selectEvictions([e('a', 10, 1), e('b', 10, 2)], 100)).toEqual([]);
  });

  it('evicts nothing when exactly at budget', () => {
    expect(selectEvictions([e('a', 50, 1), e('b', 50, 2)], 100)).toEqual([]);
  });

  it('evicts the least recently used first', () => {
    const entries = [e('new', 60, 300), e('old', 60, 100), e('mid', 60, 200)];
    expect(selectEvictions(entries, 100)).toEqual(['old', 'mid']);
  });

  it('stops as soon as it is back under budget', () => {
    const entries = [e('old', 80, 100), e('new', 10, 200)];
    // Removing 'old' alone brings 90 down to 10.
    expect(selectEvictions(entries, 50)).toEqual(['old']);
  });

  it('handles an empty cache', () => {
    expect(selectEvictions([], 100)).toEqual([]);
  });

  it('evicts everything when a single entry still exceeds the budget', () => {
    expect(selectEvictions([e('huge', 500, 1)], 100)).toEqual(['huge']);
  });

  it('breaks lastUsed ties deterministically by url', () => {
    const entries = [e('b', 60, 100), e('a', 60, 100)];
    expect(selectEvictions(entries, 60)).toEqual(['a']);
  });

  it('exposes a 100 MB budget', () => {
    expect(RUNTIME_BUDGET_BYTES).toBe(104857600);
  });
});
