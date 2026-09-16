import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
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

export interface PlayerState {
  surahId: number | null;
  surahName: string | null;
  ayah: number;
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  /**
   * Which surah `isLoading`/`error` are currently *about*. `surahId` names
   * the surah that is actually live (loaded, playing or paused) — it does
   * not move until a load finishes — so while a load is in flight for a
   * surah other than the live one, `surahId` still (correctly) names the
   * old, still-playing surah and `pendingSurahId` names the new one.
   *
   * Without this, an `isLoading`/`error` set for a surah that isn't live
   * yet has nowhere correct to attach: attaching it to `surahId` would
   * either misrepresent the surah that's actually still playing (an error
   * loading B rendered as if it were an error on A, which is still fine),
   * or — once a screen keys off `surahId === screen's surahId` — surface on
   * the wrong screen entirely. Consumers should treat `isLoading`/`error`
   * as being about `pendingSurahId` whenever it is set, and about `surahId`
   * otherwise (e.g. a mid-playback failure on the surah that's already
   * live, which has nothing "pending").
   */
  pendingSurahId: number | null;
}

export interface PlayerActions {
  play(surahId: number, ayah?: number): Promise<void>;
  toggle(): void;
  next(): Promise<void>;
  prev(): Promise<void>;
  /**
   * Registers `surahId` as the surah currently on screen and returns an
   * unsubscribe to call on unmount (or before re-registering a new id).
   *
   * The web attaches a whole per-page `WordRegistry` object here because its
   * DOM nodes belong to the page. Mobile has no DOM — `activeWordStore` is
   * one global store shared by every mounted word — so the only thing a
   * screen needs to hand over is *which* surah it is showing; the provider
   * uses that to decide whether it may paint into that shared store at all.
   */
  attachViewer(surahId: number): () => void;
}

export type PlayerContextValue = PlayerState & PlayerActions;

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayer(): PlayerContextValue {
  const value = useContext(PlayerContext);
  if (!value) throw new Error('usePlayer must be used inside <PlayerProvider>');
  return value;
}

const INITIAL: PlayerState = {
  surahId: null, surahName: null, ayah: 1, isPlaying: false, isLoading: false, error: null,
  pendingSurahId: null,
};

/**
 * Owns playback for the whole app.
 *
 * Mounted once in `App.tsx`, above the screen switch, so navigating between
 * the surah list and the reader never unmounts it — that is what lets
 * recitation continue while the user browses. This replaces `usePlayback`,
 * which lived inside `ReaderScreen` and was torn down (sequencer, sync
 * engine, and all) every time the reader unmounted.
 */
export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PlayerState>(INITIAL);

  const sequencerRef = useRef<AyahSequencer | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const timingsRef = useRef<SurahTimings | null>(null);
  /** The surah id the live sequencer is actually playing, or `null`. */
  const playingSurahRef = useRef<number | null>(null);
  /** The surah id the currently mounted reader screen is showing, or `null`. */
  const viewedSurahRef = useRef<number | null>(null);
  /**
   * Monotonically increasing token identifying the most recent `play` call.
   * `loadTimings` for an uncached surah can take arbitrarily long, and
   * nothing otherwise stops a slow call from resolving after a later call
   * has already become the live playback — it would tear that down and
   * replace it with the stale surah. Every call captures its own token and
   * checks it is still current before mutating anything.
   */
  const requestRef = useRef(0);

  const patch = useCallback((next: Partial<PlayerState>) => {
    setState(prev => ({ ...prev, ...next }));
  }, []);

  /**
   * Paint the highlight only while the mounted screen is showing the surah
   * that is actually playing — otherwise opening a different surah while
   * one plays would highlight text on the wrong page.
   */
  const paint = useCallback((wordId: string | null) => {
    if (viewedSurahRef.current !== playingSurahRef.current) return;
    activeWordStore.set(wordId);
  }, []);

  const teardown = useCallback(() => {
    engineRef.current?.detach();
    sequencerRef.current?.release();
    engineRef.current = null;
    sequencerRef.current = null;
    timingsRef.current = null;
    playingSurahRef.current = null;
    activeWordStore.set(null);
  }, []);

  const play = useCallback(async (surahId: number, ayah?: number) => {
    const token = ++requestRef.current;

    // Fast path: this surah is already the live one — seek/play in place
    // rather than tearing down a working sequencer and rebuilding it.
    if (playingSurahRef.current === surahId && sequencerRef.current && timingsRef.current) {
      const sequencer = sequencerRef.current;
      const timings = timingsRef.current;
      patch({ error: null, pendingSurahId: null });
      if (ayah !== undefined) {
        const index = timings.ayahs.findIndex(a => a.ayah === ayah);
        if (index !== -1) await sequencer.seekToAyah(index);
      }
      if (token !== requestRef.current) return;
      await sequencer.play();
      return;
    }

    // Give instant feedback either way, but attribute it correctly.
    //
    // Nothing else is playing yet: there is no "live" surah whose state this
    // would misrepresent, so this surah becomes the live one immediately
    // (optimistically) and `pendingSurahId` mirrors `surahId`.
    //
    // A *different* surah is genuinely still playing: its `surahId`/
    // `surahName`/`ayah`/`isPlaying` are left alone here on purpose — they
    // stay accurate (and audible) for the whole `loadTimings` round trip,
    // and only flip over to the new surah in the single, atomic patch below
    // once that surah is actually ready. But `isLoading`/`error` are still
    // patched (unconditionally), attributed to the new surah via
    // `pendingSurahId` rather than to `surahId` — so the *new* surah's own
    // screen can show a loading state via `pendingSurahId`, while the bar
    // and the *old* surah's screen (which key their own loading/error
    // display off `pendingSurahId === <their surah>`) correctly see this
    // isLoading as not about them and keep showing the old surah as live.
    if (playingSurahRef.current === null) {
      patch({
        surahId,
        surahName: getSurahMeta(surahId)?.nameSimple ?? null,
        ayah: ayah ?? 1,
        isPlaying: false,
        isLoading: true,
        error: null,
        pendingSurahId: surahId,
      });
    } else {
      patch({ isLoading: true, error: null, pendingSurahId: surahId });
    }

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
    if (token !== requestRef.current) return;

    let timings: SurahTimings;
    try {
      timings = await loadTimings(surahId);
    } catch {
      // A newer call has already superseded this one — its failure belongs
      // to a surah the user has already moved past, so it must not surface
      // as an error for whatever is live now.
      if (token !== requestRef.current) return;
      // Attributed to `surahId` (the surah that failed to load) via
      // `pendingSurahId`, not folded into `surahId`/`surahName` — those
      // still correctly name whatever surah is actually live (or stay
      // `null` if nothing was), so this error can never render on a screen
      // showing a *different*, perfectly-fine-and-still-playing surah.
      patch({
        error: 'Could not load this surah. Please try again.',
        isLoading: false,
        pendingSurahId: surahId,
      });
      return;
    }
    // Bail before any state mutation or teardown: a faster later call may
    // already be the live playback, and this stale one must not touch it.
    if (token !== requestRef.current) return;

    teardown();

    const meta = getSurahMeta(surahId);
    const engine = new SyncEngine();
    const sequencer = new AyahSequencer(timings.ayahs, createExpoPlayer);

    engineRef.current = engine;
    sequencerRef.current = sequencer;
    timingsRef.current = timings;
    playingSurahRef.current = surahId;

    engine.onChange(paint);

    sequencer.on('ayahchange', index => {
      engine.setWords(timings.ayahs[index]?.words ?? []);
      patch({ ayah: timings.ayahs[index]?.ayah ?? 1, error: null });

      // Re-activate lock-screen controls on whichever native player is now
      // actually driving playback, but only while the app is in the
      // foreground — re-issuing this for a *different* native player asks
      // Android to promote the playback service to the foreground again,
      // which Android refuses once truly backgrounded
      // ("Service.startForeground() not allowed"), freezing playback. See
      // nowPlaying.ts.
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
    sequencer.on('error', message => patch({
      error: message, isPlaying: false, isLoading: false, pendingSurahId: surahId,
    }));
    sequencer.on('ended', () => {
      paint(null);
      patch({ isPlaying: false });
    });

    const startIndex = ayah
      ? Math.max(0, timings.ayahs.findIndex(a => a.ayah === ayah))
      : 0;

    engine.attach(() => sequencer.localTimeMs, timings.ayahs[startIndex]?.words ?? []);

    try {
      await sequencer.seekToAyah(startIndex);
    } catch {
      if (token !== requestRef.current) return;
      // Unlike the loadTimings failure above, `teardown()` has already run
      // and `playingSurahRef` already points at `surahId` by this point —
      // whatever was playing before is gone, not merely superseded. So this
      // must still surface `surahId`/`surahName`, or the bar would keep
      // showing the old (now-destroyed) surah as if it were still live.
      patch({
        surahId,
        surahName: meta?.nameSimple ?? null,
        isPlaying: false,
        error: 'Could not load this recitation. Please try again.',
        isLoading: false,
        pendingSurahId: surahId,
      });
      return;
    }
    if (token !== requestRef.current) return;

    // The one atomic switch-over: everything above ran off local variables
    // and refs, not state, so this is the only point where the *visible*
    // surah actually changes — the old one (if any) was audibly playing
    // right up until this patch lands. Nothing is pending any more: either
    // this succeeded (and is now simply the live surah) or a later call
    // already claimed `pendingSurahId` for itself.
    patch({
      surahId,
      surahName: meta?.nameSimple ?? null,
      ayah: timings.ayahs[startIndex]?.ayah ?? 1,
      isLoading: false,
      error: null,
      pendingSurahId: null,
    });

    await sequencer.play();
  }, [patch, paint, teardown]);

  // Mirrors `state.isPlaying` so `toggle` can read it without depending on
  // `state` (and picking up a fresh identity on every state tick). Plain
  // assignment on every render — no subscription, no cleanup — so this
  // cannot repeat the every-tick-effect trap the rest of this file is
  // written to avoid; it just keeps a ref in sync with the render it read.
  const isPlayingRef = useRef(false);
  isPlayingRef.current = state.isPlaying;

  const toggle = useCallback(() => {
    const sequencer = sequencerRef.current;
    if (!sequencer) return;
    if (isPlayingRef.current) sequencer.pause();
    else void sequencer.play();
  }, []);

  const next = useCallback(() => sequencerRef.current?.next() ?? Promise.resolve(), []);
  const prev = useCallback(() => sequencerRef.current?.prev() ?? Promise.resolve(), []);

  const attachViewer = useCallback((surahId: number) => {
    viewedSurahRef.current = surahId;
    // Not the surah that's playing: make sure nothing stale is left
    // highlighted on this screen from whatever was last painted.
    if (surahId !== playingSurahRef.current) activeWordStore.set(null);
    return () => {
      if (viewedSurahRef.current === surahId) viewedSurahRef.current = null;
    };
  }, []);

  // Unmount only (this provider is mounted once, for the app's lifetime) —
  // `teardown()` itself stays purely ref-based on purpose: it is also called
  // from inside `play()`'s own rebuild, mid-flight, where a newly-set
  // `pendingSurahId` for the surah being built must survive untouched until
  // the atomic switch-over patch resolves it. Clearing `pendingSurahId` here
  // instead, in the one-time unmount cleanup, satisfies the same "nothing is
  // left pending forever" property without that risk — even though nothing
  // is left to observe it once the provider is gone.
  useEffect(() => () => {
    teardown();
    setState(prev => ({ ...prev, pendingSurahId: null }));
  }, [teardown]);

  // The context value is rebuilt on every state tick (every ayah change,
  // every isPlaying/isLoading flip). Consumers must destructure the actions
  // they need in effects/memos and depend on those specific, stable
  // references rather than on this whole object — otherwise an effect
  // re-runs on that same cadence. (This is exactly what once silently broke
  // word highlighting on the web: a cleanup depending on the whole player
  // object ran constantly and cleared the registry before anything could
  // paint into it.)
  const value = useMemo(() => ({
    ...state, play, toggle, next, prev, attachViewer,
  }), [state, play, toggle, next, prev, attachViewer]);

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
