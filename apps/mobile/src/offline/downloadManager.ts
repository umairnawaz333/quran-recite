import { useSyncExternalStore } from 'react';
import { Directory, File, DownloadTask } from 'expo-file-system';
import { loadTimings, resolveAudioUrl } from '@quran/core';
import type { SurahTimings } from '@quran/core';
import { getSurahList } from '../data/surahs';
import { audioFileName, deleteSurah, isSurahDownloaded, offlineDir, scanOffline, writeOfflineTimings } from './offlineStore';

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

// The default for a surah `states` has never touched. A single shared
// reference — not a fresh literal per call — because `useDownloadState`
// reads this through `useSyncExternalStore`, which compares snapshots by
// `Object.is`: a new object on every call reads as "changed" on every
// render and forces an infinite re-render loop for any surah still idle.
const IDLE_STATE: DownloadState = { status: 'idle' };
// Shared for the same reason, one step further on: `refreshFromDisk` runs
// on every state change and used to hand each downloaded surah a FRESH
// `{ status: 'done' }`, which `useDownloadState`'s `Object.is` snapshot
// comparison reads as a change — so every done row in a 114-row list
// re-rendered on every refresh.
const DONE_STATE: DownloadState = { status: 'done' };

export const downloads = {
  getState(surahId: number): DownloadState { return states.get(surahId) ?? IDLE_STATE; },
  subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  /** The snapshot backing `useDownloadedSurahs` — same array reference across a no-op `refreshFromDisk()`. */
  downloaded(): number[] { return downloadedSnapshot; },
  /** The snapshot backing `useIncompleteDownloads`, stable the same way. */
  incomplete(): IncompleteDownloads { return incompleteSnapshot; },
  /** Test seam: forget everything in memory (the fake disk is reset separately). */
  __resetForTests() {
    states.clear();
    queue.length = 0;
    active = null;
    downloadedSnapshot = [];
    incompleteSnapshot = NOTHING_INCOMPLETE;
  },
};

export function useDownloadState(surahId: number): DownloadState {
  return useSyncExternalStore(downloads.subscribe, () => downloads.getState(surahId));
}

let downloadedSnapshot: number[] = [];
export function useDownloadedSurahs(): number[] {
  return useSyncExternalStore(downloads.subscribe, () => downloadedSnapshot);
}

/** The folders a cancelled or killed download left behind, and their size. */
export interface IncompleteDownloads { ids: number[]; bytes: number }

const NOTHING_INCOMPLETE: IncompleteDownloads = { ids: [], bytes: 0 };
let incompleteSnapshot: IncompleteDownloads = NOTHING_INCOMPLETE;

/**
 * What Settings shows as "Incomplete downloads": leftovers that are not
 * playable, are taking up space, and belong in the disk total.
 */
export function useIncompleteDownloads(): IncompleteDownloads {
  return useSyncExternalStore(downloads.subscribe, () => incompleteSnapshot);
}

function sameIds(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Re-derive "done" from the disk (the filesystem is the source of truth).
 * Keeps the previous snapshot array (same reference) when nothing actually
 * changed, so `useDownloadedSurahs()` — a `useSyncExternalStore` snapshot —
 * does not force a re-render on a no-op refresh.
 */
export function refreshFromDisk(): void {
  const scan = scanOffline(expectedFiles, active?.surahId);
  // A `.part` anywhere but the folder being downloaded RIGHT NOW is a
  // leftover from a download that was cancelled or killed with the app: its
  // bytes are unusable (nothing resumes a part file — see the manager's
  // header) and nothing else would ever remove them. The active download's
  // own `.part` is the one file on disk that is still being written to.
  for (const { surahId, file } of scan.partFiles) {
    if (surahId === active?.surahId) continue;
    try { file.delete(); } catch { /* it will be found again next refresh */ }
  }
  if (!sameIds(scan.downloaded, downloadedSnapshot)) downloadedSnapshot = scan.downloaded;
  if (!sameIds(scan.incomplete, incompleteSnapshot.ids) || scan.incompleteBytes !== incompleteSnapshot.bytes) {
    incompleteSnapshot = scan.incomplete.length === 0
      ? NOTHING_INCOMPLETE
      : { ids: scan.incomplete, bytes: scan.incompleteBytes };
  }
  const done = new Set(downloadedSnapshot);
  for (const s of getSurahList()) {
    const current = states.get(s.id);
    if (done.has(s.id)) { if (current?.status !== 'done') states.set(s.id, DONE_STATE); }
    else if (current?.status === 'done') states.delete(s.id);
  }
  emit();
}

export function startDownload(surahId: number): void {
  const state = downloads.getState(surahId);
  if (state.status === 'queued' || state.status === 'downloading' || state.status === 'done') return;
  // refreshFromDisk (not a bare `set`) so useDownloadedSurahs() cannot lag useDownloadState().
  if (isSurahDownloaded(surahId, expectedFiles(surahId))) { refreshFromDisk(); return; }
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
  removeDownloads([surahId]);
}

/**
 * Delete several surahs' folders with ONE disk walk, at the end.
 *
 * `ids.forEach(removeDownload)` was one full `refreshFromDisk()` — the
 * `offline/` root plus every folder under it — per surah, all of it
 * synchronous JSI work inside an Alert callback: at 114 surahs that is an
 * ANR, not a delay.
 */
export function removeDownloads(ids: number[]): void {
  for (const surahId of ids) {
    cancelDownload(surahId);
    deleteSurah(surahId);
    states.delete(surahId);
  }
  refreshFromDisk();
}

/**
 * Everything the app is holding on disk: the complete downloads and the
 * incomplete leftovers, which are what the Settings total counts.
 *
 * The leading refresh is the confirm-time re-read — a surah that finished
 * downloading while the confirmation dialog was open is on disk by the time
 * this fires and must not be left behind — so this is two walks in total,
 * whatever the number of surahs.
 */
export function deleteAllDownloads(): void {
  refreshFromDisk();
  removeDownloads([...downloadedSnapshot, ...incompleteSnapshot.ids]);
}

async function pump(): Promise<void> {
  if (active) return;
  const surahId = queue.shift();
  if (surahId === undefined) return;
  const ctl = { surahId, task: null, cancelled: false };
  active = ctl;
  try {
    await downloadSurah(surahId, ctl);
  } finally {
    // Only this generation's own slot — a chain still unwinding from an
    // un-abortable await (e.g. a real network fetch with no AbortController)
    // must not clear a *newer* generation's `active` out from under it were
    // one somehow already running by the time this settles.
    if (active === ctl) active = null;
    // A download that did not finish (cancelled, or failed) leaves finished
    // files behind that are now leftovers — walk the disk once so Settings'
    // "Incomplete downloads" row and total show them right away, and the
    // `.part` sweep can now reach this folder too (`active` is clear).
    if (downloads.getState(surahId).status !== 'done') refreshFromDisk();
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
    if (ctl.cancelled) { set(surahId, { status: 'idle' }); return; }
    set(surahId, { status: 'error', message: err instanceof Error ? err.message : String(err) });
    return;
  }
  const dir = offlineDir(surahId);
  // `intermediates: true` — `offlineDir` is two levels below the document
  // directory ("offline/<id>"), and a plain `create()` only makes the leaf,
  // failing outright the first time any surah is ever downloaded (no
  // "offline" folder yet exists to be its parent).
  try {
    if (!dir.exists) dir.create({ intermediates: true });
  } catch (err) {
    if (ctl.cancelled) { set(surahId, { status: 'idle' }); return; }
    set(surahId, { status: 'error', message: err instanceof Error ? err.message : String(err) });
    return;
  }

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
      // `move` resolves once the rename is actually done — reporting progress
      // or starting the next file before that lands could count a `.part`
      // as complete, or race a cancel/crash into losing the final file.
      await part.move(final);
      if (!final.exists) {
        if (part.exists) part.delete();
        if (ctl.cancelled) { set(surahId, { status: 'idle' }); return; }
        set(surahId, { status: 'error', message: `rename failed for ${name}` });
        return;
      }
    } catch (err) {
      if (part.exists) part.delete();
      if (ctl.cancelled) { set(surahId, { status: 'idle' }); return; }
      set(surahId, { status: 'error', message: err instanceof Error ? err.message : String(err) });
      return;
    } finally {
      task.release();
      ctl.task = null;
    }
    done++;
    set(surahId, { status: 'downloading', done, total });
  }
  // Timings last: the folder is self-contained only once every file is there.
  writeOfflineTimings(surahId, timings);
  refreshFromDisk();
  set(surahId, isSurahDownloaded(surahId, total) ? DONE_STATE : { status: 'error', message: 'Download incomplete' });
}
