import { useSyncExternalStore } from 'react';
import { Directory, File, DownloadTask } from 'expo-file-system';
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

// The default for a surah `states` has never touched. A single shared
// reference — not a fresh literal per call — because `useDownloadState`
// reads this through `useSyncExternalStore`, which compares snapshots by
// `Object.is`: a new object on every call reads as "changed" on every
// render and forces an infinite re-render loop for any surah still idle.
const IDLE_STATE: DownloadState = { status: 'idle' };

export const downloads = {
  getState(surahId: number): DownloadState { return states.get(surahId) ?? IDLE_STATE; },
  subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  /** The snapshot backing `useDownloadedSurahs` — same array reference across a no-op `refreshFromDisk()`. */
  downloaded(): number[] { return downloadedSnapshot; },
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
  const next = downloadedSurahs(expectedFiles);
  if (!sameIds(next, downloadedSnapshot)) downloadedSnapshot = next;
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
  cancelDownload(surahId);
  deleteSurah(surahId);
  states.delete(surahId);
  refreshFromDisk();
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
  if (!dir.exists) dir.create({ intermediates: true });

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
      // Optional chaining: the fake's `release` field starts `null` until a
      // held download sets it, unlike the real API's always-present method.
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
