'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AyahPlaylist } from '@/lib/audio/playlist';
import { SyncEngine } from '@/lib/sync/engine';
import { Timeline } from '@/lib/sync/timeline';
import { loadTimings, primeTimings as primeTimingsCache } from '@/lib/player/timingsLoader';
import { readLastPosition, writeLastPosition } from '@/lib/player/lastPosition';
import { getSurahList } from '@/lib/data/loaders';
import { PlayerContext, type PlayerState } from './usePlayer';
import type { SurahTimings } from '@/lib/data/types';
import type { WordRegistry } from '@/lib/reader/wordRegistry';

const NAMES = new Map(getSurahList().map(s => [s.id, s.nameSimple]));

const INITIAL: PlayerState = {
  surahId: null, surahName: null, ayah: 1, ayahIndex: 0, totalAyahs: 0,
  isPlaying: false, isLoading: false, currentMs: 0, totalMs: 0,
  volume: 1, error: null,
};

/**
 * Owns playback for the whole app.
 *
 * Mounted in the root layout, which the App Router keeps alive across
 * client-side navigation — that is what lets recitation continue while the
 * user browses. The word registry stays owned by the surah page, because the
 * DOM nodes belong to it; the page attaches its registry here and the provider
 * writes to it only while that page's surah is the one playing.
 */
export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PlayerState>(INITIAL);

  const playlistRef = useRef<AyahPlaylist | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const timingsRef = useRef<SurahTimings | null>(null);
  const attachedRef = useRef<{ surahId: number; registry: WordRegistry } | null>(null);
  const playingSurahRef = useRef<number | null>(null);

  const patch = useCallback((next: Partial<PlayerState>) => {
    setState(prev => ({ ...prev, ...next }));
  }, []);

  /** Paint the highlight only when the mounted page is the playing surah. */
  const paint = useCallback((wordId: string | null) => {
    const attached = attachedRef.current;
    if (!attached || attached.surahId !== playingSurahRef.current) return;
    const words = timingsRef.current?.ayahs[playlistRef.current?.currentAyahIndex ?? 0]?.words ?? [];
    const word = words.find(w => w.id === wordId);
    attached.registry.setActive(wordId, word?.estimated ?? false);
  }, []);

  const teardown = useCallback(() => {
    engineRef.current?.detach();
    playlistRef.current?.destroy();
    engineRef.current = null;
    playlistRef.current = null;
    timelineRef.current = null;
  }, []);

  const playSurah = useCallback(async (
    surahId: number,
    opts: { ayah?: number; localMs?: number; autoplay?: boolean } = {},
  ) => {
    const { ayah, localMs = 0, autoplay = true } = opts;

    let timings: SurahTimings;
    try {
      timings = await loadTimings(surahId);
    } catch {
      patch({ error: 'Could not load this surah. Please try again.' });
      return;
    }

    teardown();

    const playlist = new AyahPlaylist(timings.ayahs);
    const engine = new SyncEngine();
    const timeline = new Timeline(timings.ayahs);

    playlistRef.current = playlist;
    engineRef.current = engine;
    timelineRef.current = timeline;
    timingsRef.current = timings;
    playingSurahRef.current = surahId;

    engine.onChange(paint);

    playlist.on('ayahchange', index => {
      engine.setWords(timings.ayahs[index]?.words ?? []);
      const ayahNumber = timings.ayahs[index]?.ayah ?? 1;
      patch({ ayahIndex: index, ayah: ayahNumber, error: null });
      writeLastPosition({ surahId, ayah: ayahNumber, localMs: 0 });
    });
    playlist.on('state', playing => patch({ isPlaying: playing }));
    playlist.on('loading', loading => patch({ isLoading: loading }));
    playlist.on('error', () => patch({
      error: 'Unable to load this recitation.', isLoading: false,
    }));
    playlist.on('ended', () => {
      paint(null);
      patch({ isPlaying: false });
    });
    playlist.on('duration', (index, durationMs) => {
      timeline.setActualDuration(index, durationMs, playlist.currentAyahIndex);
      patch({ totalMs: timeline.totalMs });
    });

    const startIndex = ayah
      ? Math.max(0, timings.ayahs.findIndex(a => a.ayah === ayah))
      : 0;

    engine.attach(() => playlist.localTimeMs(), timings.ayahs[startIndex]?.words ?? []);
    playlist.seekToAyah(startIndex, localMs);

    patch({
      surahId,
      surahName: NAMES.get(surahId) ?? null,
      ayah: timings.ayahs[startIndex]?.ayah ?? 1,
      ayahIndex: startIndex,
      totalAyahs: timings.ayahs.length,
      totalMs: timeline.totalMs,
      error: null,
      // Held true until the audio element actually produces sound, so the UI
      // never claims to be playing while the file is still downloading.
      isLoading: autoplay,
    });

    writeLastPosition({ surahId, ayah: timings.ayahs[startIndex]?.ayah ?? 1, localMs });

    if (autoplay) playlist.play();
  }, [patch, paint, teardown]);

  const toggle = useCallback(() => {
    const playlist = playlistRef.current;
    if (!playlist) {
      const saved = readLastPosition();
      if (saved) void playSurah(saved.surahId, { ayah: saved.ayah, localMs: saved.localMs });
      return;
    }
    if (playlist.isPlaying) playlist.pause();
    else { patch({ isLoading: true }); playlist.play(); }
  }, [patch, playSurah]);

  const playWord = useCallback((wordId: string) => {
    const playlist = playlistRef.current;
    const timings = timingsRef.current;
    if (!playlist || !timings) return;
    const [, ayahStr] = wordId.split(':');
    const index = timings.ayahs.findIndex(a => a.ayah === Number(ayahStr));
    if (index === -1) return;
    const word = timings.ayahs[index].words.find(w => w.id === wordId);
    engineRef.current?.setWords(timings.ayahs[index].words);
    playlist.seekToAyah(index, word?.startMs ?? 0);
    patch({ isLoading: true });
    playlist.play();
  }, [patch]);

  const attachRegistry = useCallback((surahId: number, registry: WordRegistry) => {
    attachedRef.current = { surahId, registry };
    // Reattaching mid-playback should highlight the current word immediately
    // rather than waiting for the next word boundary.
    if (surahId === playingSurahRef.current) {
      engineRef.current?.onChange(paint);
    }
    return () => {
      if (attachedRef.current?.registry === registry) attachedRef.current = null;
    };
  }, [paint]);

  const seek = useCallback((globalMs: number) => {
    const playlist = playlistRef.current;
    const timeline = timelineRef.current;
    const timings = timingsRef.current;
    if (!playlist || !timeline || !timings) return;
    const { ayahIndex, localMs } = timeline.globalToLocal(globalMs);
    engineRef.current?.setWords(timings.ayahs[ayahIndex]?.words ?? []);
    playlist.seekToAyah(ayahIndex, localMs);
    patch({ currentMs: globalMs, ayahIndex, ayah: timings.ayahs[ayahIndex]?.ayah ?? 1 });
  }, [patch]);

  const setVolume = useCallback((volume: number) => {
    playlistRef.current?.setVolume(volume);
    patch({ volume });
  }, [patch]);

  // Restore the saved position so the bar can offer it, without playing.
  useEffect(() => {
    const saved = readLastPosition();
    if (saved) {
      setState(prev => ({
        ...prev,
        surahId: saved.surahId,
        surahName: NAMES.get(saved.surahId) ?? null,
        ayah: saved.ayah,
      }));
    }
  }, []);

  // Progress ticks at a human rate; the highlight runs at frame rate.
  useEffect(() => {
    const id = window.setInterval(() => {
      const playlist = playlistRef.current;
      const timeline = timelineRef.current;
      if (!playlist || !timeline) return;
      patch({ currentMs: timeline.localToGlobal(playlist.currentAyahIndex, playlist.localTimeMs()) });
    }, 250);
    return () => window.clearInterval(id);
  }, [patch]);

  useEffect(() => teardown, [teardown]);

  const value = useMemo(() => ({
    ...state,
    playSurah, playWord, toggle, seek, setVolume,
    next: () => playlistRef.current?.next(),
    prev: () => playlistRef.current?.prev(),
    primeTimings: primeTimingsCache,
    attachRegistry,
  }), [state, playSurah, playWord, toggle, seek, setVolume, attachRegistry]);

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
