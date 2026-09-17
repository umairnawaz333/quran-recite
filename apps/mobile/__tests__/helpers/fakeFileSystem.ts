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
  async text() {
    // The bytes are taken when the read is issued, not when it completes:
    // playback bookmarks the position it is on as it goes, and a read that
    // picked up those later writes could never tell yesterday's position
    // from today's.
    const content = store.get(this.uri) ?? '';
    // A disk read is not instantaneous, and the provider's "continue where
    // you left off" rule turns on what has happened by the time it lands.
    if (holdingPositionRead && this.uri === LAST_POSITION_URI) {
      await new Promise<void>(resolve => { heldReads.push(resolve); });
    }
    return content;
  }
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

let holdingPositionRead = false;
const heldReads: (() => void)[] = [];

/** Puts a bookmark on disk, as a previous session's playback would have. */
export function saveLastPosition(pos: { surahId: number; ayah: number; localMs?: number }): void {
  store.set(LAST_POSITION_URI, JSON.stringify({
    surahId: pos.surahId,
    ayah: pos.ayah,
    localMs: pos.localMs ?? 0,
    updatedAt: 1_700_000_000_000,
  }));
}

/**
 * Puts a bookmark on disk whose read does not complete until
 * `releaseLastPosition()` — the window in which the user can press play
 * before the bookmark arrives.
 */
export function holdLastPosition(pos: { surahId: number; ayah: number; localMs?: number }): void {
  saveLastPosition(pos);
  holdingPositionRead = true;
}

export function releaseLastPosition(): void {
  holdingPositionRead = false;
  heldReads.splice(0).forEach(resolve => resolve());
}

/** What the provider has bookmarked, or null if it has written nothing. */
export function readSavedPosition(): { surahId: number; ayah: number } | null {
  const raw = store.get(LAST_POSITION_URI);
  if (!raw) return null;
  return JSON.parse(raw) as { surahId: number; ayah: number };
}

export function resetFileSystem(): void {
  store.clear();
  holdingPositionRead = false;
  heldReads.length = 0;
  FakeFile.downloadFileAsync.mockClear();
}
