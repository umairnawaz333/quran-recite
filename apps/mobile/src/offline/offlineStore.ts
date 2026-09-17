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
