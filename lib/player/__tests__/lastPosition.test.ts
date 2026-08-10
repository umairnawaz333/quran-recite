import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readLastPosition, writeLastPosition, clearLastPosition, isValidPosition } from '../lastPosition';

const KEY = 'quran.lastPosition';

describe('lastPosition', () => {
  beforeEach(() => localStorage.clear());

  it('the test environment provides working storage', () => {
    localStorage.setItem('__probe__', 'x');
    expect(localStorage.getItem('__probe__')).toBe('x');
    localStorage.removeItem('__probe__');
    expect(localStorage.getItem('__probe__')).toBeNull();
  });

  it('returns null when nothing is stored', () => {
    expect(readLastPosition()).toBeNull();
  });

  it('round-trips a position', () => {
    writeLastPosition({ surahId: 2, ayah: 45, localMs: 1500 });
    const got = readLastPosition();
    expect(got?.surahId).toBe(2);
    expect(got?.ayah).toBe(45);
    expect(got?.localMs).toBe(1500);
  });

  it('stamps updatedAt', () => {
    writeLastPosition({ surahId: 1, ayah: 1, localMs: 0 });
    expect(readLastPosition()!.updatedAt).toBeGreaterThan(0);
  });

  // A corrupt entry must never break the page that reads it.
  it('returns null for malformed JSON', () => {
    localStorage.setItem(KEY, 'not json{');
    expect(readLastPosition()).toBeNull();
  });

  it('returns null when fields are missing or the wrong type', () => {
    localStorage.setItem(KEY, JSON.stringify({ surahId: 'two', ayah: 1, localMs: 0 }));
    expect(readLastPosition()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ ayah: 1, localMs: 0 }));
    expect(readLastPosition()).toBeNull();
  });

  it('rejects out-of-range surah ids', () => {
    localStorage.setItem(KEY, JSON.stringify({ surahId: 0, ayah: 1, localMs: 0, updatedAt: 1 }));
    expect(readLastPosition()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ surahId: 115, ayah: 1, localMs: 0, updatedAt: 1 }));
    expect(readLastPosition()).toBeNull();
  });

  it('rejects a non-positive ayah', () => {
    localStorage.setItem(KEY, JSON.stringify({ surahId: 1, ayah: 0, localMs: 0, updatedAt: 1 }));
    expect(readLastPosition()).toBeNull();
  });

  it('clears', () => {
    writeLastPosition({ surahId: 3, ayah: 7, localMs: 10 });
    clearLastPosition();
    expect(readLastPosition()).toBeNull();
  });

  it('survives localStorage throwing', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => writeLastPosition({ surahId: 1, ayah: 1, localMs: 0 })).not.toThrow();
    spy.mockRestore();
  });

  it('rejects fractional ayah', () => {
    localStorage.setItem(KEY, JSON.stringify({ surahId: 1, ayah: 1.5, localMs: 0, updatedAt: 1 }));
    expect(readLastPosition()).toBeNull();
  });

  it('rejects fractional surahId', () => {
    localStorage.setItem(KEY, JSON.stringify({ surahId: 2.5, ayah: 1, localMs: 0, updatedAt: 1 }));
    expect(readLastPosition()).toBeNull();
  });

  // JSON has no representation for NaN/Infinity — JSON.stringify turns both
  // into `null`, so a value stored via localStorage can never actually carry
  // a NaN or Infinity field. These three exercise that real-world path: the
  // field arrives as `null` and is rejected by the pre-existing `typeof
  // v.x === 'number'` check, not by Number.isFinite.
  it('rejects a stored null localMs', () => {
    localStorage.setItem(KEY, JSON.stringify({ surahId: 1, ayah: 1, localMs: null, updatedAt: 1 }));
    expect(readLastPosition()).toBeNull();
  });

  it('rejects a stored null updatedAt', () => {
    localStorage.setItem(KEY, JSON.stringify({ surahId: 1, ayah: 1, localMs: 0, updatedAt: null }));
    expect(readLastPosition()).toBeNull();
  });

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
});
