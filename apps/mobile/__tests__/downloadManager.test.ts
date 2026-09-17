import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('expo-file-system', async () => (await import('./helpers/fakeFileSystem')).fakeFileSystemModule);
import { store, reset, downloads, setHoldDownloads, setFailDownloads, setFailMovesMatching, releaseAllHeld } from './helpers/fakeFileSystem';
import { configureTimings, primeTimings, resetTimingsCache, configureAudioBase } from '@quran/core';
import type { TimingsStore } from '@quran/core';
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

  it('cancelling while timings are still loading ends idle, not error', async () => {
    // A surah id outside the real 1..114 list — no other test's `downloadAll`
    // traffic can ever land on it, so this is immune to any stray background
    // work another test's queue left running. Its timings are never primed,
    // so loadTimings falls through to the configured store — held pending
    // here until the test rejects it, exactly the window a cancel needs to
    // land in for this to be worth anything.
    const surahId = 9001;
    let rejectTimings: (err: unknown) => void = () => {};
    const pendingStore: TimingsStore = {
      read: () => new Promise((_resolve, reject) => { rejectTimings = reject; }),
      write: async () => {},
    };
    configureTimings({ store: pendingStore });

    startDownload(surahId);
    await flush();
    expect(dl.getState(surahId).status).toBe('downloading');
    cancelDownload(surahId);
    rejectTimings(new Error('timings unavailable'));
    await settle();
    expect(dl.getState(surahId)).toEqual({ status: 'idle' });
  });

  it('a failed rename ends error, with no .part left, and the surah stays not-downloaded', async () => {
    setFailMovesMatching(/112003/);
    startDownload(112);
    await settle();
    expect(dl.getState(112)).toEqual({ status: 'error', message: 'rename failed for 112003.mp3' });
    expect(isSurahDownloaded(112, 4)).toBe(false);
    expect([...store.keys()].some(k => k.includes('/offline/112/') && k.endsWith('.part'))).toBe(false);
  });

  it('cancelling while a failed rename is still in flight ends idle, not error', async () => {
    // The rename for ayah 1 will resolve (one real tick later, per the fake's
    // `move`) without producing the destination. Cancel lands in that window
    // — after the file "downloaded" but before the rename settles — which is
    // exactly the gap the `!final.exists` branch used to report as an error
    // regardless of a pending cancellation.
    setFailMovesMatching(/112001/);
    startDownload(112);
    await flush(); // past loadTimings + downloadAsync (pure microtasks); the rename's own tick has not fired yet
    cancelDownload(112);
    await settle();
    expect(dl.getState(112)).toEqual({ status: 'idle' });
    expect([...store.keys()].some(k => k.includes('/offline/112/') && k.endsWith('.part'))).toBe(false);
  });

  it('refreshFromDisk keeps the same snapshot array when nothing on disk changed', () => {
    for (let n = 1; n <= 4; n++) store.set(`file:///doc/offline/112/11200${n}.mp3`, 'x');
    store.set('file:///doc/offline/112/timings.json', JSON.stringify(timings(112, 4)));
    refreshFromDisk();
    const first = dl.downloaded();
    refreshFromDisk();
    const second = dl.downloaded();
    expect(second).toBe(first); // same reference: useSyncExternalStore must not see a "change" here
    expect(second).toEqual([112]);
  });
});
