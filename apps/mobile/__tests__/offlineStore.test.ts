import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('expo-file-system', async () => (await import('./helpers/fakeFileSystem')).fakeFileSystemModule);
import { store, reset, FakeFile, Paths } from './helpers/fakeFileSystem';
import {
  isSurahDownloaded, downloadedSurahs, surahBytesOnDisk, deleteSurah, offlinePathFor,
  offlineTimingsStore, writeOfflineTimings, offlineDir,
} from '../src/offline/offlineStore';

const ayah = (surah: number, n: number) => ({
  ayah: n, audioUrl: `/audio/abdulbasit-murattal/${String(surah).padStart(3, '0')}${String(n).padStart(3, '0')}.mp3`,
  startOffsetMs: 0, durationMs: 1000, words: [],
});
const timings = (surah: number, count: number) => ({
  surah, reciterId: 'abdulbasit-murattal', surahDurationMs: count * 1000,
  ayahs: Array.from({ length: count }, (_, i) => ayah(surah, i + 1)),
});
const putFile = (surah: number, name: string, bytes = 'xxxx') => store.set(`file:///doc/offline/${surah}/${name}`, bytes);

beforeEach(reset);

describe('offlineStore', () => {
  it('is downloaded only when timings and every mp3 are present — never a partial', () => {
    putFile(112, '112001.mp3'); putFile(112, '112002.mp3'); putFile(112, '112003.mp3');
    expect(isSurahDownloaded(112, 4)).toBe(false);          // one file short
    putFile(112, '112004.mp3');
    expect(isSurahDownloaded(112, 4)).toBe(false);          // no timings yet
    writeOfflineTimings(112, timings(112, 4));
    expect(isSurahDownloaded(112, 4)).toBe(true);
    putFile(112, '112005.mp3.part');                        // an in-flight temp file
    expect(isSurahDownloaded(112, 4)).toBe(true);           // does not count, does not break
  });

  it('lists downloaded surahs from the folders on disk, skipping incomplete ones', () => {
    writeOfflineTimings(1, timings(1, 7)); for (let n = 1; n <= 7; n++) putFile(1, `00100${n}.mp3`);
    writeOfflineTimings(112, timings(112, 4)); putFile(112, '112001.mp3');     // incomplete
    expect(downloadedSurahs(id => ({ 1: 7, 112: 4 } as Record<number, number>)[id] ?? 0)).toEqual([1]);
  });

  it('reports bytes on disk and deletes a whole surah', () => {
    putFile(1, '001001.mp3', 'abcde'); putFile(1, '001002.mp3', 'abc');
    expect(surahBytesOnDisk(1)).toBe(8);
    deleteSurah(1);
    expect(offlineDir(1).exists).toBe(false);
    expect(surahBytesOnDisk(1)).toBe(0);
  });

  it('resolves an ayah to its offline file only when that file exists', () => {
    expect(offlinePathFor(ayah(1, 2))).toBeNull();
    putFile(1, '001002.mp3');
    expect(offlinePathFor(ayah(1, 2))).toBe('file:///doc/offline/1/001002.mp3');
  });

  it('serves timings from the surah folder first, then the timings cache; writes only to the cache', async () => {
    expect(await offlineTimingsStore.read(2)).toBeNull();
    await offlineTimingsStore.write(2, timings(2, 3));
    expect(store.has('file:///cache/timings/2.json')).toBe(true);
    expect(store.has('file:///doc/offline/2/timings.json')).toBe(false);     // a write never creates a surah folder
    expect((await offlineTimingsStore.read(2))?.ayahs).toHaveLength(3);
    writeOfflineTimings(2, timings(2, 286));
    expect((await offlineTimingsStore.read(2))?.ayahs).toHaveLength(286);     // folder wins
  });

  it('never throws on a corrupt timings file', async () => {
    store.set('file:///cache/timings/3.json', '{not json');
    expect(await offlineTimingsStore.read(3)).toBeNull();
  });
});
