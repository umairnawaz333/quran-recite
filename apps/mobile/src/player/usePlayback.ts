import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SyncEngine, loadTimings, configureTimings, configureAudioBase,
} from '@quran/core';
import type { SurahTimings } from '@quran/core';
import { AyahSequencer } from '../audio/AyahSequencer';
import { createExpoPlayer } from '../audio/expoPlayer';
import { activeWordStore } from '../reader/activeWordStore';

// Constants, not environment reads — @quran/core is platform-free and has no
// opinion on how a host discovers these, and the mobile app has exactly one
// deployment target, so there is nothing to make configurable. Mirrors the
// web's `configureAudioBase(process.env.NEXT_PUBLIC_AUDIO_BASE_URL)` in
// PlayerProvider.tsx, minus the env indirection this app doesn't need.
configureTimings({ baseUrl: 'https://quran-recite-eta.vercel.app' });
configureAudioBase('https://github.com/umairnawaz333/quran-recite/releases/download');

interface PlaybackState {
  isPlaying: boolean;
  isLoading: boolean;
  ayah: number;
  error: string | null;
}

const INITIAL: PlaybackState = { isPlaying: false, isLoading: true, ayah: 1, error: null };

/**
 * Owns playback for one surah's reader screen: fetches timings, wires an
 * `AyahSequencer` (over `expo-audio` via `createExpoPlayer`) to a
 * `SyncEngine`, and forwards the active word to `activeWordStore` for the
 * word components to read.
 *
 * Everything is built on mount rather than lazily on first play, so the
 * first ayah is already loaded and ready by the time the user reaches for
 * the play button — `isLoading` covers exactly that setup window.
 */
export function usePlayback(surahId: number) {
  const [state, setState] = useState<PlaybackState>(INITIAL);
  const sequencerRef = useRef<AyahSequencer | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const timingsRef = useRef<SurahTimings | null>(null);

  const patch = useCallback((next: Partial<PlaybackState>) => {
    setState(prev => ({ ...prev, ...next }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState(INITIAL);

    const engine = new SyncEngine();
    engineRef.current = engine;
    engine.onChange(wordId => activeWordStore.set(wordId));

    (async () => {
      let timings: SurahTimings;
      try {
        timings = await loadTimings(surahId);
      } catch {
        if (cancelled) return;
        patch({ error: 'Could not load this surah. Please try again.', isLoading: false });
        return;
      }
      if (cancelled) return;

      timingsRef.current = timings;

      const sequencer = new AyahSequencer(timings.ayahs, createExpoPlayer);
      sequencerRef.current = sequencer;

      sequencer.on('ayahchange', index => {
        engine.setWords(timings.ayahs[index]?.words ?? []);
        patch({ ayah: timings.ayahs[index]?.ayah ?? 1, error: null });
      });
      sequencer.on('state', playing => patch({ isPlaying: playing }));
      sequencer.on('error', message => patch({ error: message, isPlaying: false, isLoading: false }));
      sequencer.on('ended', () => {
        activeWordStore.set(null);
        patch({ isPlaying: false });
      });

      engine.attach(() => sequencer.localTimeMs, timings.ayahs[sequencer.currentIndex]?.words ?? []);

      try {
        // Loads (but does not play) the first ayah, so pressing play is
        // instant rather than waiting on a fetch at that point.
        await sequencer.seekToAyah(0);
      } catch {
        if (cancelled) return;
        patch({ error: 'Could not load this recitation. Please try again.', isLoading: false });
        return;
      }
      if (cancelled) return;

      patch({ isLoading: false, ayah: timings.ayahs[0]?.ayah ?? 1 });
    })();

    return () => {
      cancelled = true;
      engine.detach();
      sequencerRef.current?.release();
      sequencerRef.current = null;
      engineRef.current = null;
      timingsRef.current = null;
      activeWordStore.set(null);
    };
  }, [surahId, patch]);

  const play = useCallback(async (ayah?: number) => {
    const sequencer = sequencerRef.current;
    const timings = timingsRef.current;
    if (!sequencer || !timings) return;

    patch({ error: null });

    if (ayah !== undefined) {
      const index = timings.ayahs.findIndex(a => a.ayah === ayah);
      if (index === -1) return;
      await sequencer.seekToAyah(index);
    }
    await sequencer.play();
  }, [patch]);

  const toggle = useCallback(() => {
    const sequencer = sequencerRef.current;
    if (!sequencer) return;
    if (state.isPlaying) sequencer.pause();
    else void sequencer.play();
  }, [state.isPlaying]);

  return { ...state, play, toggle };
}
