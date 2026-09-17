'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AyahPlaylist } from '@/lib/audio/playlist';
import {
  SyncEngine, Timeline, loadTimings, primeTimings as primeTimingsCache, configureAudioBase,
} from '@quran/core';
import { readLastPosition, writeLastPosition } from '@/lib/player/lastPosition';
import { getSurahList } from '@/lib/data/surahIndex';
import { PlayerContext, type PlayerState } from './usePlayer';
import type { SurahTimings } from '@quran/core';
import type { WordRegistry } from '@/lib/reader/wordRegistry';

// Supplied here rather than read inside @quran/core: the package is
// platform-free and must not know about Next's build-time env substitution.
configureAudioBase(process.env.NEXT_PUBLIC_AUDIO_BASE_URL);

const NAMES = new Map(getSurahList().map(s => [s.id, s.nameSimple]));

const INITIAL: PlayerState = {
  surahId: null, surahName: null, ayah: 1, ayahIndex: 0, totalAyahs: 0,
  isPlaying: false, isLoading: false, currentMs: 0, totalMs: 0,
  volume: 1, error: null, hasPlaylist: false,
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
  /**
   * Monotonically increasing token identifying the most recent `playSurah`
   * call. `loadTimings` for an uncached surah can take arbitrarily long, and
   * nothing otherwise stops a slow call from resolving after a later call
   * has already become the live playlist — it would tear that down and
   * replace it with the stale surah. Every call captures its own token and
   * checks it is still current before mutating anything.
   */
  const requestRef = useRef(0);

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
    const token = ++requestRef.current;

    let timings: SurahTimings;
    try {
      timings = await loadTimings(surahId);
    } catch {
      // A newer playSurah call has already superseded this one — its
      // failure belongs to a surah the user has already navigated away
      // from, so it must not surface as an error for whatever is live now.
      if (token !== requestRef.current) return;
      patch({ error: 'Could not load this surah. Please try again.' });
      return;
    }

    // Bail before any state mutation or teardown: a faster later call may
    // already be the live playlist, and this stale one must not touch it.
    if (token !== requestRef.current) return;

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
      // Recitation runs on into the next surah rather than stopping at the
      // end of this one — mirrors mobile's PlayerProvider. `playSurah` is
      // referenced here before its own `const` assignment completes, which
      // is fine: this closure only runs later, once `ended` actually fires,
      // by which point the assignment below has long since finished.
      if (surahId < 114) {
        void playSurah(surahId + 1);
        return;
      }
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
      hasPlaylist: true,
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
    // Pausing stops the transport outright, so any in-flight "loading" state
    // must be cleared here too — otherwise pressing play then immediately
    // stop on a slow connection leaves the spinner running forever over
    // silent, paused audio (the `loading` event that would normally clear it
    // has nothing left to fire, since playback was aborted first).
    if (playlist.isPlaying) { playlist.pause(); patch({ isLoading: false }); }
    else { patch({ isLoading: true }); playlist.play(); }
  }, [patch, playSurah]);

  const playWord = useCallback((wordId: string) => {
    // Word ids have the form `surah:ayah:position`.
    const [surahStr, ayahStr] = wordId.split(':');
    const surahId = Number(surahStr);
    const ayah = Number(ayahStr);

    // Gate on whether a live playlist for *this* surah actually exists,
    // rather than on `surahId` (what the caller believes is playing): the
    // resume-restore effect sets `surahId` from storage without ever
    // constructing a playlist, which is exactly the state that made word
    // clicks silently do nothing. Checking the playlist/engine refs here
    // covers that case — and any other path that can leave the playlist
    // unbuilt — for every caller of `playWord`, not just the one that
    // happens to route through here today.
    if (!playlistRef.current || playingSurahRef.current !== surahId) {
      // No playlist yet (or it belongs to a different surah): fall back to
      // starting this surah, then seek to the exact word once its timings
      // have loaded.
      void playSurah(surahId, { ayah }).then(() => {
        const timings = timingsRef.current;
        if (!timings || playingSurahRef.current !== surahId) return;
        const index = timings.ayahs.findIndex(a => a.ayah === ayah);
        if (index === -1) return;
        const word = timings.ayahs[index].words.find(w => w.id === wordId);
        if (!word) return;
        engineRef.current?.setWords(timings.ayahs[index].words);
        playlistRef.current?.seekToAyah(index, word.startMs);
      });
      return;
    }

    const timings = timingsRef.current;
    if (!timings) return;
    const index = timings.ayahs.findIndex(a => a.ayah === ayah);
    if (index === -1) return;
    const word = timings.ayahs[index].words.find(w => w.id === wordId);
    engineRef.current?.setWords(timings.ayahs[index].words);
    playlistRef.current.seekToAyah(index, word?.startMs ?? 0);
    patch({ isLoading: true });
    playlistRef.current.play();
  }, [patch, playSurah]);

  const attachRegistry = useCallback((surahId: number, registry: WordRegistry) => {
    attachedRef.current = { surahId, registry };
    // Reattaching mid-playback should highlight the current word immediately
    // rather than waiting for the next word boundary. `paint` is a stable,
    // dependency-free callback and the engine dedupes listeners in a `Set`,
    // so re-adding it on every attach is harmless today — but the unsubscribe
    // is still captured and released on detach so that stays true even if
    // `paint` ever gains a dependency (and therefore a new identity per
    // render), which would otherwise grow the listener set forever.
    let unsubscribe: (() => void) | null = null;
    if (surahId === playingSurahRef.current) {
      unsubscribe = engineRef.current?.onChange(paint) ?? null;
    }
    return () => {
      unsubscribe?.();
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

  // On the last ayah, "next" continues into the next surah rather than
  // stopping dead, mirroring `ended` above and mobile's own `next`. Falls
  // back to a bare `playlist.next()` — a no-op past the end — when the
  // surah/timings refs are for some reason not in sync with the playlist,
  // which keeps this at least as safe as the previous implementation.
  const next = useCallback(() => {
    const playlist = playlistRef.current;
    if (!playlist) return;
    const timings = timingsRef.current;
    const surahId = playingSurahRef.current;
    if (timings && surahId !== null && playlist.currentAyahIndex >= timings.ayahs.length - 1) {
      if (surahId < 114) void playSurah(surahId + 1);
      return;
    }
    playlist.next();
  }, [playSurah]);

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
  // Skipped entirely while paused, so a loaded-but-idle surah does not
  // rebuild the context value (and re-render every consumer) every 250 ms
  // for no visible change — the whole point of memoising the word tree in
  // Phase 1.
  useEffect(() => {
    const id = window.setInterval(() => {
      const playlist = playlistRef.current;
      const timeline = timelineRef.current;
      if (!playlist || !timeline || !playlist.isPlaying) return;
      patch({ currentMs: timeline.localToGlobal(playlist.currentAyahIndex, playlist.localTimeMs()) });
    }, 250);
    return () => window.clearInterval(id);
  }, [patch]);

  useEffect(() => teardown, [teardown]);

  const value = useMemo(() => ({
    ...state,
    playSurah, playWord, toggle, seek, setVolume, next,
    prev: () => playlistRef.current?.prev(),
    primeTimings: primeTimingsCache,
    attachRegistry,
  }), [state, playSurah, playWord, toggle, seek, setVolume, next, attachRegistry]);

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
