import { Directory, File, Paths } from 'expo-file-system';
import { resolveAudioUrl } from '@quran/core';
import type { AyahTiming } from '@quran/core';

/**
 * A small on-device cache of recently recited ayah files.
 *
 * Why: the sequencer preloads only the *next* ayah, so "previous" — and
 * replaying an ayah you just heard — streamed the file again from the
 * network, which the user felt as lag. React Native's `fetch`/ExoPlayer
 * have no shared HTTP disk cache to lean on, so this keeps the last
 * `MAX_FILES` recited ayahs in the app's cache directory and hands the
 * sequencer a `file://` path for any of them through its existing
 * `localPathFor` seam (see `resolveAyahSource` in core — playback never
 * branches on where the bytes came from).
 *
 * This is deliberately NOT the offline feature (Stage 2 §9): nothing here is
 * user-visible, nothing is guaranteed to be kept, and the OS may clear the
 * cache directory at will. It is a warm cache, and only that.
 */
const DIR_NAME = 'ayah-cache';
const MAX_FILES = 300;

/**
 * `"/audio/abdulbasit-murattal/001002.mp3"` → `"abdulbasit-murattal_001002.mp3"`.
 * Flat, reciter-qualified, and free of path separators, so two reciters'
 * recordings of the same ayah can never collide in one directory.
 */
export function cacheFileName(audioUrl: string): string {
  const parts = audioUrl.split('/').filter(Boolean);
  const file = parts.at(-1) ?? 'unknown.mp3';
  const reciter = parts.length >= 2 ? parts[parts.length - 2] : 'unknown';
  return `${reciter}_${file}`;
}

function cacheDir(): Directory {
  const dir = new Directory(Paths.cache, DIR_NAME);
  if (!dir.exists) dir.create();
  return dir;
}

/** Sync: consulted by the sequencer at load time, must not await. */
export function localPathFor(ayah: AyahTiming): string | null {
  try {
    const file = new File(cacheDir(), cacheFileName(ayah.audioUrl));
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

const inFlight = new Map<string, Promise<void>>();

/**
 * Download `ayah`'s file into the cache if it is not already there. Safe to
 * call repeatedly and concurrently for the same ayah; failures are swallowed
 * because a missing cache entry just means the next play streams as before.
 */
export function cacheAyah(ayah: AyahTiming): Promise<void> {
  const name = cacheFileName(ayah.audioUrl);
  const pending = inFlight.get(name);
  if (pending) return pending;

  const task = (async () => {
    try {
      const dir = cacheDir();
      const target = new File(dir, name);
      if (target.exists) return;
      await File.downloadFileAsync(resolveAudioUrl(ayah.audioUrl), target);
      evictIfNeeded(dir);
    } catch {
      // Offline, or the download was refused — the sequencer streams instead.
    }
  })();
  // Registered before the settle hook, never inside the task: an async
  // function that returns synchronously (a cache hit) would otherwise run
  // its `finally` before the `set`, leaving a settled promise registered
  // forever — and every later call for that ayah "deduped" against it,
  // never re-downloading a file the eviction or the OS had since removed.
  inFlight.set(name, task);
  void task.finally(() => {
    if (inFlight.get(name) === task) inFlight.delete(name);
  });
  return task;
}

/** Keep the directory bounded: drop the least recently modified files first. */
function evictIfNeeded(dir: Directory): void {
  try {
    const files = dir.list().filter((entry): entry is File => entry instanceof File);
    if (files.length <= MAX_FILES) return;
    files
      .sort((a, b) => (a.modificationTime ?? 0) - (b.modificationTime ?? 0))
      .slice(0, files.length - MAX_FILES)
      .forEach(file => { try { file.delete(); } catch { /* ignore */ } });
  } catch {
    // Listing failed; nothing to evict.
  }
}
