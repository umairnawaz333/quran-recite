/**
 * An in-memory `expo-file-system`, covering the members `lastPosition.ts`
 * and `ayahCache.ts` call (the same approach as `__tests__/storage.test.ts`,
 * which owns the tests for those modules; here the file system only has to
 * be present and controllable enough for the provider to read a bookmark).
 */
import { vi } from 'vitest';

export const store = new Map<string, string>();

export class FakeDirectory {
  uri: string;
  constructor(...parts: (string | FakeDirectory | FakeFile)[]) {
    this.uri = parts.map(p => (typeof p === 'string' ? p : p.uri)).join('/');
  }
  get exists() { return true; }
  create() {}
  list(): FakeFile[] { return []; }
}

export class FakeFile {
  uri: string;
  constructor(...parts: (string | FakeDirectory | FakeFile)[]) {
    this.uri = parts.map(p => (typeof p === 'string' ? p : p.uri)).join('/');
  }
  get exists() { return store.has(this.uri); }
  create() { store.set(this.uri, ''); }
  write(content: string) { store.set(this.uri, content); }
  async text() { return store.get(this.uri) ?? ''; }
  delete() { store.delete(this.uri); }
  get modificationTime(): number { return 0; }
  static downloadFileAsync = vi.fn(async (_url: string, dest: FakeFile) => {
    store.set(dest.uri, 'mp3-bytes');
    return dest;
  });
}

export const Paths = {
  document: new FakeDirectory('file:///doc'),
  cache: new FakeDirectory('file:///cache'),
};

const LAST_POSITION_URI = 'file:///doc/lastPosition.json';

/** Puts a bookmark on disk, as a previous session's playback would have. */
export function saveLastPosition(pos: { surahId: number; ayah: number; localMs?: number }): void {
  store.set(LAST_POSITION_URI, JSON.stringify({
    surahId: pos.surahId,
    ayah: pos.ayah,
    localMs: pos.localMs ?? 0,
    updatedAt: 1_700_000_000_000,
  }));
}

/** What the provider has bookmarked, or null if it has written nothing. */
export function readSavedPosition(): { surahId: number; ayah: number } | null {
  const raw = store.get(LAST_POSITION_URI);
  if (!raw) return null;
  return JSON.parse(raw) as { surahId: number; ayah: number };
}

export function resetFileSystem(): void {
  store.clear();
  FakeFile.downloadFileAsync.mockClear();
}
