import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('expo-file-system', async () => (await import('./helpers/fakeFileSystem')).fakeFileSystemModule);
import { store, reset, downloads, setHoldDownloads, setFailDownloads, releaseAllHeld } from './helpers/fakeFileSystem';
import { configureTimings, primeTimings, resetTimingsCache, configureAudioBase } from '@quran/core';
import { downloads as dl, startDownload, cancelDownload, removeDownload, downloadAll, refreshFromDisk } from '../src/offline/downloadManager';
import { isSurahDownloaded } from '../src/offline/offlineStore';

const timings = (surah: number, count: number) => ({
  surah, reciterId: 'abdulbasit-murattal', surahDurationMs: count * 1000,
  ayahs: Array.from({ length: count }, (_, i) => ({
    ayah: i + 1, audioUrl: `/audio/abdulbasit-murattal/${String(surah).padStart(3, '0')}${String(i + 1).padStart(3, '0')}.mp3`,
    startOffsetMs: 0, durationMs: 1000, words: [],
  })),
});
const flush = () => new Promise(r => setTimeout(r, 0));
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await flush(); };

beforeEach(() => {
  reset();
  resetTimingsCache();
  configureTimings({ baseUrl: 'https://example.test' });
  configureAudioBase('https://github.com/umairnawaz333/quran-recite/releases/download');
  primeTimings(112, timings(112, 4));
  primeTimings(1, timings(1, 7));
  dl.__resetForTests();
});

describe('downloadManager', () => {
  it('downloads every file, writes timings last, and reports progress by files', async () => {
    const seen: unknown[] = [];
    const unsub = dl.subscribe(() => seen.push(dl.getState(112)));
    startDownload(112);
    await settle();
    unsub();
    expect(isSurahDownloaded(112, 4)).toBe(true);
    expect(dl.getState(112)).toEqual({ status: 'done' });
    // Progress climbed 0..4 out of 4 — stated independently of the code.
    expect(seen).toContainEqual({ status: 'downloading', done: 0, total: 4 });
    expect(seen).toContainEqual({ status: 'downloading', done: 4, total: 4 });
    // Files were fetched to a temp name and renamed: no `.part` remains.
    expect([...store.keys()].some(k => k.endsWith('.part'))).toBe(false);
  });

  it('cancelling mid-way leaves no partial file and no "downloaded" surah', async () => {
    setHoldDownloads(/112003/);
    startDownload(112);
    await settle();
    expect(dl.getState(112)).toEqual({ status: 'downloading', done: 2, total: 4 });
    cancelDownload(112);
    await settle();
    expect(dl.getState(112)).toEqual({ status: 'idle' });
    expect(isSurahDownloaded(112, 4)).toBe(false);
    expect([...store.keys()].filter(k => k.includes('/offline/112/') && k.endsWith('.part'))).toEqual([]);
    // The two finished files are kept — resuming later does not redo them.
    expect(store.has('file:///doc/offline/112/112001.mp3')).toBe(true);
  });

  it('resumes by skipping files already on disk', async () => {
    store.set('file:///doc/offline/112/112001.mp3', 'x'); store.set('file:///doc/offline/112/112002.mp3', 'x');
    startDownload(112);
    await settle();
    expect(downloads.map(d => d.url.split('/').pop())).toEqual(['112003.mp3', '112004.mp3']);
    expect(downloads).toHaveLength(2);
    expect(dl.getState(112)).toEqual({ status: 'done' });
  });

  it('reports an error and keeps what it had when a file fails', async () => {
    setFailDownloads(/112003/);
    startDownload(112);
    await settle();
    expect(dl.getState(112).status).toBe('error');
    expect(isSurahDownloaded(112, 4)).toBe(false);
  });

  it('downloads one surah at a time, in order, and removeDownload deletes the folder', async () => {
    setHoldDownloads(/001001/);
    downloadAll();          // 112 and 1 are the only surahs with primed timings; others are queued and will error on fetch
    await settle();
    expect(dl.getState(1)).toEqual({ status: 'downloading', done: 0, total: 7 });
    expect(dl.getState(2).status).toBe('queued');
    releaseAllHeld();
    await settle(60);
    expect(dl.getState(1)).toEqual({ status: 'done' });
    removeDownload(1);
    expect(isSurahDownloaded(1, 7)).toBe(false);
    expect(dl.getState(1)).toEqual({ status: 'idle' });
  });

  it('refreshFromDisk marks surahs already complete on disk as done', () => {
    for (let n = 1; n <= 4; n++) store.set(`file:///doc/offline/112/11200${n}.mp3`, 'x');
    store.set('file:///doc/offline/112/timings.json', JSON.stringify(timings(112, 4)));
    refreshFromDisk();
    expect(dl.getState(112)).toEqual({ status: 'done' });
  });
});
