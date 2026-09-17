# Android App Stage 2 — Offline and Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-surah offline recitation (download with progress, cancel, delete, play with the network off), and a Settings screen with offline management, a system/light/dark theme, the app version and the credit `Umair Nawaz 2026`.

**Architecture:** Offline is a folder per surah in the app's document directory holding that surah's ayah MP3s and its `timings.json`; the filesystem is the only source of truth for what is downloaded. Playback already resolves every ayah file through the sequencer's `localPathFor` seam and every timings file through core's `configureTimings({ store })` seam, so offline plugs in behind both without the player knowing. A build-time manifest of per-surah byte sizes lets the UI say "222 MB" before a download starts. Theme is a small palette object behind a `useTheme()` hook, with the preference persisted as JSON the same way the last position is.

**Tech Stack:** Expo SDK 57 / React Native 0.86 (New Architecture), `expo-file-system` (`File`/`Directory`/`Paths`/`DownloadTask`), `expo-application` (native version), vitest with the existing `react-test-renderer` harness and in-memory file-system fakes, Kotlin for one new prop on the `tajweed-text` native view.

**Spec:** `docs/superpowers/specs/2026-09-15-android-app-design.md` — §9 Offline, §10 Settings, §12 Testing, §14 Definition of done.

## Global Constraints

- **The web app's behaviour must not change.** Nothing under `apps/web` may be modified except, in Task 1, adding one npm script that generates data. `packages/core` must keep zero runtime dependencies and no platform imports (its guard test runs in every task's `npm test`).
- `npm test` from the repo root must not fall below **275** (91 `packages/core` + 93 `apps/mobile` + 91 `apps/web`) and must rise with each task's tests. `npm run typecheck` must exit 0 across all four projects.
- **Never `git add` anything under `apps/web/public/audio/`** (6,236 gitignored MP3s, 2.5 GB). Nothing generated is committed: `apps/mobile/android/`, `apps/mobile/ios/`, `.expo/`, `dist/`, `node_modules`.
- **The filesystem is the source of truth** for what is downloaded (§9). No task may make the UI's "downloaded" state depend on an index that is not verified against the files on disk.
- **Partial downloads must never present as complete** (§9). A file is written to a temporary name and renamed only after its download finished; a surah is downloaded only when every one of its files and its `timings.json` exist.
- **"Download all" is behind an explicit confirmation naming the total size** (§9/§10); the size comes from the build-time manifest, never from HEAD requests.
- The theme's `system` state is a live state — the app follows the device when the device changes (§10). The version is read from the native application, not hardcoded (§10). The credit text is exactly `Umair Nawaz 2026` (§10).
- Every effect or memo that touches the player must depend on specific stable actions or state fields, never on the whole context value (it rebuilds on every tick). New screens follow the existing pattern: read `usePlayer()` and destructure.
- Commit as the repository's configured git user; end every commit body with the two attribution lines given in the dispatch.

---

## File Structure

| Path | Responsibility |
|---|---|
| `packages/quran-data/scripts/build-audio-sizes.mjs` (create) | Walks `apps/web/public/audio/<reciter>/` and writes the size manifest. |
| `packages/quran-data/audio-sizes.json` (create, committed) | `{ reciterId, generatedAt, totalBytes, totalFiles, surahs: { "1": { bytes, files }, … } }`. |
| `packages/quran-data/package.json` (modify) | Export `./audio-sizes.json`. |
| `package.json` (modify) | Root script `build:audio-sizes`. |
| `apps/mobile/src/offline/audioSizes.ts` (create) | Typed access to the manifest, `formatBytes`. |
| `apps/mobile/src/offline/offlineStore.ts` (create) | Paths, completeness from the filesystem, sizes on disk, deletion, `offlinePathFor`, the `TimingsStore`. |
| `apps/mobile/src/offline/downloadManager.ts` (create) | Per-surah downloads with progress and cancellation; the download queue; a `useSyncExternalStore` state. |
| `apps/mobile/src/theme/theme.ts` (create) | Palettes, preference persistence, `ThemeProvider`, `useTheme`, `useThemePreference`. |
| `apps/mobile/src/components/DownloadControl.tsx` (create) | The three-state per-surah control. |
| `apps/mobile/src/screens/SettingsScreen.tsx` (create) | Offline / Appearance / About. |
| `apps/mobile/modules/tajweed-text/…/TajweedTextView.kt`, `TajweedTextModule.kt`, `src/TajweedText.types.ts` (modify) | New `highlightColor` prop. |
| `apps/mobile/src/player/PlayerProvider.tsx` (modify) | Offline-first `localPathFor`; offline `TimingsStore`. |
| `apps/mobile/src/screens/SurahListScreen.tsx`, `ReaderScreen.tsx`, `apps/mobile/src/player/PlayerBar.tsx`, `apps/mobile/src/components/PlayerIcons.tsx`, `apps/mobile/App.tsx` (modify) | Theme colours; download controls; home header with a Settings entry; the `settings` screen state. |
| `apps/mobile/__tests__/audioSizes.test.ts`, `offlineStore.test.ts`, `downloadManager.test.ts`, `theme.test.ts`, `SettingsScreen.test.tsx` (create) | Tests. `apps/mobile/__tests__/helpers/fakeFileSystem.ts` (create) — the in-memory `expo-file-system` fake, extracted from `storage.test.ts` and extended with directories, sizes, and a fake `DownloadTask`. |

---

### Task 1: Build-time audio size manifest

**Files:**
- Create: `packages/quran-data/scripts/build-audio-sizes.mjs`
- Create: `packages/quran-data/audio-sizes.json` (generated, committed)
- Modify: `packages/quran-data/package.json` (add export), `package.json` (root script)
- Create: `apps/mobile/src/offline/audioSizes.ts`
- Test: `apps/mobile/__tests__/audioSizes.test.ts`

**Interfaces:**
- Produces: `packages/quran-data/audio-sizes.json` with shape `{ reciterId: string; generatedAt: string; totalBytes: number; totalFiles: number; surahs: Record<string, { bytes: number; files: number }> }`.
- Produces (mobile): `surahAudioSize(surahId: number): { bytes: number; files: number }`, `allAudioSize(): { bytes: number; files: number }`, `formatBytes(bytes: number): string` (`"0.9 MB"`, `"222 MB"`, `"2.5 GB"`).

- [ ] **Step 1: Write the script**

```js
// packages/quran-data/scripts/build-audio-sizes.mjs
// Walks the locally fetched audio (apps/web/public/audio/<reciter>/SSSAAA.mp3)
// and writes audio-sizes.json: per-surah bytes and file counts, plus totals.
// Run from the repo root: `npm run build:audio-sizes`. Requires the audio to
// be present locally (`npm run fetch:data -- --surahs=1-114`); the UI reads
// this manifest so it can say "222 MB" before a download starts instead of
// issuing 286 HEAD requests to learn what this script already knows.
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RECITER = process.argv[2] ?? 'abdulbasit-murattal';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const audioDir = path.resolve(root, '../../apps/web/public/audio', RECITER);
const out = path.join(root, 'audio-sizes.json');

const files = readdirSync(audioDir).filter(f => /^\d{6}\.mp3$/.test(f));
if (files.length === 0) {
  console.error(`No audio files in ${audioDir}. Fetch them first: npm run fetch:data -- --surahs=1-114`);
  process.exit(1);
}

const surahs = {};
let totalBytes = 0;
for (const f of files) {
  const surah = String(Number(f.slice(0, 3)));
  const bytes = statSync(path.join(audioDir, f)).size;
  surahs[surah] ??= { bytes: 0, files: 0 };
  surahs[surah].bytes += bytes;
  surahs[surah].files += 1;
  totalBytes += bytes;
}

const manifest = {
  reciterId: RECITER,
  generatedAt: new Date().toISOString().slice(0, 10),
  totalBytes,
  totalFiles: files.length,
  surahs,
};
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${out}: ${files.length} files, ${(totalBytes / 1e9).toFixed(2)} GB across ${Object.keys(surahs).length} surahs`);
```

- [ ] **Step 2: Wire the script and export, generate the manifest**

Add to `packages/quran-data/package.json` `exports`: `"./audio-sizes.json": "./audio-sizes.json"`. Add to the root `package.json` scripts: `"build:audio-sizes": "node packages/quran-data/scripts/build-audio-sizes.mjs"`.

Run: `npm run build:audio-sizes`
Expected: `Wrote … audio-sizes.json: 6236 files, 2.5x GB across 114 surahs`. Check `python3 -c "import json;d=json.load(open('packages/quran-data/audio-sizes.json'));print(len(d['surahs']), d['surahs']['1'], d['surahs']['2'])"` prints `114 {'bytes': ~9e5, 'files': 7} {'bytes': ~2.2e8, 'files': 286}`.

- [ ] **Step 3: Write the failing mobile test**

```ts
// apps/mobile/__tests__/audioSizes.test.ts
import { describe, it, expect } from 'vitest';
import { surahAudioSize, allAudioSize, formatBytes } from '../src/offline/audioSizes';
import surahs from '@quran/data/surahs.json';

describe('audio size manifest', () => {
  it('has an entry for every surah, with file counts matching the ayah counts', () => {
    for (const s of surahs as { id: number; ayahCount: number }[]) {
      const size = surahAudioSize(s.id);
      expect(size.files, `surah ${s.id}`).toBe(s.ayahCount);
      expect(size.bytes).toBeGreaterThan(0);
    }
  });

  it('totals the whole recitation', () => {
    const all = allAudioSize();
    expect(all.files).toBe(6236);
    expect(all.bytes).toBeGreaterThan(2_000_000_000);
  });

  it('formats sizes the way the UI shows them', () => {
    expect(formatBytes(900_000)).toBe('0.9 MB');
    expect(formatBytes(222_000_000)).toBe('222 MB');
    expect(formatBytes(2_500_000_000)).toBe('2.5 GB');
    expect(formatBytes(0)).toBe('0 MB');
  });
});
```

- [ ] **Step 4: Run it to verify it fails** — `npm test --workspace @quran/mobile -- audioSizes` → FAIL, module not found.

- [ ] **Step 5: Implement**

```ts
// apps/mobile/src/offline/audioSizes.ts
import manifest from '@quran/data/audio-sizes.json';

interface Manifest {
  reciterId: string;
  totalBytes: number;
  totalFiles: number;
  surahs: Record<string, { bytes: number; files: number }>;
}
const sizes = manifest as Manifest;

/** Bytes and file count of one surah's recitation, from the build-time manifest. */
export function surahAudioSize(surahId: number): { bytes: number; files: number } {
  return sizes.surahs[String(surahId)] ?? { bytes: 0, files: 0 };
}

export function allAudioSize(): { bytes: number; files: number } {
  return { bytes: sizes.totalBytes, files: sizes.totalFiles };
}

/** "0.9 MB", "222 MB", "2.5 GB" — one decimal under 10, none above. */
export function formatBytes(bytes: number): string {
  const gb = bytes / 1e9;
  if (gb >= 1) return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
  const mb = bytes / 1e6;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
```

If `import manifest from '@quran/data/audio-sizes.json'` does not type-check, add `"resolveJsonModule": true` is already on for `surahs.json`; follow how `apps/mobile/src/data/surahs.ts` imports its JSON.

- [ ] **Step 6: Run the test, typecheck, commit**

Run: `npm test --workspace @quran/mobile -- audioSizes` → PASS. `npm run typecheck` → 0.

```bash
git add packages/quran-data/scripts/build-audio-sizes.mjs packages/quran-data/audio-sizes.json packages/quran-data/package.json package.json apps/mobile/src/offline/audioSizes.ts apps/mobile/__tests__/audioSizes.test.ts
git commit -m "feat(data): build-time audio size manifest, read by the mobile app"
```

---

### Task 2: Offline store — the filesystem as the source of truth

**Files:**
- Create: `apps/mobile/__tests__/helpers/fakeFileSystem.ts` (extract the fake from `__tests__/storage.test.ts`, extend it)
- Modify: `apps/mobile/__tests__/storage.test.ts` (import the shared fake)
- Create: `apps/mobile/src/offline/offlineStore.ts`
- Test: `apps/mobile/__tests__/offlineStore.test.ts`

**Interfaces:**
- Produces:
  - `offlineDir(surahId: number): Directory` — `Paths.document/offline/<surahId>`.
  - `audioFileName(ayah: AyahTiming): string` — the file's own name, `001002.mp3`.
  - `isSurahDownloaded(surahId: number, expectedFiles: number): boolean` — true iff `timings.json` exists and exactly `expectedFiles` `*.mp3` files exist (no `.part` files count).
  - `downloadedSurahs(expectedFilesFor: (surahId: number) => number): number[]` — scan of `offline/`.
  - `surahBytesOnDisk(surahId: number): number`.
  - `deleteSurah(surahId: number): void` — removes the folder.
  - `offlinePathFor(ayah: AyahTiming): string | null` — the `file://` uri if that ayah's file exists in its surah's folder.
  - `offlineTimingsStore: TimingsStore` — `read` returns the folder's `timings.json` when present, else the timings cache at `Paths.cache/timings/<surahId>.json`; `write` saves to the timings cache only (never into a surah's folder — that would make a partial folder look more complete than it is).
  - `readOfflineTimings(surahId): Promise<SurahTimings | null>`, `writeOfflineTimings(surahId, timings): void` — used by Task 3 to make a folder self-contained.

- [ ] **Step 1: Extract and extend the fake file system**

Move the `vi.hoisted` block from `storage.test.ts` into `helpers/fakeFileSystem.ts` as plain exports (it is imported by tests that call `vi.mock` with a factory referencing it — factories are hoisted, so the helper must be imported via `vi.hoisted(async () => await import('./helpers/fakeFileSystem'))` or the test must re-export; simplest: keep `vi.mock('expo-file-system', async () => (await import('./helpers/fakeFileSystem')).fakeFileSystemModule)` in each test file — an async factory is allowed). The fake must support:

```ts
// apps/mobile/__tests__/helpers/fakeFileSystem.ts
export const store = new Map<string, string>();            // uri -> contents
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
  get size() { return store.get(this.uri)?.length ?? null; }
  get name() { return this.uri.split('/').pop()!; }
  create() { store.set(this.uri, ''); }
  write(content: string) { store.set(this.uri, content); }
  async text() { return store.get(this.uri) ?? ''; }
  delete() { store.delete(this.uri); }
  move(to: FakeFile | FakeDirectory) { const dest = to instanceof FakeDirectory ? `${to.uri}/${this.name}` : to.uri; store.set(dest, store.get(this.uri) ?? ''); store.delete(this.uri); this.uri = dest; }
  static downloadFileAsync = vi.fn(async (_url: string, dest: FakeFile | FakeDirectory) => { const f = dest instanceof FakeDirectory ? new FakeFile(dest, 'download') : dest; store.set(f.uri, 'mp3-bytes'); return f; });
}
const dirs = new Set<string>();
export function join(parts: (string | FakeDirectory | FakeFile)[]) { return parts.map(p => (typeof p === 'string' ? p : p.uri)).join('/'); }
export function reset() { store.clear(); dirs.clear(); FakeFile.downloadFileAsync.mockClear(); }
export const Paths = { document: new FakeDirectory('file:///doc'), cache: new FakeDirectory('file:///cache') };
export const fakeFileSystemModule = { File: FakeFile, Directory: FakeDirectory, Paths };
```

(Real `expo-file-system` `File.size` is `number | null` and `Directory.list()` returns `(Directory | File)[]`; `FakeFile.size` uses string length as a stand-in for bytes. Task 3 adds `FakeDownloadTask`.) Update `storage.test.ts` to use the shared fake and confirm it still passes.

- [ ] **Step 2: Write the failing tests**

```ts
// apps/mobile/__tests__/offlineStore.test.ts
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
```

- [ ] **Step 3: Run to verify failure** — `npm test --workspace @quran/mobile -- offlineStore` → FAIL.

- [ ] **Step 4: Implement**

```ts
// apps/mobile/src/offline/offlineStore.ts
import { Directory, File, Paths } from 'expo-file-system';
import type { AyahTiming, SurahTimings, TimingsStore } from '@quran/core';

/**
 * Where downloaded recitation lives, and the ONLY authority on what is
 * downloaded (spec §9): one folder per surah under the app's document
 * directory, holding that surah's ayah files and its `timings.json`, so a
 * downloaded surah plays with the network off. Nothing here keeps an index;
 * every question is answered by looking at the disk, because an index can
 * disagree with reality after a crash or an OS eviction and the failure is
 * the app promising a surah it cannot play.
 */
const ROOT = 'offline';
const TIMINGS_FILE = 'timings.json';
const TIMINGS_CACHE = 'timings';
const AUDIO = /^\d{6}\.mp3$/;

export function offlineDir(surahId: number): Directory {
  return new Directory(Paths.document, ROOT, String(surahId));
}

/** `"/audio/abdulbasit-murattal/001002.mp3"` → `"001002.mp3"`. */
export function audioFileName(ayah: AyahTiming): string {
  return ayah.audioUrl.split('/').pop() ?? `${ayah.ayah}.mp3`;
}

function audioFilesIn(dir: Directory): File[] {
  if (!dir.exists) return [];
  try {
    return dir.list().filter((e): e is File => e instanceof File && AUDIO.test(e.name));
  } catch {
    return [];
  }
}

export function isSurahDownloaded(surahId: number, expectedFiles: number): boolean {
  const dir = offlineDir(surahId);
  if (!dir.exists || expectedFiles <= 0) return false;
  if (!new File(dir, TIMINGS_FILE).exists) return false;
  return audioFilesIn(dir).length === expectedFiles;
}

export function downloadedSurahs(expectedFilesFor: (surahId: number) => number): number[] {
  const root = new Directory(Paths.document, ROOT);
  if (!root.exists) return [];
  const ids: number[] = [];
  try {
    for (const entry of root.list()) {
      if (!(entry instanceof Directory)) continue;
      const id = Number(entry.uri.split('/').pop());
      if (Number.isInteger(id) && isSurahDownloaded(id, expectedFilesFor(id))) ids.push(id);
    }
  } catch { /* an unreadable root reads as nothing downloaded */ }
  return ids.sort((a, b) => a - b);
}

export function surahBytesOnDisk(surahId: number): number {
  return audioFilesIn(offlineDir(surahId)).reduce((sum, f) => sum + (f.size ?? 0), 0);
}

export function deleteSurah(surahId: number): void {
  const dir = offlineDir(surahId);
  if (dir.exists) dir.delete();
}

/** The sequencer's `localPathFor` seam: the offline file for this ayah, if it is there. */
export function offlinePathFor(ayah: AyahTiming): string | null {
  const surahId = Number(audioFileName(ayah).slice(0, 3));
  const file = new File(offlineDir(surahId), audioFileName(ayah));
  return file.exists ? file.uri : null;
}

export async function readOfflineTimings(surahId: number): Promise<SurahTimings | null> {
  return readJson(new File(offlineDir(surahId), TIMINGS_FILE));
}

/** Makes the surah's folder self-contained. Called by the download manager only. */
export function writeOfflineTimings(surahId: number, timings: SurahTimings): void {
  const dir = offlineDir(surahId);
  if (!dir.exists) dir.create();
  const file = new File(dir, TIMINGS_FILE);
  if (!file.exists) file.create();
  file.write(JSON.stringify(timings));
}

async function readJson(file: File): Promise<SurahTimings | null> {
  try {
    if (!file.exists) return null;
    return JSON.parse(await file.text()) as SurahTimings;
  } catch {
    return null;
  }
}

/**
 * Core's `TimingsStore` seam. Reads prefer the surah's own folder (a
 * downloaded surah must play offline, timings included), then a cache of
 * timings fetched for streaming. Writes go to that cache ONLY: writing into
 * a surah's folder would create or half-fill one, and a folder must never
 * look more complete than the download that made it.
 */
export const offlineTimingsStore: TimingsStore = {
  async read(surahId) {
    return (await readOfflineTimings(surahId)) ?? (await readJson(new File(cacheDir(), `${surahId}.json`)));
  },
  async write(surahId, timings) {
    try {
      const dir = cacheDir();
      if (!dir.exists) dir.create();
      const file = new File(dir, `${surahId}.json`);
      if (!file.exists) file.create();
      file.write(JSON.stringify(timings));
    } catch { /* a cache miss next time is the only consequence */ }
  },
};

function cacheDir(): Directory {
  return new Directory(Paths.cache, TIMINGS_CACHE);
}
```

`TimingsStore` must be exported from `@quran/core`'s index; check `packages/core/src/index.ts` and add `export type { TimingsStore } from './player/timingsLoader'` if missing (type-only, no behaviour change; the web is unaffected).

- [ ] **Step 5: Run tests, typecheck, commit**

```bash
git add apps/mobile/src/offline/offlineStore.ts apps/mobile/__tests__/offlineStore.test.ts apps/mobile/__tests__/helpers/fakeFileSystem.ts apps/mobile/__tests__/storage.test.ts packages/core/src/index.ts
git commit -m "feat(mobile): offline store — the filesystem decides what is downloaded"
```

---

### Task 3: Download manager — progress, cancellation, resumption, the queue

**Files:**
- Create: `apps/mobile/src/offline/downloadManager.ts`
- Modify: `apps/mobile/__tests__/helpers/fakeFileSystem.ts` (add `FakeDownloadTask`)
- Test: `apps/mobile/__tests__/downloadManager.test.ts`

**Interfaces:**
- Consumes: Task 2's `offlineDir`, `audioFileName`, `isSurahDownloaded`, `writeOfflineTimings`, `deleteSurah`; core's `loadTimings`, `resolveAudioUrl`; Task 1's `surahAudioSize`.
- Produces:
  - `type DownloadState = { status: 'idle' } | { status: 'queued' } | { status: 'downloading'; done: number; total: number } | { status: 'done' } | { status: 'error'; message: string }`
  - `downloads` store: `getState(surahId): DownloadState`, `subscribe(cb)`, and hooks `useDownloadState(surahId): DownloadState`, `useDownloadedSurahs(): number[]` (re-derived from disk on every change).
  - Actions: `startDownload(surahId: number): void` (enqueues; one surah downloads at a time), `cancelDownload(surahId: number): void`, `removeDownload(surahId: number): void` (cancels if active, deletes the folder), `downloadAll(): void` (enqueues every surah not yet downloaded, in id order).
  - `refreshFromDisk(): void` — recomputes `done` states from the filesystem (call on app start and after any delete).

- [ ] **Step 1: Add a fake `DownloadTask` to the helper**

```ts
// in helpers/fakeFileSystem.ts
export const downloads: { url: string; dest: FakeFile; task: FakeDownloadTask }[] = [];
export let holdDownloads: RegExp | null = null;   // urls matching this stay pending until released
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
  releaseHeld() { this.release?.(); }
}
export function releaseAllHeld() { downloads.forEach(d => d.task.releaseHeld()); }
// add `DownloadTask: FakeDownloadTask` to fakeFileSystemModule, and reset `downloads`/holds in reset()
```

- [ ] **Step 2: Write the failing tests**

```ts
// apps/mobile/__tests__/downloadManager.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('expo-file-system', async () => (await import('./helpers/fakeFileSystem')).fakeFileSystemModule);
import { store, reset, downloads, setHoldDownloads, setFailDownloads, releaseAllHeld } from './helpers/fakeFileSystem';
import { configureTimings, primeTimings, resetTimingsCache } from '@quran/core';
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

beforeEach(() => { reset(); resetTimingsCache(); configureTimings({ baseUrl: 'https://example.test' }); primeTimings(112, timings(112, 4)); primeTimings(1, timings(1, 7)); dl.__resetForTests(); });

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
    expect(downloads.map(d => d.url)).toEqual([
      'https://github.com/umairnawaz333/quran-recite/releases/download/audio-112/112003.mp3',
      'https://github.com/umairnawaz333/quran-recite/releases/download/audio-112/112004.mp3',
    ].map(u => expect.stringContaining('112003') && u).slice(0, 0).concat(downloads.map(d => d.url)));
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
```

(The third test's `expect(downloads.map…)` line is deliberately simplified in implementation: assert `downloads.map(d => d.url.split('/').pop())` equals `['112003.mp3', '112004.mp3']`. Write it that way.) `resolveAudioUrl` must be configured: call `configureAudioBase('https://github.com/umairnawaz333/quran-recite/releases/download')` in `beforeEach` as the provider does, and derive expected URLs from `resolveAudioUrl` on the ayah's `audioUrl` rather than hardcoding the shard path.

- [ ] **Step 3: Run to verify failure.**

- [ ] **Step 4: Implement**

```ts
// apps/mobile/src/offline/downloadManager.ts
import { useSyncExternalStore } from 'react';
import { Directory, File, Paths, DownloadTask } from 'expo-file-system';
import { loadTimings, resolveAudioUrl } from '@quran/core';
import type { SurahTimings } from '@quran/core';
import { getSurahList } from '../data/surahs';
import { audioFileName, deleteSurah, downloadedSurahs, isSurahDownloaded, offlineDir, writeOfflineTimings } from './offlineStore';

export type DownloadState =
  | { status: 'idle' }
  | { status: 'queued' }
  | { status: 'downloading'; done: number; total: number }
  | { status: 'done' }
  | { status: 'error'; message: string };

/**
 * One surah at a time, in the order asked for, each file to a `.part` name
 * that is renamed only once its bytes are all there — so nothing partial
 * can ever be mistaken for a downloaded ayah, and a surah is "done" only
 * when `offlineStore` finds every file and the timings on disk. Cancelling
 * keeps the files already finished; starting again skips them.
 */
const states = new Map<number, DownloadState>();
const listeners = new Set<() => void>();
const queue: number[] = [];
let active: { surahId: number; task: DownloadTask | null; cancelled: boolean } | null = null;

function emit() { listeners.forEach(cb => cb()); }
function set(surahId: number, state: DownloadState) { states.set(surahId, state); emit(); }
function expectedFiles(surahId: number): number { return getSurahList().find(s => s.id === surahId)?.ayahCount ?? 0; }

export const downloads = {
  getState(surahId: number): DownloadState { return states.get(surahId) ?? { status: 'idle' }; },
  subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  /** Test seam: forget everything in memory (the fake disk is reset separately). */
  __resetForTests() { states.clear(); queue.length = 0; active = null; },
};

export function useDownloadState(surahId: number): DownloadState {
  return useSyncExternalStore(downloads.subscribe, () => downloads.getState(surahId));
}

let downloadedSnapshot: number[] = [];
export function useDownloadedSurahs(): number[] {
  return useSyncExternalStore(downloads.subscribe, () => downloadedSnapshot);
}

/** Re-derive "done" from the disk (spec §9: the filesystem is the truth). */
export function refreshFromDisk(): void {
  downloadedSnapshot = downloadedSurahs(expectedFiles);
  const done = new Set(downloadedSnapshot);
  for (const s of getSurahList()) {
    const current = states.get(s.id);
    if (done.has(s.id)) states.set(s.id, { status: 'done' });
    else if (current?.status === 'done') states.delete(s.id);
  }
  emit();
}

export function startDownload(surahId: number): void {
  const state = downloads.getState(surahId);
  if (state.status === 'queued' || state.status === 'downloading' || state.status === 'done') return;
  if (isSurahDownloaded(surahId, expectedFiles(surahId))) { set(surahId, { status: 'done' }); return; }
  set(surahId, { status: 'queued' });
  queue.push(surahId);
  void pump();
}

export function downloadAll(): void {
  for (const s of getSurahList()) startDownload(s.id);
}

export function cancelDownload(surahId: number): void {
  const i = queue.indexOf(surahId);
  if (i !== -1) { queue.splice(i, 1); set(surahId, { status: 'idle' }); return; }
  if (active?.surahId === surahId) { active.cancelled = true; active.task?.cancel(); }
}

export function removeDownload(surahId: number): void {
  cancelDownload(surahId);
  deleteSurah(surahId);
  states.delete(surahId);
  refreshFromDisk();
}

async function pump(): Promise<void> {
  if (active) return;
  const surahId = queue.shift();
  if (surahId === undefined) return;
  active = { surahId, task: null, cancelled: false };
  try {
    await downloadSurah(surahId, active);
  } finally {
    active = null;
    void pump();
  }
}

async function downloadSurah(surahId: number, ctl: { task: DownloadTask | null; cancelled: boolean }): Promise<void> {
  const total = expectedFiles(surahId);
  set(surahId, { status: 'downloading', done: 0, total });
  let timings: SurahTimings;
  try {
    timings = await loadTimings(surahId);
  } catch (err) {
    set(surahId, { status: 'error', message: err instanceof Error ? err.message : String(err) });
    return;
  }
  const dir = offlineDir(surahId);
  if (!dir.exists) dir.create();

  let done = 0;
  for (const ayah of timings.ayahs) {
    if (ctl.cancelled) { set(surahId, { status: 'idle' }); return; }
    const name = audioFileName(ayah);
    const final = new File(dir, name);
    if (final.exists) { done++; set(surahId, { status: 'downloading', done, total }); continue; }
    const part = new File(dir, `${name}.part`);
    if (part.exists) part.delete();
    const task = new DownloadTask(resolveAudioUrl(ayah.audioUrl), part);
    ctl.task = task;
    try {
      const result = await task.downloadAsync();
      if (ctl.cancelled || !result) { if (part.exists) part.delete(); set(surahId, { status: 'idle' }); return; }
      part.move(final);
    } catch (err) {
      if (part.exists) part.delete();
      if (ctl.cancelled) { set(surahId, { status: 'idle' }); return; }
      set(surahId, { status: 'error', message: err instanceof Error ? err.message : String(err) });
      return;
    } finally {
      task.release?.();
      ctl.task = null;
    }
    done++;
    set(surahId, { status: 'downloading', done, total });
  }
  // Timings last: the folder is self-contained only once every file is there.
  writeOfflineTimings(surahId, timings);
  refreshFromDisk();
  set(surahId, isSurahDownloaded(surahId, total) ? { status: 'done' } : { status: 'error', message: 'Download incomplete' });
}
```

Check `DownloadTask`'s real constructor and `downloadAsync()` signature in `node_modules/expo-file-system/build/NetworkTasks.d.ts` (`constructor(url, destination, options?)`, `downloadAsync(): Promise<File | null>`, `cancel(): void`, `release(): void`) and match them exactly; `file.move(destination: File | Directory)` is in `File.d.ts`.

- [ ] **Step 5: Run tests, typecheck, commit**

```bash
git add apps/mobile/src/offline/downloadManager.ts apps/mobile/__tests__/downloadManager.test.ts apps/mobile/__tests__/helpers/fakeFileSystem.ts
git commit -m "feat(mobile): per-surah downloads with progress, cancellation and resumption"
```

---

### Task 4: Play from the offline folder

**Files:**
- Modify: `apps/mobile/src/player/PlayerProvider.tsx` (~line 24 `configureTimings`, ~line 290 sequencer construction)
- Test: extend `apps/mobile/__tests__/PlayerProvider.test.tsx`

**Interfaces:**
- Consumes: Task 2's `offlinePathFor`, `offlineTimingsStore`; existing `localPathFor` (warm cache) and `cacheAyah`.

- [ ] **Step 1: Write the failing test** (in the existing harness; see `helpers/fakeAudio.ts` and how `provideTimings` primes core)

```ts
it('plays a downloaded surah from its offline folder, timings included, with no network', async () => {
  // No provideTimings(112): the only timings anywhere are the offline folder's.
  const fs = await import('./helpers/fakeFileSystem');
  const t = fakeTimingsFor(112, 4);             // build with the existing helper's shape
  fs.store.set('file:///doc/offline/112/timings.json', JSON.stringify(t));
  for (let n = 1; n <= 4; n++) fs.store.set(`file:///doc/offline/112/11200${n}.mp3`, 'x');

  const player = mountPlayer();
  await playFully(player, 112);

  expect(player.current.surahId).toBe(112);
  expect(sounding().loaded.at(-1)).toBe('file:///doc/offline/112/112001.mp3');
});
```

The harness mocks `expo-file-system` already (for `lastPosition`/`ayahCache`); switch that mock to the shared `fakeFileSystemModule` from Task 2 so the offline folder and the cache share one fake disk.

- [ ] **Step 2: Run to verify failure** (the load uses the network URL and timings fail).

- [ ] **Step 3: Implement**

In `PlayerProvider.tsx`:

```ts
import { offlinePathFor, offlineTimingsStore } from '../offline/offlineStore';
// module scope, next to configureAudioBase:
configureTimings({ baseUrl: 'https://quran-recite-eta.vercel.app', store: offlineTimingsStore });

/** Offline folder first, then the warm cache, else stream. */
function localAudioFor(ayah: AyahTiming): string | null {
  return offlinePathFor(ayah) ?? localPathFor(ayah);
}
// sequencer construction:
new AyahSequencer(timings.ayahs, createExpoPlayer, localAudioFor, cacheAyah)
```

Add a comment on `configureTimings` explaining that reads come from a downloaded surah's own folder first, so it plays with the network off.

- [ ] **Step 4: Run tests, typecheck, commit** — `git commit -m "feat(mobile): play downloaded surahs from their offline folder"`.

---

### Task 5: Theme — system / light / dark, app-wide, native highlight included

**Files:**
- Create: `apps/mobile/src/theme/theme.ts`
- Modify: `apps/mobile/modules/tajweed-text/android/src/main/java/expo/modules/tajweedtext/TajweedTextView.kt` (`highlightColor` var + use), `TajweedTextModule.kt` (Prop), `src/TajweedText.types.ts`
- Modify: `apps/mobile/App.tsx`, `apps/mobile/src/screens/SurahListScreen.tsx`, `apps/mobile/src/screens/ReaderScreen.tsx`, `apps/mobile/src/player/PlayerBar.tsx`, `apps/mobile/src/reader/TajweedLine.tsx`
- Test: `apps/mobile/__tests__/theme.test.ts`

**Interfaces:**
- Produces: `type ThemePreference = 'system' | 'light' | 'dark'`; `type Palette = { background, surface, text, textMuted, border, accent, accentText, highlight, error, errorText, loadingBg }` (hex strings); `LIGHT: Palette`, `DARK: Palette`; `resolveScheme(pref: ThemePreference, system: 'light' | 'dark' | null | undefined): 'light' | 'dark'`; `readThemePreference(): Promise<ThemePreference>`, `writeThemePreference(p: ThemePreference): void`; `ThemeProvider` (reads the preference on mount, listens to `useColorScheme()`), `useTheme(): { palette: Palette; scheme: 'light' | 'dark' }`, `useThemePreference(): [ThemePreference, (p: ThemePreference) => void]`.
- Native: `TajweedTextView` prop `highlightColor: string` (hex), replacing the fixed `HIGHLIGHT_COLOR`.

- [ ] **Step 1: Failing tests**

```ts
// apps/mobile/__tests__/theme.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('expo-file-system', async () => (await import('./helpers/fakeFileSystem')).fakeFileSystemModule);
import { store, reset } from './helpers/fakeFileSystem';
import { resolveScheme, readThemePreference, writeThemePreference, LIGHT, DARK } from '../src/theme/theme';

beforeEach(reset);

describe('theme', () => {
  it('"system" follows the device, and falls back to light when the device says nothing', () => {
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', 'light')).toBe('light');
    expect(resolveScheme('system', null)).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
    expect(resolveScheme('light', 'dark')).toBe('light');
  });

  it('persists the preference and reads system when nothing or garbage is stored', async () => {
    expect(await readThemePreference()).toBe('system');
    writeThemePreference('dark');
    expect(await readThemePreference()).toBe('dark');
    store.set('file:///doc/theme.json', '"purple"');
    expect(await readThemePreference()).toBe('system');
  });

  it('palettes cover every key in both schemes with distinct backgrounds', () => {
    expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort());
    expect(LIGHT.background).not.toBe(DARK.background);
    expect(LIGHT.highlight).toBe('#fde68a');          // the web's .word--active tint stays on light
  });
});
```

- [ ] **Step 2: Implement `theme.ts`**

```ts
// apps/mobile/src/theme/theme.ts
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { File, Paths } from 'expo-file-system';

export type ThemePreference = 'system' | 'light' | 'dark';
export type Scheme = 'light' | 'dark';

export interface Palette {
  background: string; surface: string; text: string; textMuted: string; border: string;
  accent: string; accentText: string; highlight: string; error: string; errorText: string; loadingBg: string;
}

export const LIGHT: Palette = {
  background: '#ffffff', surface: '#f3f4f6', text: '#1a1a1a', textMuted: '#777777', border: '#e5e7eb',
  accent: '#1a1a1a', accentText: '#ffffff', highlight: '#fde68a', error: '#fee2e2', errorText: '#991b1b', loadingBg: '#f3f4f6',
};
export const DARK: Palette = {
  background: '#0f1115', surface: '#1b1f27', text: '#f3f4f6', textMuted: '#9ca3af', border: '#2a2f3a',
  accent: '#f3f4f6', accentText: '#0f1115', highlight: '#6b5b12', error: '#4c1d1d', errorText: '#fecaca', loadingBg: '#1b1f27',
};

/** "system" is a live state: it resolves against whatever the device says NOW. */
export function resolveScheme(pref: ThemePreference, system: Scheme | null | undefined): Scheme {
  if (pref === 'system') return system === 'dark' ? 'dark' : 'light';
  return pref;
}

const FILE_NAME = 'theme.json';
const VALID: ThemePreference[] = ['system', 'light', 'dark'];
export async function readThemePreference(): Promise<ThemePreference> {
  try {
    const file = new File(Paths.document, FILE_NAME);
    if (!file.exists) return 'system';
    const parsed: unknown = JSON.parse(await file.text());
    return VALID.includes(parsed as ThemePreference) ? (parsed as ThemePreference) : 'system';
  } catch { return 'system'; }
}
export function writeThemePreference(pref: ThemePreference): void {
  try {
    const file = new File(Paths.document, FILE_NAME);
    if (!file.exists) file.create();
    file.write(JSON.stringify(pref));
  } catch { /* losing the preference is acceptable */ }
}

const ThemeContext = createContext<{ palette: Palette; scheme: Scheme; preference: ThemePreference; setPreference: (p: ThemePreference) => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  useEffect(() => { void readThemePreference().then(setPreferenceState); }, []);
  const setPreference = useCallback((p: ThemePreference) => { setPreferenceState(p); writeThemePreference(p); }, []);
  const scheme = resolveScheme(preference, system);
  const value = useMemo(() => ({ palette: scheme === 'dark' ? DARK : LIGHT, scheme, preference, setPreference }), [scheme, preference, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): { palette: Palette; scheme: Scheme } {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return { palette: ctx.palette, scheme: ctx.scheme };
}
export function useThemePreference(): [ThemePreference, (p: ThemePreference) => void] {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemePreference must be used inside <ThemeProvider>');
  return [ctx.preference, ctx.setPreference];
}
```

(The file must be `.tsx` for the JSX: name it `apps/mobile/src/theme/theme.tsx`; tests import `'../src/theme/theme'`.)

- [ ] **Step 3: Native `highlightColor` prop**

`TajweedTextView.kt`: `var highlightColor: String = "#fde68a"`; in `render()` use `BackgroundColorSpan(parseColorOr(highlightColor, HIGHLIGHT_COLOR))`. `TajweedTextModule.kt`: `Prop("highlightColor") { view: TajweedTextView, value: String -> view.highlightColor = value }`. `TajweedText.types.ts`: `highlightColor: string;` documented as the recited word's background. `TajweedLine.tsx`: pass `highlightColor={palette.highlight}` (Android) and use it in the iOS `styles.highlight` equivalent via inline style.

- [ ] **Step 4: Apply the theme across the app**

Wrap the tree in `App.tsx`: `<ThemeProvider>` outside `<PlayerProvider>`; `SafeAreaView` background = `palette.background`; `<StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />` (read via a small inner component, since `App` renders the provider). Replace every hardcoded colour in `SurahListScreen`, `ReaderScreen` (header, banners, `ARABIC_COLOR` → `palette.text`, ayah number/footer greys → `textMuted`), `PlayerBar` (root/border/toggle/side icons), and `PlayerIcons` callers with palette values; keep the tajweed rule colours unchanged (they are the reading standard on both schemes). Keep `StyleSheet.create` for static layout and apply colours via inline `{ color: palette.x }` objects.

- [ ] **Step 5: Run tests, typecheck, native rebuild, verify all three states on the emulator** (`adb shell cmd uimode night yes|no` flips the system scheme; with the preference on `system` the app must follow within a second). Commit: `git commit -m "feat(mobile): system/light/dark theme across the app, including the native highlight"`.

---

### Task 6: Download control in the list and the reader

**Files:**
- Create: `apps/mobile/src/components/DownloadControl.tsx`
- Modify: `apps/mobile/src/screens/SurahListScreen.tsx` (row), `apps/mobile/src/screens/ReaderScreen.tsx` (header)
- Test: `apps/mobile/__tests__/DownloadControl.test.tsx` (render with the `react-test-renderer` harness; mock `expo-file-system` with the shared fake and drive `downloads`)

**Interfaces:**
- Consumes: Task 3's `useDownloadState`, `startDownload`, `cancelDownload`, `removeDownload`; Task 1's `surahAudioSize`, `formatBytes`; Task 5's `useTheme`.
- Produces: `DownloadControl({ surahId, compact }: { surahId: number; compact?: boolean })`.

- [ ] **Step 1: Failing test** — renders the three states from `downloads` state: idle shows a download glyph labelled `Download Al-Fatihah (0.9 MB)`; downloading shows `3 / 7` and a cancel affordance labelled `Cancel download`; done shows a check labelled `Downloaded, tap to delete`; tapping done calls `Alert.alert` (mock `react-native`'s `Alert`) whose destructive button calls `removeDownload`.

- [ ] **Step 2: Implement**

```tsx
// apps/mobile/src/components/DownloadControl.tsx
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useDownloadState, startDownload, cancelDownload, removeDownload } from '../offline/downloadManager';
import { surahAudioSize, formatBytes } from '../offline/audioSizes';
import { getSurahMeta } from '../data/surahs';
import { useTheme } from '../theme/theme';

/** Three visible states (spec §9): not downloaded, downloading with progress, downloaded. */
export function DownloadControl({ surahId, compact = false }: { surahId: number; compact?: boolean }) {
  const state = useDownloadState(surahId);
  const { palette } = useTheme();
  const name = getSurahMeta(surahId)?.nameSimple ?? `Surah ${surahId}`;
  const size = formatBytes(surahAudioSize(surahId).bytes);

  if (state.status === 'downloading' || state.status === 'queued') {
    const label = state.status === 'downloading' ? `${state.done} / ${state.total}` : 'Queued';
    return (
      <Pressable onPress={() => cancelDownload(surahId)} accessibilityRole="button" accessibilityLabel="Cancel download" style={styles.control}>
        <Text style={[styles.progress, { color: palette.textMuted }]}>{label}</Text>
        <Text style={[styles.cancel, { color: palette.textMuted }]}>✕</Text>
      </Pressable>
    );
  }
  if (state.status === 'done') {
    return (
      <Pressable
        onPress={() => Alert.alert(`Delete ${name}?`, `Frees ${size} of storage.`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => removeDownload(surahId) },
        ])}
        accessibilityRole="button" accessibilityLabel="Downloaded, tap to delete" style={styles.control}
      >
        <Svg width={20} height={20} viewBox="0 0 24 24"><Path d="M5 12.5 10 17.5 19 7" stroke={palette.text} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={() => startDownload(surahId)} accessibilityRole="button" accessibilityLabel={`Download ${name} (${size})`} style={styles.control}>
      <Svg width={20} height={20} viewBox="0 0 24 24"><Path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" stroke={palette.textMuted} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg>
      {!compact && <Text style={[styles.size, { color: palette.textMuted }]}>{size}</Text>}
      {state.status === 'error' && <Text style={[styles.size, { color: palette.errorText }]}>Retry</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  control: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, paddingHorizontal: 6 },
  progress: { fontSize: 12, fontVariant: ['tabular-nums'] },
  cancel: { fontSize: 14 },
  size: { fontSize: 11 },
});
```

Place it in each `SurahListScreen` row between the English name and the Arabic name (the row's `onPress` opens the surah; the control's own `Pressable` handles its taps), and in the `ReaderScreen` header next to the script toggle with `compact`. Call `refreshFromDisk()` once when `App` mounts (a `useEffect` in `App`), so "done" reflects the disk on launch.

- [ ] **Step 3: Tests, typecheck, emulator check (download Al-Fatihah — progress ticks 0..7 — then delete), commit** — `git commit -m "feat(mobile): per-surah download control in the list and the reader"`.

---

### Task 7: Settings screen

**Files:**
- Create: `apps/mobile/src/screens/SettingsScreen.tsx`
- Modify: `apps/mobile/App.tsx` (screen state `'list' | 'reader' | 'settings'`; home header), `apps/mobile/src/screens/SurahListScreen.tsx` (header row with title `Quran` and a Settings button, `accessibilityLabel="Settings"`)
- Modify: `apps/mobile/package.json` (`npx expo install expo-application`)
- Test: `apps/mobile/__tests__/SettingsScreen.test.tsx`

**Interfaces:**
- Consumes: Task 3 (`useDownloadedSurahs`, `useDownloadState`, `removeDownload`, `downloadAll`, `cancelDownload`), Task 2 (`surahBytesOnDisk`), Task 1 (`allAudioSize`, `formatBytes`), Task 5 (`useTheme`, `useThemePreference`), `expo-application`'s `nativeApplicationVersion`.
- Produces: `SettingsScreen({ onBack, onOpenSurah }: { onBack: () => void; onOpenSurah: (id: number) => void })`.

- [ ] **Step 1: Failing tests** — with two surahs complete on the fake disk: renders their names with sizes and the total (`formatBytes` of the two on-disk sums); `Delete all` confirms via `Alert.alert` and then `useDownloadedSurahs()` is empty; `Download all` shows an `Alert.alert` whose message contains `2.5 GB` (from `allAudioSize()`) before `downloadAll` is called; the theme section has three options labelled `System`, `Light`, `Dark` with the selected one marked (`accessibilityState={{ selected: true }}`), tapping `Dark` writes `"dark"` to `file:///doc/theme.json`; the About section shows the mocked `nativeApplicationVersion` (`vi.mock('expo-application', () => ({ nativeApplicationVersion: '1.2.3' }))`) as `Version 1.2.3` and the exact text `Umair Nawaz 2026`.

- [ ] **Step 2: Implement** — three sections in a `ScrollView`:

```tsx
// Offline
const downloaded = useDownloadedSurahs();
const total = downloaded.reduce((sum, id) => sum + surahBytesOnDisk(id), 0);
// rows: name · formatBytes(surahBytesOnDisk(id)) · a Delete button (Alert confirm → removeDownload)
// "Download all (X GB)" where X = formatBytes(allAudioSize().bytes) → Alert.alert('Download everything?', `This downloads the whole recitation — ${formatBytes(allAudioSize().bytes)} over ${allAudioSize().files.toLocaleString()} files. Keep the app open on Wi-Fi.`, [Cancel, { text: 'Download', onPress: downloadAll }])
// "Delete all" → Alert confirm → downloaded.forEach(removeDownload)
// Appearance: three Pressables; useThemePreference()
// About: `Version ${nativeApplicationVersion ?? '—'}` and 'Umair Nawaz 2026'
```

Also show any in-progress downloads (status `downloading`/`queued`) above the list with their progress and a Cancel — `useDownloadState` per surah from `getSurahList()`; keep it to those not idle.

- [ ] **Step 3: Navigation** — in `App.tsx`, `const [screen, setScreen] = useState<'list' | 'reader' | 'settings'>('list')`; `SurahListScreen` gets `onOpenSettings`; `SettingsScreen` `onBack` returns to the list; the `PlayerBar` stays on every screen. The home header: `Quran` title left, a gear glyph (`Svg` path `M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7Zm7.4-2.6…` — any standard gear path is acceptable; label it `Settings`).

- [ ] **Step 4: Install `expo-application`** (`cd apps/mobile && npx expo install expo-application`) — native module: rebuild required; commit `package.json` + root `package-lock.json`.

- [ ] **Step 5: Tests, typecheck, rebuild, emulator check of all three sections, commit** — `git commit -m "feat(mobile): settings — offline management, theme, version and credit"`.

---

### Task 8: Manual verification on the emulator, docs

**Files:**
- Modify: `apps/mobile/README.md` (Offline & Settings sections; how to regenerate the size manifest), `README.md` (test counts), `docs/DATA_SOURCES.md` (the manifest)

- [ ] **Step 1: Verify on the emulator (release build), per spec §12** — download Al-Fatihah with visible progress; start Al-Kahf (53 MB, 110 files), cancel at ~30 %, confirm no `.part` file remains (`adb shell run-as` is unavailable on a release build — verify instead via the Settings list not showing it and the control returning to "download") and restart resumes past the files already fetched (progress starts above 0); delete a surah from Settings and from its control; **airplane mode** (`adb shell svc wifi disable && adb shell svc data disable`), play the downloaded Al-Fatihah end to end with word highlighting, then restore (`svc wifi enable && svc data enable`); theme in all three states, including `system` following `adb shell cmd uimode night yes` / `no` without restarting; About shows the version from `app.json`'s `version` (which `expo-application` reports as the native version) above `Umair Nawaz 2026`.

- [ ] **Step 2: Docs and counts** — describe the offline folder layout, the manifest and `npm run build:audio-sizes`, the theme file, and correct both READMEs' test counts to the live numbers. Commit: `git commit -m "docs: offline, settings, and the audio size manifest"`.

---

## Self-Review

**Spec coverage (§9, §10, §14):**

| Requirement | Task |
|---|---|
| Build-time size manifest; UI shows size before committing | 1, 6, 7 |
| App-private storage, folder per surah with timings; uninstall reclaims | 2 |
| Resumable, cancellable, one at a time, per-surah progress | 3 |
| Partial never presents as complete; filesystem is the truth | 2 (`.part` excluded; completeness by count + timings), 3 (temp + rename; `refreshFromDisk`) |
| Per-surah control with three states in list and reader; delete on tap | 6 |
| Settings from home; downloaded list with sizes and total; delete one/all; download all behind 2.5 GB confirmation | 7 |
| Theme system/light/dark, system live | 5, 7 |
| Version from the native application; `Umair Nawaz 2026` | 7 |
| Plays with the network off | 4, verified in 8 |
| Core dependency-free, web unchanged | Global Constraints; Task 2 adds only a type re-export to core |

**Placeholder scan:** no TBDs. Task 7's gear path is explicitly "any standard gear path"; Task 6's SVG paths are given. Task 3's third test is flagged and its intended assertion stated.

**Type consistency:** `DownloadState` is defined once (Task 3) and consumed in 6 and 7 by the same field names; `offlinePathFor(ayah: AyahTiming)` matches the sequencer's `localPathFor?: (ayah: AyahTiming) => string | null`; `TimingsStore` is core's existing interface; `Palette` keys used in Tasks 6/7 (`text`, `textMuted`, `errorText`) exist in Task 5.

**Two things to flag to the user rather than bury:**
1. Downloads run only while the app is in the foreground or backgrounded-but-alive; there is no OS-level background transfer service, so a 2.5 GB "download all" needs the app kept open (the confirmation says so). A foreground service for downloads is a possible follow-up.
2. The dark palette's tajweed rule colours are the same as light; most read fine on the dark surface, but this was not tuned letter by letter and may want a pass with the user.
