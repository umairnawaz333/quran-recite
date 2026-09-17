import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The in-memory stand-in for expo-file-system's `File`/`Directory`/`Paths`
 * lives in `helpers/fakeFileSystem.ts` and is shared across test files. The
 * point of these tests is the modules' own logic — validation, never-throw,
 * naming — not the file system.
 *
 * `vi.mock` factories are hoisted above every import, so the fake is pulled
 * in through an async factory rather than a top-level import.
 */
vi.mock('expo-file-system', async () => (await import('./helpers/fakeFileSystem')).fakeFileSystemModule);

import { store, reset, FakeFile } from './helpers/fakeFileSystem';
import { readLastPosition, writeLastPosition } from '../src/player/lastPosition';
import { cacheAyah, cacheFileName, localPathFor } from '../src/audio/ayahCache';

beforeEach(reset);

describe('lastPosition', () => {
  it('round-trips a position and stamps updatedAt', async () => {
    writeLastPosition({ surahId: 2, ayah: 255, localMs: 1234 });
    const read = await readLastPosition();
    expect(read).toMatchObject({ surahId: 2, ayah: 255, localMs: 1234 });
    expect(typeof read?.updatedAt).toBe('number');
  });

  it('reads nothing when no file exists', async () => {
    expect(await readLastPosition()).toBeNull();
  });

  it('reads nothing from a corrupt or out-of-range file rather than throwing', async () => {
    store.set('file:///doc/lastPosition.json', '{not json');
    expect(await readLastPosition()).toBeNull();
    store.set('file:///doc/lastPosition.json', JSON.stringify({ surahId: 115, ayah: 1, localMs: 0, updatedAt: 1 }));
    expect(await readLastPosition()).toBeNull();
  });
});

describe('ayahCache', () => {
  const ayah = {
    ayah: 2,
    audioUrl: '/audio/abdulbasit-murattal/001002.mp3',
    startOffsetMs: 0,
    durationMs: 1000,
    words: [],
  };

  it('names cache files by reciter and file, with no path separators', () => {
    expect(cacheFileName('/audio/abdulbasit-murattal/001002.mp3')).toBe('abdulbasit-murattal_001002.mp3');
    expect(cacheFileName('001002.mp3')).toBe('unknown_001002.mp3');
  });

  it('reports no local path before caching and a file uri after', async () => {
    expect(localPathFor(ayah)).toBeNull();
    await cacheAyah(ayah);
    expect(localPathFor(ayah)).toBe('file:///cache/ayah-cache/abdulbasit-murattal_001002.mp3');
  });

  it('downloads a given ayah at most once, even when asked concurrently', async () => {
    await Promise.all([cacheAyah(ayah), cacheAyah(ayah), cacheAyah(ayah)]);
    await cacheAyah(ayah);
    expect(FakeFile.downloadFileAsync).toHaveBeenCalledTimes(1);
  });

  it('re-downloads an ayah whose cached file has since been removed', async () => {
    await cacheAyah(ayah);
    await cacheAyah(ayah);                                   // cache hit
    store.delete('file:///cache/ayah-cache/abdulbasit-murattal_001002.mp3');  // evicted / OS purge
    await cacheAyah(ayah);
    // Two real downloads: the hit in between must not have left a settled
    // promise registered as "in flight" that every later call dedupes on.
    expect(FakeFile.downloadFileAsync).toHaveBeenCalledTimes(2);
    expect(localPathFor(ayah)).not.toBeNull();
  });
});
