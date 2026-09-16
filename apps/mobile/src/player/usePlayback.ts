import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  SyncEngine, loadTimings, configureTimings, configureAudioBase,
} from '@quran/core';
import type { SurahTimings } from '@quran/core';
import { setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';
import { AyahSequencer } from '../audio/AyahSequencer';
import { createExpoPlayer } from '../audio/expoPlayer';
import { setNowPlaying } from '../audio/nowPlaying';
import { activeWordStore } from '../reader/activeWordStore';
import { getSurahMeta } from '../data/surahs';

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
    const unsubscribeEngine = engine.onChange(wordId => activeWordStore.set(wordId));

    // Static per surah (title never changes mid-playback, unlike `ayah` in
    // `state` above) — read once per surah rather than inside the
    // `ayahchange` handler below.
    const meta = getSurahMeta(surahId);

    (async () => {
      // `shouldPlayInBackground` keeps the audio session alive once the app
      // backgrounds; `interruptionMode: 'doNotMix'` is required for
      // `setNowPlaying`'s lock-screen activation below to actually bind to
      // this player (see nowPlaying.ts). App.tsx's own `setAudioModeAsync`
      // call — fired once at startup, purely so the native
      // `enableBackgroundPlayback` manifest bits have any effect at all —
      // doesn't set `interruptionMode`, so it's re-applied here, awaited,
      // before this surah's first play is possible.
      await setAudioModeAsync({
        shouldPlayInBackground: true,
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
      });
      if (cancelled) return;

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

        // Re-activate lock-screen controls on whichever native player is
        // now actually driving playback, but only while the app is in the
        // foreground. `AyahSequencer` alternates between two player
        // instances for gapless transitions, and expo-audio's lock-screen
        // session tracks exactly one "active" player at a time, so in
        // principle this needs to run on every boundary to keep controls
        // pointed at whatever is really playing.
        //
        // But re-issuing `setActiveForLockScreen` for a *different* native
        // player asks Android to promote the playback service to the
        // foreground again — and verified on device, Android refuses that
        // a second time once the app is actually backgrounded ("Service
        // .startForeground() not allowed"), which froze playback entirely:
        // precisely the failure this feature exists to prevent. So this is
        // skipped while backgrounded; the controls keep pointing at
        // whichever player was active at the moment of backgrounding
        // rather than crashing background survival to stay perfectly in
        // sync. Metadata is constant per surah, so nothing is lost by
        // skipping the metadata refresh those skipped calls would also
        // have done.
        if (AppState.currentState === 'active') {
          const native = sequencer.activePlayer?.nativePlayer as AudioPlayer | undefined;
          if (native && meta) {
            setNowPlaying(native, {
              title: meta.nameSimple,
              artist: 'AbdulBaset AbdulSamad',
              albumTitle: 'Murattal',
            });
          }
        }
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
      unsubscribeEngine();
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
