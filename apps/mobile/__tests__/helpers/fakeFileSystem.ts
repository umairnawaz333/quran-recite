import { vi } from 'vitest';

/**
 * A shared in-memory stand-in for expo-file-system's `File`/`Directory`/
 * `Paths`, used by every mobile test that touches the filesystem
 * (`storage.test.ts`, `offlineStore.test.ts`, `PlayerProvider.test.tsx`,
 * `PlayerBar.test.tsx`). The point of those tests is the modules' own
 * logic — validation, never-throw, naming, completeness, the bookmark race —
 * not the file system, so this fake only needs to match the real v57 API's
 * shape closely enough for that code to run unmodified against either one:
 * `new File(...parts)`, `file.exists`, `file.size`, `file.name`,
 * `file.create()`, `file.write(string)`, `file.text()`, `file.delete()`,
 * `file.move(...)`, `File.downloadFileAsync(url, dest)`; `new
 * Directory(...parts)`, `dir.exists`, `dir.create()`, `dir.delete()`,
 * `dir.list()`; `Paths.document`, `Paths.cache`.
 *
 * `vi.mock` factories are hoisted above every import, so a test file that
 * wants this fake must reference it through an async factory — either
 * `vi.mock('expo-file-system', async () => (await import('./helpers/fakeFileSystem')).fakeFileSystemModule)`
 * or `vi.mock('expo-file-system', async () => { const fs = await import('./helpers/fakeFileSystem'); return { File: fs.FakeFile, Directory: fs.FakeDirectory, Paths: fs.Paths }; })`
 * — rather than a top-level import.
 */
export const store = new Map<string, string>(); // uri -> contents
const dirs = new Set<string>();

export function join(parts: (string | FakeDirectory | FakeFile)[]) {
  return parts.map(p => (typeof p === 'string' ? p : p.uri)).join('/');
}

export class FakeDirectory {
  uri: string;
  constructor(...parts: (string | FakeDirectory | FakeFile)[]) { this.uri = join(parts); }
  get exists() { return dirs.has(this.uri) || [...store.keys()].some(k => k.startsWith(this.uri + '/')); }
  create() { dirs.add(this.uri); }
  delete() { dirs.delete(this.uri); for (const k of [...store.keys()]) if (k.startsWith(this.uri + '/')) store.delete(k); }
  list(): (FakeDirectory | FakeFile)[] {
    const names = new Set<string>();
    for (const k of store.keys()) if (k.startsWith(this.uri + '/')) names.add(k.slice(this.uri.length + 1).split('/')[0]);
    for (const d of dirs) if (d.startsWith(this.uri + '/')) names.add(d.slice(this.uri.length + 1).split('/')[0]);
    return [...names].map(n => (store.has(`${this.uri}/${n}`) ? new FakeFile(this.uri, n) : new FakeDirectory(this.uri, n)));
  }
}

export class FakeFile {
  uri: string;
  constructor(...parts: (string | FakeDirectory | FakeFile)[]) { this.uri = join(parts); }
  get exists() { return store.has(this.uri); }
  /** Real `File.size` is `number` — 0 if the file does not exist. */
  get size() { return store.get(this.uri)?.length ?? 0; }
  get name() { return this.uri.split('/').pop()!; }
  /** Only ever read from in `ayahCache.ts`'s eviction sort; a fresh fake write has none. */
  get modificationTime(): number { return 0; }
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
  /** Real `File.move()` returns `Promise<void>` — an un-awaited call must not appear to have finished. */
  async move(to: FakeFile | FakeDirectory) {
    const dest = to instanceof FakeDirectory ? `${to.uri}/${this.name}` : to.uri;
    store.set(dest, store.get(this.uri) ?? '');
    store.delete(this.uri);
    this.uri = dest;
  }
  static downloadFileAsync = vi.fn(async (_url: string, dest: FakeFile | FakeDirectory) => {
    const f = dest instanceof FakeDirectory ? new FakeFile(dest, 'download') : dest;
    store.set(f.uri, 'mp3-bytes');
    return f;
  });
}

export const Paths = { document: new FakeDirectory('file:///doc'), cache: new FakeDirectory('file:///cache') };

/**
 * Stand-in for `expo-file-system`'s `DownloadTask` (see `NetworkTasks.d.ts`):
 * `new DownloadTask(url, destination)`, `downloadAsync(): Promise<File | null>`,
 * `cancel()`, `release()`, `addListener('progress', ...)`. Every task created
 * is recorded in `downloads` so tests can assert what was fetched and in what
 * order. `holdDownloads`/`failDownloads` let a test park or fail a download
 * matching a URL pattern, to exercise cancellation and error handling.
 */
export const downloads: { url: string; dest: FakeFile; task: FakeDownloadTask }[] = [];
export let holdDownloads: RegExp | null = null;
export let failDownloads: RegExp | null = null;
export function setHoldDownloads(r: RegExp | null) { holdDownloads = r; }
export function setFailDownloads(r: RegExp | null) { failDownloads = r; }

export class FakeDownloadTask {
  cancelled = false;
  private release: (() => void) | null = null;
  constructor(public url: string, public dest: FakeFile) { downloads.push({ url, dest, task: this }); }
  async downloadAsync(): Promise<FakeFile | null> {
    if (failDownloads?.test(this.url)) throw new Error(`download failed: ${this.url}`);
    if (holdDownloads?.test(this.url)) await new Promise<void>(r => { this.release = r; });
    if (this.cancelled) return null;
    store.set(this.dest.uri, 'mp3-bytes');
    return this.dest;
  }
  cancel() { this.cancelled = true; this.release?.(); }
  addListener() { return { remove() {} }; }
  /** Test-only: lets a held download proceed, as if the network responded. */
  releaseHeld() { this.release?.(); }
}
export function releaseAllHeld() { downloads.forEach(d => d.task.releaseHeld()); }

export const fakeFileSystemModule = { File: FakeFile, Directory: FakeDirectory, Paths, DownloadTask: FakeDownloadTask };

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

export function reset(): void {
  store.clear();
  dirs.clear();
  holdingPositionRead = false;
  heldReads.length = 0;
  FakeFile.downloadFileAsync.mockClear();
  downloads.length = 0;
  holdDownloads = null;
  failDownloads = null;
}

/** Alias kept for the player-provider harness, which was written against this name. */
export const resetFileSystem = reset;
