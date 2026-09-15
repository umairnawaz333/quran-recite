import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  loadTimings, primeTimings, resetTimingsCache, configureTimings,
} from '../src/player/timingsLoader';
import type { TimingsStore } from '../src/player/timingsLoader';
import type { SurahTimings } from '../src/data/types';

const fake = (surah: number): SurahTimings => ({
  surah, reciterId: 'abdulbasit-murattal', surahDurationMs: 1000,
  ayahs: [{ ayah: 1, audioUrl: '/audio/abdulbasit-murattal/001001.mp3', startOffsetMs: 0, durationMs: 1000, words: [] }],
});

describe('timingsLoader', () => {
  beforeEach(() => { resetTimingsCache(); });
  afterEach(() => { vi.restoreAllMocks(); resetTimingsCache(); });

  it('fetches a surah and returns its timings', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => fake(2) });
    vi.stubGlobal('fetch', fetchMock);

    const got = await loadTimings(2);
    expect(got.surah).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith('/timings/abdulbasit-murattal/2.json');
  });

  it('memoises so a second load makes no request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => fake(2) });
    vi.stubGlobal('fetch', fetchMock);

    await loadTimings(2);
    await loadTimings(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Two callers racing must share one request, not fire two.
  it('dedupes concurrent loads of the same surah', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => fake(3) });
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([loadTimings(3), loadTimings(3)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('primed timings are returned without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    primeTimings(5, fake(5));
    const got = await loadTimings(5);
    expect(got.surah).toBe(5);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects on a failed response and does not cache the failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, json: async () => fake(9) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadTimings(9)).rejects.toThrow();
    await expect(loadTimings(9)).resolves.toMatchObject({ surah: 9 });
  });

  it('consults a configured store before the network and short-circuits the fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const store: TimingsStore = {
      read: vi.fn(async () => fake(6)),
      write: vi.fn(async () => {}),
    };
    configureTimings({ store });

    const got = await loadTimings(6);
    expect(got.surah).toBe(6);
    expect(store.read).toHaveBeenCalledWith(6);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not write a failed fetch to the store', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);

    const store: TimingsStore = {
      read: vi.fn(async () => null),
      write: vi.fn(async () => {}),
    };
    configureTimings({ store });

    await expect(loadTimings(7)).rejects.toThrow();
    expect(store.write).not.toHaveBeenCalled();
  });
});
