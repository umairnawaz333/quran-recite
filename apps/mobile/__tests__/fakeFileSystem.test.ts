import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDirectory, FakeDownloadTask, FakeFile, Paths, reset, setHoldDownloads, store } from './helpers/fakeFileSystem';

/**
 * The fake filesystem is the only thing standing between this app's disk
 * logic and a device, so the places where it used to be more forgiving than
 * `expo-file-system` v57 are pinned here. Every rule below was a real bug
 * the fake hid: a `Directory.uri` that ended in a slash (so `.pop()` read
 * the empty string, not the surah id), a `create()` that invented missing
 * parents, a `list()` that read a missing folder as empty, and a cancelled
 * download that resolved instead of rejecting.
 */
beforeEach(reset);

describe('the fake filesystem matches expo-file-system v57', () => {
  it('gives a directory a uri that ends with a slash, and a name that does not', () => {
    const dir = new FakeDirectory(Paths.document, 'offline', '112');
    expect(dir.uri).toBe('file:///doc/offline/112/');
    expect(dir.uri.split('/').pop()).toBe('');   // why `name` exists at all
    expect(dir.name).toBe('112');
  });

  it('joins a directory and a file name with exactly one slash', () => {
    const file = new FakeFile(new FakeDirectory(Paths.document, 'offline', '1'), '001001.mp3');
    expect(file.uri).toBe('file:///doc/offline/1/001001.mp3');
    expect(file.name).toBe('001001.mp3');
  });

  it('refuses to create a directory whose parent is missing unless told to make intermediates', () => {
    expect(() => new FakeDirectory(Paths.document, 'offline', '112').create()).toThrow();
    expect(new FakeDirectory(Paths.document, 'offline').exists).toBe(false);

    new FakeDirectory(Paths.document, 'offline', '112').create({ intermediates: true });
    expect(new FakeDirectory(Paths.document, 'offline').exists).toBe(true);
    expect(new FakeDirectory(Paths.document, 'offline', '112').exists).toBe(true);
  });

  it('refuses to create a file whose directory is missing', () => {
    expect(() => new FakeFile(Paths.document, 'offline', '1', 'timings.json').create()).toThrow();
    expect(() => new FakeFile(Paths.document, 'theme.json').create()).not.toThrow();
  });

  it('throws when listing a directory that is not there, and reads an empty one as empty', () => {
    expect(() => new FakeDirectory(Paths.document, 'offline').list()).toThrow();
    new FakeDirectory(Paths.document, 'offline').create();
    expect(new FakeDirectory(Paths.document, 'offline').list()).toEqual([]);
  });

  it('lists a folder as a Directory and a file as a File, and deletes a whole tree', () => {
    store.set('file:///doc/offline/1/001001.mp3', 'x');
    const entries = new FakeDirectory(Paths.document, 'offline').list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toBeInstanceOf(FakeDirectory);
    expect((entries[0] as FakeDirectory).name).toBe('1');

    new FakeDirectory(Paths.document, 'offline').delete();
    expect(new FakeDirectory(Paths.document, 'offline').exists).toBe(false);
    expect(store.has('file:///doc/offline/1/001001.mp3')).toBe(false);
  });

  it('rejects a cancelled download rather than resolving it with null', async () => {
    setHoldDownloads(/001001/);
    const dest = new FakeFile('file:///doc/offline/1/001001.mp3.part');
    const task = new FakeDownloadTask('https://example.test/001001.mp3', dest);
    const pending = task.downloadAsync();
    task.cancel();
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(dest.exists).toBe(false);
  });
});
