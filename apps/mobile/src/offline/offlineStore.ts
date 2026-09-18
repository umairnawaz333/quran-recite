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
/** The temp name a file is downloaded under until all of its bytes are there. */
const PART = '.part';

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

export interface OfflineScan {
  /** Complete, playable surahs: timings plus every ayah file. */
  downloaded: number[];
  /**
   * Folders holding ayah files but not complete — what a cancelled or
   * killed download leaves behind. Invisible before this: no Settings row,
   * not in the total, skipped by Delete all, never cleaned up.
   */
  incomplete: number[];
  /** Bytes of the ayah files in those incomplete folders. */
  incompleteBytes: number;
  /** Every `.part` file found, with the surah whose folder holds it. */
  partFiles: { surahId: number; file: File }[];
}

/**
 * One walk of `offline/` answering everything the app asks of the disk.
 *
 * One walk, not one per question: a directory listing is a synchronous hop
 * into native code per folder, and the caller (`refreshFromDisk`) runs on
 * every state change with up to 114 folders under it.
 *
 * Deliberately pure — `partFiles` is reported, never deleted here, because
 * only the download manager knows which surah is being downloaded right now
 * and therefore which `.part` is alive.
 */
export function scanOffline(expectedFilesFor: (surahId: number) => number): OfflineScan {
  const scan: OfflineScan = { downloaded: [], incomplete: [], incompleteBytes: 0, partFiles: [] };
  const root = new Directory(Paths.document, ROOT);
  if (!root.exists) return scan;
  let entries: (Directory | File)[];
  try {
    entries = root.list();
  } catch {
    return scan;            // an unreadable root reads as nothing downloaded
  }
  for (const entry of entries) {
    if (!(entry instanceof Directory)) continue;
    // `name`, never `uri.split('/').pop()`: a real `Directory.uri` ends
    // with a slash, so popping its last segment yields the empty string —
    // `Number('')` is 0, and every folder was silently discarded, which on
    // a device meant nothing was ever "downloaded" after a restart.
    const id = Number(entry.name);
    if (!Number.isInteger(id) || id <= 0) continue;
    let files: File[];
    try {
      files = entry.list().filter((e): e is File => e instanceof File);
    } catch {
      continue;             // a folder that vanished mid-walk is simply not there
    }
    for (const file of files) if (file.name.endsWith(PART)) scan.partFiles.push({ surahId: id, file });
    const audio = files.filter(f => AUDIO.test(f.name));
    const expected = expectedFilesFor(id);
    if (expected > 0 && audio.length === expected && files.some(f => f.name === TIMINGS_FILE)) {
      scan.downloaded.push(id);
    } else if (audio.length > 0) {
      scan.incomplete.push(id);
      scan.incompleteBytes += audio.reduce((sum, f) => sum + (f.size ?? 0), 0);
    }
  }
  scan.downloaded.sort((a, b) => a - b);
  scan.incomplete.sort((a, b) => a - b);
  return scan;
}

export function downloadedSurahs(expectedFilesFor: (surahId: number) => number): number[] {
  return scanOffline(expectedFilesFor).downloaded;
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
  // See the matching comment in `downloadManager.ts`: two levels below the
  // document directory, so the leaf-only default fails when "offline" itself
  // doesn't exist yet.
  if (!dir.exists) dir.create({ intermediates: true });
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
