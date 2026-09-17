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

/** Re-derive "done" from the disk (the filesystem is the source of truth). */
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
      // `move` resolves once the rename is actually done — reporting progress
      // or starting the next file before that lands could count a `.part`
      // as complete, or race a cancel/crash into losing the final file.
      await part.move(final);
      if (!final.exists) {
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
