import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readLastPosition, writeLastPosition, clearLastPosition } from '../lastPosition';

const KEY = 'quran.lastPosition';

describe('lastPosition', () => {
  beforeEach(() => localStorage.clear());

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

  it('rejects NaN localMs', () => {
    localStorage.setItem(KEY, JSON.stringify({ surahId: 1, ayah: 1, localMs: NaN, updatedAt: 1 }));
    expect(readLastPosition()).toBeNull();
  });

  it('rejects Infinity localMs', () => {
    localStorage.setItem(KEY, JSON.stringify({ surahId: 1, ayah: 1, localMs: Infinity, updatedAt: 1 }));
    expect(readLastPosition()).toBeNull();
  });

  it('rejects NaN updatedAt', () => {
    localStorage.setItem(KEY, JSON.stringify({ surahId: 1, ayah: 1, localMs: 0, updatedAt: NaN }));
    expect(readLastPosition()).toBeNull();
  });
});
