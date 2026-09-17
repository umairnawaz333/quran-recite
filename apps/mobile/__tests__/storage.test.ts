import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A minimal in-memory stand-in for expo-file-system's `File`/`Directory`/
 * `Paths`, covering exactly the members `lastPosition.ts` and `ayahCache.ts`
 * call. The point of these tests is the modules' own logic — validation,
 * never-throw, naming — not the file system.
 */
// `vi.mock` factories are hoisted above every import, so anything they
// reference has to be hoisted with them.
const { store, FakeFile, FakeDirectory } = vi.hoisted(() => {
  const store = new Map<string, string>();

  class FakeDirectory {
    uri: string;
    constructor(...parts: (string | FakeDirectory | FakeFile)[]) {
      this.uri = parts.map(p => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    get exists() { return true; }
    create() {}
    list() { return []; }
  }

  class FakeFile {
    uri: string;
    constructor(...parts: (string | FakeDirectory | FakeFile)[]) {
      this.uri = parts.map(p => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    get exists() { return store.has(this.uri); }
    create() { store.set(this.uri, ''); }
    write(content: string) { store.set(this.uri, content); }
    async text() { return store.get(this.uri) ?? ''; }
    delete() { store.delete(this.uri); }
    static downloadFileAsync = vi.fn(async (_url: string, dest: FakeFile) => {
      store.set(dest.uri, 'mp3-bytes');
      return dest;
    });
  }

  return { store, FakeFile, FakeDirectory };
});

vi.mock('expo-file-system', () => ({
  File: FakeFile,
  Directory: FakeDirectory,
  Paths: { document: new FakeDirectory('file:///doc'), cache: new FakeDirectory('file:///cache') },
}));

import { readLastPosition, writeLastPosition } from '../src/player/lastPosition';
import { cacheAyah, cacheFileName, localPathFor } from '../src/audio/ayahCache';

beforeEach(() => {
  store.clear();
  FakeFile.downloadFileAsync.mockClear();
});

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
