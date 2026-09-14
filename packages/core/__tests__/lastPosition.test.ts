import { describe, it, expect } from 'vitest';
import { isValidPosition } from '../src/player/lastPosition';

// Genuine NaN/Infinity values can only be reached by calling the validator
// directly, since JSON.parse can never produce them. These are the actual
// coverage for the Number.isFinite guards.
describe('isValidPosition (direct — the only way to reach NaN/Infinity)', () => {
  it('rejects NaN localMs', () => {
    expect(isValidPosition({ surahId: 1, ayah: 1, localMs: NaN, updatedAt: 1 })).toBe(false);
  });

  it('rejects Infinity localMs', () => {
    expect(isValidPosition({ surahId: 1, ayah: 1, localMs: Infinity, updatedAt: 1 })).toBe(false);
  });

  it('rejects NaN updatedAt', () => {
    expect(isValidPosition({ surahId: 1, ayah: 1, localMs: 0, updatedAt: NaN })).toBe(false);
  });

  it('rejects Infinity updatedAt', () => {
    expect(isValidPosition({ surahId: 1, ayah: 1, localMs: 0, updatedAt: Infinity })).toBe(false);
  });

  it('accepts a genuinely valid position', () => {
    expect(isValidPosition({ surahId: 1, ayah: 1, localMs: 0, updatedAt: 1 })).toBe(true);
  });
});
