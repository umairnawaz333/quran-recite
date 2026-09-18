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
 * Directory(...parts)`, `dir.exists`, `dir.name`, `dir.uri`,
 * `dir.create(options)`, `dir.delete()`, `dir.list()`; `Paths.document`,
 * `Paths.cache`.
 *
 * Where it used to be *lenient*, it is now literal, because every gap hid a
 * bug that only showed up on a device (see the Stage 2 review): a
 * `Directory.uri` really does end with a slash, `create()` really does throw
 * when the parent folder is missing, `list()` really does throw on a folder
 * that is not there, and a cancelled `DownloadTask` really does reject.
 *
 * `vi.mock` factories are hoisted above every import, so a test file that
 * wants this fake must reference it through an async factory — either
 * `vi.mock('expo-file-system', async () => (await import('./helpers/fakeFileSystem')).fakeFileSystemModule)`
 * or `vi.mock('expo-file-system', async () => { const fs = await import('./helpers/fakeFileSystem'); return { File: fs.FakeFile, Directory: fs.FakeDirectory, Paths: fs.Paths }; })`
 * — rather than a top-level import.
 */
export const store = new Map<string, string>(); // uri -> contents
/** Directories that have been created, as normalised paths (no trailing slash). */
const dirs = new Set<string>();

/** The roots the OS hands the app: always present, like the real ones. */
const SEEDED_DIRS = ['file:///doc', 'file:///cache'];
SEEDED_DIRS.forEach(d => dirs.add(d));

/**
 * Real `Paths.join` normalises a directory's trailing slash away, so a path
 * built from `Paths.document` and two names has exactly one slash between
 * each part. Every key in `store`/`dirs` is normalised this way.
 */
function normalise(part: string): string {
  return part.replace(/\/+$/, '');
}

export function join(parts: (string | FakeDirectory | FakeFile)[]) {
  return parts
    .map(p => (typeof p === 'string' ? p : p.uri))
    .map(normalise)
    .filter(part => part !== '')
    .join('/');
}

/**
 * The containing directory's path, or `null` at the top of the scheme —
 * `file:///doc` has no parent worth checking, the way the real document
 * directory's does not have to be created.
 */
function parentOf(path: string): string | null {
  const cut = path.lastIndexOf('/');
  if (cut <= 'file://'.length) return null;
  return path.slice(0, cut);
}

export class FakeDirectory {
  /** The normalised path — no trailing slash, which is what `store`/`dirs` key on. */
  readonly path: string;
  constructor(...parts: (string | FakeDirectory | FakeFile)[]) { this.path = join(parts); }
  /**
   * Real `Directory.uri` ALWAYS ends with a slash (`FileSystemDirectory`'s
   * `asString()` appends one, and `list()` builds its entries from URIs that
   * carry it), so `uri.split('/').pop()` on a directory is `''` — never its
   * name. Code that wants the name must ask for `name`.
   */
  get uri() { return `${this.path}/`; }
  /** Real `Directory.name` is `Paths.basename(uri)`, which ignores the trailing slash. */
  get name() { return this.path.slice(this.path.lastIndexOf('/') + 1); }
  get exists() {
    return dirs.has(this.path) || [...store.keys()].some(k => k.startsWith(this.path + '/'));
  }
  /**
   * Real `create()` throws when the parent directory does not exist unless
   * `intermediates: true` is passed — the failure the app hits the very first
   * time it writes into `offline/<id>/`, whose `offline` parent is not there
   * yet.
   */
  create(options?: { intermediates?: boolean }) {
    const parent = parentOf(this.path);
    if (parent && !new FakeDirectory(parent).exists) {
      if (!options?.intermediates) throw new Error(`Directory does not exist: ${parent}/`);
      new FakeDirectory(parent).create(options);
    }
    dirs.add(this.path);
  }
  delete() {
    dirs.delete(this.path);
    for (const d of [...dirs]) if (d.startsWith(this.path + '/')) dirs.delete(d);
    for (const k of [...store.keys()]) if (k.startsWith(this.path + '/')) store.delete(k);
  }
  /** Real `list()` throws when the directory does not exist; it does not read as empty. */
  list(): (FakeDirectory | FakeFile)[] {
    if (!this.exists) throw new Error(`Directory does not exist: ${this.uri}`);
    const names = new Set<string>();
    for (const k of store.keys()) if (k.startsWith(this.path + '/')) names.add(k.slice(this.path.length + 1).split('/')[0]);
    for (const d of dirs) if (d.startsWith(this.path + '/')) names.add(d.slice(this.path.length + 1).split('/')[0]);
    return [...names].map(n => (store.has(`${this.path}/${n}`) ? new FakeFile(this.path, n) : new FakeDirectory(this.path, n)));
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
  /** Real `create()` throws when the containing directory does not exist. */
  create() {
    const parent = parentOf(this.uri);
    if (parent && !new FakeDirectory(parent).exists) throw new Error(`Directory does not exist: ${parent}/`);
    store.set(this.uri, '');
  }
  /** `failWrites`, when it matches this file, throws as a full disk (or a
   * missing document directory) would — the callers here must never let that
   * reach the app. */
  write(content: string) {
    if (failWrites?.test(this.uri)) throw new Error(`write failed: ${this.uri}`);
    store.set(this.uri, content);
  }
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
  /**
   * Real `File.move()` returns `Promise<void>` and genuinely happens later —
   * an un-awaited call must not appear to have finished. Deferring past a
   * real macrotask (not just a microtask) means a caller that forgets to
   * `await` this observes the rename as *not yet done* when it checks
   * `exists` right afterwards, which is what makes that mistake testable.
   *
   * `failMoves`, when it matches the destination, simulates a rename that
   * resolves without producing the destination file — the source is left
   * exactly as it was, exercising the caller's post-move `exists` check.
   */
  async move(to: FakeFile | FakeDirectory) {
    const dest = to instanceof FakeDirectory ? `${to.path}/${this.name}` : to.uri;
    await new Promise<void>(r => setTimeout(r, 0));
    if (failMoves?.test(dest)) return;
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

/** A `move()` whose destination matches this pattern resolves without renaming — see `FakeFile.move`. */
export let failMoves: RegExp | null = null;
export function setFailMovesMatching(r: RegExp | null) { failMoves = r; }

/** A `write()` to a file matching this pattern throws — see `FakeFile.write`. */
export let failWrites: RegExp | null = null;
export function setFailWritesMatching(r: RegExp | null) { failWrites = r; }

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
  released = false;
  private resolveHeld: (() => void) | null = null;
  constructor(public url: string, public dest: FakeFile) { downloads.push({ url, dest, task: this }); }
  async downloadAsync(): Promise<FakeFile | null> {
    if (failDownloads?.test(this.url)) throw new Error(`download failed: ${this.url}`);
    if (holdDownloads?.test(this.url)) await new Promise<void>(r => { this.resolveHeld = r; });
    // Real `cancel()` REJECTS the pending `downloadAsync()` — a `null`
    // resolution means the task was *paused*, nothing else. A caller that
    // reads "cancelled" off a null return would never see one on a device.
    if (this.cancelled) throw new Error(`download cancelled: ${this.url}`);
    store.set(this.dest.uri, 'mp3-bytes');
    return this.dest;
  }
  cancel() { this.cancelled = true; this.resolveHeld?.(); }
  addListener() { return { remove() {} }; }
  /** Real `release()` frees the native handle and is always present. */
  release() { this.released = true; }
  /** Test-only: lets a held download proceed, as if the network responded. */
  releaseHeld() { this.resolveHeld?.(); }
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
  SEEDED_DIRS.forEach(d => dirs.add(d));
  holdingPositionRead = false;
  heldReads.length = 0;
  FakeFile.downloadFileAsync.mockClear();
  downloads.length = 0;
  holdDownloads = null;
  failDownloads = null;
  failMoves = null;
  failWrites = null;
}

/** Alias kept for the player-provider harness, which was written against this name. */
export const resetFileSystem = reset;
