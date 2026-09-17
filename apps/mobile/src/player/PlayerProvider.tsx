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
   * the wrong screen entirely. Every patch that sets `isLoading` or `error`
   * also sets `pendingSurahId`, so consumers read both strictly through it:
   * `pendingSurahId === mySurah && isLoading`. When it is null there is
   * nothing transient to show, whatever `isLoading` happens to hold.
   */
  pendingSurahId: number | null;
}

export interface PlayerActions {
  /** Start (or jump within) a surah; `wordId` recites from that word, as clicking a word does on the web. */
  play(surahId: number, ayah?: number, wordId?: string): Promise<void>;
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

// The bar is visible from first launch, offering Al-Fatihah 1:1 with a Play
// button — asked for from the device: nothing has played yet, but the user
// should be able to press play and have recitation start, not hunt for a
// surah first. `surahId` here is the *offered* surah; `playingSurahRef`
// (still null) is what says whether anything is actually live.
const INITIAL: PlayerState = {
  surahId: 1,
  surahName: getSurahMeta(1)?.nameSimple ?? 'Al-Fatihah',
  ayah: 1,
  isPlaying: false,
  isLoading: false,
  error: null,
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
  /** Index into the live surah's `ayahs` that the sequencer is on. */
  const ayahIndexRef = useRef(0);

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

  const play = useCallback(async (surahId: number, ayah?: number, wordId?: string) => {
    const token = ++requestRef.current;

    // Word taps recite from that word, as clicking a word does on the web.
    // Word times are ayah-local, which is exactly what `seekToAyah` takes.
    const localMsFor = (timings: SurahTimings, index: number): number => {
      if (!wordId) return 0;
      return timings.ayahs[index]?.words.find(w => w.id === wordId)?.startMs ?? 0;
    };

    // Fast path: this surah is already the live one — seek/play in place
    // rather than tearing down a working sequencer and rebuilding it.
    if (playingSurahRef.current === surahId && sequencerRef.current && timingsRef.current) {
      const sequencer = sequencerRef.current;
      const timings = timingsRef.current;
      // Clears any transient state left by a superseded load of some other
      // surah — including `isLoading`, or a consumer could be left showing a
      // spinner for a load that stale-bailed and will never resolve it.
      patch({ error: null, isLoading: false, pendingSurahId: null });
      if (ayah !== undefined) {
        const index = timings.ayahs.findIndex(a => a.ayah === ayah);
        if (index !== -1) await sequencer.seekToAyah(index, localMsFor(timings, index));
      }
      if (token !== requestRef.current) return;
      await sequencer.play();
      return;
    }

    // Instant feedback, attributed correctly. Nothing else playing: this
    // surah becomes the visible one immediately and `pendingSurahId` mirrors
    // it. A different surah still playing: its `surahId`/`surahName`/`ayah`/
    // `isPlaying` are left alone — it stays the thing actually making sound
    // until the switch-over below — while `isLoading` is attributed to the
    // new surah through `pendingSurahId`, so the new surah's own screen can
    // show a loading state without the bar misrepresenting the live one.
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
      // Attributed to the surah that failed via `pendingSurahId`; `surahId`/
      // `surahName` still name whatever is actually live (or stay null).
      patch({
        error: 'Could not load this surah. Please try again.',
        isLoading: false,
        pendingSurahId: surahId,
      });
      return;
    }
    if (token !== requestRef.current) return;

    const meta = getSurahMeta(surahId);
    const engine = new SyncEngine();
    const sequencer = new AyahSequencer(timings.ayahs, createExpoPlayer);

    // Nothing from here until the switch-over touches the live playback.
    // The old surah keeps sounding, and stays the surah every ref and every
    // state field describes, until the new one has actually loaded its
    // first ayah. That is what keeps the bar honest (it never shows a surah
    // that is not the one making sound) and keeps `toggle`/`next` during the
    // wait acting on what the user can hear. The handlers below are armed
    // now but gated on `live`, which flips at the switch-over.
    let live = false;

    const registerLockScreen = () => {
      // Re-activate lock-screen controls on whichever native player is now
      // actually driving playback, but only while the app is in the
      // foreground — re-issuing this for a *different* native player asks
      // Android to promote the playback service to the foreground again,
      // which Android refuses once truly backgrounded
      // ("Service.startForeground() not allowed"), freezing playback. See
      // nowPlaying.ts.
      if (AppState.currentState !== 'active') return;
      const native = sequencer.activePlayer?.nativePlayer as AudioPlayer | undefined;
      if (native && meta) {
        setNowPlaying(native, {
          title: meta.nameSimple,
          artist: 'AbdulBaset AbdulSamad',
          albumTitle: 'Murattal',
        });
      }
    };

    engine.onChange(paint);

    sequencer.on('ayahchange', index => {
      // The engine is this sequencer's own; feeding it is safe before `live`
      // (it paints nothing until `playingSurahRef` names this surah).
      engine.setWords(timings.ayahs[index]?.words ?? []);
      if (!live) return;
      ayahIndexRef.current = index;
      patch({ ayah: timings.ayahs[index]?.ayah ?? 1, error: null });
      registerLockScreen();
    });
    sequencer.on('state', playing => {
      // Run the highlight loop only while sound is actually playing. It is
      // a requestAnimationFrame loop waking the JS thread every frame; left
      // attached it would run for the app's lifetime after the first play —
      // through pauses, past the end, and while the user browses the list.
      // Detaching leaves the last painted word in place (nothing emits
      // null), so the highlight stays put while paused; re-attaching emits
      // the current word on its first frame.
      if (playing) engine.attach(() => sequencer.localTimeMs, timings.ayahs[sequencer.currentIndex]?.words ?? []);
      else engine.detach();
      if (live) patch({ isPlaying: playing });
    });
    sequencer.on('error', message => {
      if (live) patch({ error: message, isPlaying: false, isLoading: false, pendingSurahId: surahId });
    });
    sequencer.on('ended', () => {
      engine.detach();
      if (!live) return;
      paint(null);
      patch({ isPlaying: false });
      // Recitation runs on into the next surah rather than stopping at the
      // end of this one — asked for from the device. The web stops here.
      if (surahId < 114) void play(surahId + 1);
    });

    const startIndex = ayah
      ? Math.max(0, timings.ayahs.findIndex(a => a.ayah === ayah))
      : 0;

    // Not attached here: the loop starts with the first `state: true`.

    try {
      await sequencer.seekToAyah(startIndex, localMsFor(timings, startIndex));
    } catch {
      engine.detach();
      sequencer.release();
      if (token !== requestRef.current) return;
      // The old surah was never touched and is still audible; this failure
      // belongs to the surah that was asked for, so it is attributed there.
      patch({
        error: 'Could not load this recitation. Please try again.',
        isLoading: false,
        pendingSurahId: surahId,
      });
      return;
    }
    if (token !== requestRef.current) {
      // A faster later call became the live playback while this loaded.
      engine.detach();
      sequencer.release();
      return;
    }

    // The switch-over: the one point where the visible surah changes, and
    // the first point where the old one stops sounding. Everything above
    // ran off locals, so until here the old surah was audible and its state
    // accurate. Nothing is pending any more: this call succeeded, and any
    // later call has already claimed `pendingSurahId` for itself.
    teardown();
    engineRef.current = engine;
    sequencerRef.current = sequencer;
    timingsRef.current = timings;
    playingSurahRef.current = surahId;
    ayahIndexRef.current = startIndex;
    live = true;
    patch({
      surahId,
      surahName: meta?.nameSimple ?? null,
      ayah: timings.ayahs[startIndex]?.ayah ?? 1,
      isLoading: false,
      error: null,
      pendingSurahId: null,
    });
    // The first ayah's `ayahchange` fired before `live`; register now.
    registerLockScreen();

    await sequencer.play();
  }, [patch, paint, teardown]);

  // Mirrors `state.isPlaying` so `toggle` can read it without depending on
  // `state` (and picking up a fresh identity on every state tick). Plain
  // assignment on every render — no subscription, no cleanup — so this
  // cannot repeat the every-tick-effect trap the rest of this file is
  // written to avoid; it just keeps a ref in sync with the render it read.
  const isPlayingRef = useRef(false);
  isPlayingRef.current = state.isPlaying;
  /** What the bar is showing, for `toggle` to start when nothing is live yet. */
  const offeredRef = useRef<{ surahId: number | null; ayah: number }>({ surahId: 1, ayah: 1 });
  offeredRef.current = { surahId: state.surahId, ayah: state.ayah };

  const toggle = useCallback(() => {
    const sequencer = sequencerRef.current;
    if (!sequencer) {
      // Nothing live yet (first launch, or the previous attempt failed):
      // play starts whatever the bar is offering instead of doing nothing.
      const { surahId, ayah } = offeredRef.current;
      if (surahId !== null) void play(surahId, ayah);
      return;
    }
    if (isPlayingRef.current) sequencer.pause();
    else void sequencer.play();
  }, [play]);

  // On the last ayah, "next" continues into the next surah rather than
  // stopping dead — the user asked for exactly this from the device. The
  // web's bar does not do it (its `next` is a bare `playlist.next()`), so
  // this is a deliberate mobile divergence, not a port. `play` is a stable
  // callback, so `next` stays stable too.
  const next = useCallback(async () => {
    const sequencer = sequencerRef.current;
    const timings = timingsRef.current;
    const surahId = playingSurahRef.current;
    if (!sequencer || !timings || surahId === null) return;
    if (ayahIndexRef.current >= timings.ayahs.length - 1) {
      if (surahId < 114) await play(surahId + 1);
      return;
    }
    await sequencer.next();
  }, [play]);
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
