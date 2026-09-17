import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { AppState } from 'react-native';
import {
  SyncEngine, loadTimings, configureTimings, configureAudioBase,
} from '@quran/core';
import type { AyahTiming, SurahTimings } from '@quran/core';
import { setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer, AudioMetadata } from 'expo-audio';
import { AyahSequencer } from '../audio/AyahSequencer';
import { createExpoPlayer } from '../audio/expoPlayer';
import { setNowPlaying, isNowPlaying } from '../audio/nowPlaying';
import { cacheAyah, localPathFor } from '../audio/ayahCache';
import { offlinePathFor, offlineTimingsStore } from '../offline/offlineStore';
import { readLastPosition, writeLastPosition } from './lastPosition';
import { activeWordStore } from '../reader/activeWordStore';
import { getSurahMeta } from '../data/surahs';

// Constants, not environment reads — @quran/core is platform-free and has no
// opinion on how a host discovers these, and the mobile app has exactly one
// deployment target, so there is nothing to make configurable. Mirrors the
// web's `configureAudioBase(process.env.NEXT_PUBLIC_AUDIO_BASE_URL)` in
// PlayerProvider.tsx, minus the env indirection this app doesn't need.
//
// `store: offlineTimingsStore` is what makes a downloaded surah's timings
// come from its own folder rather than the network (spec §9): `loadTimings`
// consults the configured store before ever touching `baseUrl`, and
// `offlineTimingsStore` reads a surah's `offline/<id>/timings.json` first, so
// a downloaded surah's recitation — and its word-by-word highlight — comes
// up with the network off.
configureTimings({ baseUrl: 'https://quran-recite-eta.vercel.app', store: offlineTimingsStore });
configureAudioBase('https://github.com/umairnawaz333/quran-recite/releases/download');

/**
 * Offline folder first, then the warm cache, else stream. Handed to the
 * sequencer as its `localPathFor` seam so a downloaded surah's audio, like
 * its timings above, comes from disk rather than the network.
 */
function localAudioFor(ayah: AyahTiming): string | null {
  return offlinePathFor(ayah) ?? localPathFor(ayah);
}

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

/** What the lock screen and the notification show for a surah. */
function lockScreenMeta(meta: { nameSimple: string }): AudioMetadata {
  return {
    title: meta.nameSimple,
    artist: 'AbdulBaset AbdulSamad',
    albumTitle: 'Murattal',
  };
}

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
  /** Removes the live surah's sequencer handlers; replaced at each switch-over. */
  const detachHandlersRef = useRef<(() => void) | null>(null);
  /**
   * Which `play()` call's handlers may act on sequencer events. Bumped the
   * moment a call starts mutating the shared sequencer (`switchTo`), not at
   * its commit: from that moment the sequencer's indices belong to the new
   * surah, and the previous surah's still-registered handlers must not read
   * them as their own — or a superseded switch would paint the bar with the
   * old surah's ayah numbers and word timings over another surah's audio.
   */
  const handlerEpochRef = useRef(0);
  /** The native player currently handed to Android as the lock-screen controller. */
  const lockScreenPlayerRef = useRef<AudioPlayer | null>(null);
  /**
   * The live playback's own "bind Android's media session to whatever is
   * audible now" closure, republished by every `play()` that becomes live.
   *
   * A ref, not state: the `AppState` subscription below has to reach the
   * *current* one without re-subscribing whenever playback changes — this
   * provider's whole effect discipline is to never depend on values that
   * tick per ayah (see the note on the context value at the bottom).
   */
  const registerRef = useRef<(() => void) | null>(null);

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
    detachHandlersRef.current?.();
    detachHandlersRef.current = null;
    lockScreenPlayerRef.current = null;
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

    // ONE sequencer, one engine, ONE native player — for the app's whole
    // life. A surah switch moves the existing sequencer onto the new surah
    // (`switchTo`) rather than building a new one. This is what keeps the
    // lock-screen binding alive across a surah boundary in the background:
    // Android binds its media session to a single native player and refuses
    // to re-bind while backgrounded, so a fresh player for each surah left
    // the foreground service to die (and with it the ~3-minute background
    // protection) at the first boundary crossed hands-free. With the same
    // player the bound one is simply still there — and, there being only
    // one, it is always the one making sound (see AyahSequencer's doc).
    const reuse = sequencerRef.current !== null && engineRef.current !== null;
    const engine = engineRef.current ?? new SyncEngine();
    // The next ayah is prefetched to disk while the current one plays
    // (`cacheAyah`), and every load goes through `localAudioFor` (offline
    // folder, then warm cache), so the single player's boundary reload —
    // and "previous", and replays — come from a local file rather than the
    // network, offline surahs included.
    const sequencer = sequencerRef.current
      ?? new AyahSequencer(timings.ayahs, createExpoPlayer, localAudioFor, cacheAyah);

    // Nothing from here until the switch-over touches the visible state.
    // The old surah stays the surah every ref and every state field
    // describes until the new one has actually loaded its first ayah — the
    // bar never names a surah that has not loaded. (With one player the old
    // surah's sound stops when that load begins; the new one follows within
    // the load.) The handlers below are armed now but gated on `live`,
    // which flips at the switch-over; the previous surah's handlers are
    // removed at that same moment (and this surah's, instead, if its load
    // fails).
    let live = false;
    const epoch = ++handlerEpochRef.current;
    // Until this call owns the sequencer, the previous surah's handlers do.
    // Ownership passes when `switchTo` begins mutating it (below).
    const mine = () => live && handlerEpochRef.current === epoch;

    /**
     * The native player this playback handed to Android as the lock-screen
     * controller. Kept so `registerLockScreen` can tell "the binding is
     * already on one of *my* players" from "it belongs to a surah that is
     * no longer playing" — see the comment in `registerLockScreen`.
     */
    let lockScreenPlayer: AudioPlayer | null = lockScreenPlayerRef.current;

    const registerLockScreen = () => {
      const native = sequencer.activePlayer?.nativePlayer as AudioPlayer | undefined;
      if (!native || !meta) return;

      // Bound once, for the life of the one native player. Android binds
      // its media session to a single `AudioPlayer` and refuses to re-bind
      // while the app is backgrounded (see nowPlaying.ts); with one player
      // that never needs to happen — the bound player is always the one
      // making sound, at every ayah and across surahs — so after the first
      // registration only the metadata is refreshed. (The two-player design
      // this replaced could not have both a correct notification card and
      // working background media keys; see AyahSequencer's class doc.)
      if (lockScreenPlayer && isNowPlaying(lockScreenPlayer)) {
        // Still bound to this playback: only the metadata can need a nudge
        // (cheap, and safe while backgrounded).
        setNowPlaying(lockScreenPlayer, lockScreenMeta(meta));
        return;
      }
      lockScreenPlayer = native;
      lockScreenPlayerRef.current = native;
      setNowPlaying(native, lockScreenMeta(meta));
    };

    if (!reuse) engine.onChange(paint);

    const onAyahChange = (index: number) => {
      // The engine is shared; feeding it is safe before `live` (it paints
      // nothing until `playingSurahRef` names this surah), and after the
      // switch-over these are the only handlers left standing.
      if (!mine()) return;
      engine.setWords(timings.ayahs[index]?.words ?? []);
      ayahIndexRef.current = index;
      const timing = timings.ayahs[index];
      patch({ ayah: timing?.ayah ?? 1, error: null });
      registerLockScreen();
      if (timing) {
        // Bookmark for the next launch, and warm the cache with the ayah now
        // reciting so "previous" and replays come from disk.
        writeLastPosition({ surahId, ayah: timing.ayah, localMs: 0 });
        void cacheAyah(timing);
      }
    };
    const onStateChange = (playing: boolean) => {
      if (!mine()) return;
      // Run the highlight loop only while sound is actually playing. It is
      // a requestAnimationFrame loop waking the JS thread every frame; left
      // attached it would run for the app's lifetime after the first play —
      // through pauses, past the end, and while the user browses the list.
      // Detaching leaves the last painted word in place (nothing emits
      // null), so the highlight stays put while paused; re-attaching emits
      // the current word on its first frame.
      if (playing) engine.attach(() => sequencer.localTimeMs, timings.ayahs[sequencer.currentIndex]?.words ?? []);
      else engine.detach();
      patch({ isPlaying: playing });
    };
    const onError = (message: string) => {
      if (mine()) patch({ error: message, isPlaying: false, isLoading: false, pendingSurahId: surahId });
    };
    const onEnded = () => {
      if (!mine()) return;
      engine.detach();
      paint(null);
      patch({ isPlaying: false });
      // Recitation runs on into the next surah rather than stopping at the
      // end of this one — asked for from the device. The web stops here.
      if (surahId < 114) void play(surahId + 1);
    };
    // A load the recitation is waiting on — a word tap, prev/next, a
    // boundary whose prefetch did not land. Shown only once it has taken a
    // beat, so the sub-100 ms cache-hit reloads at every boundary do not
    // flash a spinner, but a real wait on the network is visible instead of
    // a Pause icon over silence.
    let loadingTimer: ReturnType<typeof setTimeout> | null = null;
    const onLoading = (loading: boolean) => {
      if (!mine()) return;
      if (loading) {
        if (loadingTimer) return;
        loadingTimer = setTimeout(() => {
          loadingTimer = null;
          patch({ isLoading: true, pendingSurahId: surahId });
        }, 300);
      } else {
        if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }
        patch({ isLoading: false });
      }
    };
    const detachHandlers = () => {
      if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }
      sequencer.off('loading', onLoading);
      sequencer.off('ayahchange', onAyahChange);
      sequencer.off('state', onStateChange);
      sequencer.off('error', onError);
      sequencer.off('ended', onEnded);
    };
    sequencer.on('loading', onLoading);
    sequencer.on('ayahchange', onAyahChange);
    sequencer.on('state', onStateChange);
    sequencer.on('error', onError);
    sequencer.on('ended', onEnded);

    const startIndex = ayah
      ? Math.max(0, timings.ayahs.findIndex(a => a.ayah === ayah))
      : 0;

    // Not attached here: the loop starts with the first `state: true`.

    // From here the shared sequencer speaks for the NEW surah: its
    // `ayahchange` indices are into `timings.ayahs`. Take ownership of its
    // events now, so the previous surah's handlers cannot misread them.
    const previousOwner = handlerEpochRef.current;
    handlerEpochRef.current = epoch;
    try {
      if (reuse) await sequencer.switchTo(timings.ayahs, startIndex, localMsFor(timings, startIndex));
      else await sequencer.seekToAyah(startIndex, localMsFor(timings, startIndex));
    } catch {
      detachHandlers();
      if (!reuse) { engine.detach(); sequencer.release(); }
      // The sequencer rolled itself back to the previous surah (unless a
      // newer call has since taken it), so its events belong to the
      // previous owner again.
      if (handlerEpochRef.current === epoch) handlerEpochRef.current = previousOwner;
      if (token !== requestRef.current) return;
      // This failure belongs to the surah that was asked for, so it is
      // attributed there. The old surah keeps its name in the bar but is no
      // longer sounding — one player, and the load replaced its source — so
      // its `isPlaying` is corrected too; pressing play re-seeks it.
      engine.detach();
      patch({
        error: 'Could not load this recitation. Please try again.',
        isLoading: false,
        isPlaying: false,
        pendingSurahId: surahId,
      });
      return;
    }
    if (token !== requestRef.current) {
      // A faster later call became the live playback while this loaded.
      detachHandlers();
      if (!reuse) { engine.detach(); sequencer.release(); }
      return;
    }

    // The switch-over: the one point where the visible surah changes.
    // Everything above ran off locals, so until here the old surah's state
    // was intact. The previous surah's handlers go now; nothing is pending
    // any more: this call succeeded, and any later call has already claimed
    // `pendingSurahId`.
    registerLockScreen();
    registerRef.current = registerLockScreen;
    detachHandlersRef.current?.();
    detachHandlersRef.current = detachHandlers;

    engineRef.current = engine;
    sequencerRef.current = sequencer;
    timingsRef.current = timings;
    playingSurahRef.current = surahId;
    ayahIndexRef.current = startIndex;
    live = true;
    // `switchTo` may have resumed the new surah on its own (the old one was
    // playing); the engine follows the live state either way.
    if (sequencer.activePlayer?.playing) {
      engine.attach(() => sequencer.localTimeMs, timings.ayahs[startIndex]?.words ?? []);
    }
    patch({
      surahId,
      surahName: meta?.nameSimple ?? null,
      ayah: timings.ayahs[startIndex]?.ayah ?? 1,
      isLoading: false,
      error: null,
      pendingSurahId: null,
    });
    // The first ayah's `ayahchange` fired before `live`, so do here what
    // that handler does for every later ayah: bookmark it and warm the
    // cache. Without this, a surah paused or closed inside its first ayah
    // left no bookmark and the next launch offered the previous one.
    const first = timings.ayahs[startIndex];
    if (first) {
      writeLastPosition({ surahId, ayah: first.ayah, localMs: 0 });
      void cacheAyah(first);
    }

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

  // Re-bind Android's media session to the audible player whenever the app
  // comes back to the foreground. Boundary crossings keep the binding
  // current on their own, but nothing else re-checks it, so without this a
  // binding left stale by anything at all — a boundary the app slept
  // through, a registration the OS declined while backgrounded — would
  // persist until the *next* boundary, leaving the notification's buttons
  // pointed at a player that is not the one making sound.
  //
  // Mounted once, with no dependencies: it reaches the live playback only
  // through `registerRef`, never through state, so it is not re-subscribed
  // on every ayah (see the note on the context value at the bottom).
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active') registerRef.current?.();
    });
    return () => sub.remove();
  }, []);

  // Offer "continue where you left off" instead of Al-Fatihah 1:1 — but
  // only if nothing has started by the time the bookmark is read; a user
  // who tapped play before the file loaded must not have the bar yanked
  // back to yesterday's position.
  useEffect(() => {
    void readLastPosition().then(pos => {
      if (!pos || requestRef.current !== 0) return;
      patch({ surahId: pos.surahId, surahName: getSurahMeta(pos.surahId)?.nameSimple ?? null, ayah: pos.ayah });
    });
  }, [patch]);

  // Unmount only (this provider is mounted once, for the app's lifetime).
  // `teardown()` is the sole release of the sequencer, engine and player —
  // surah switches reuse them — so this is also where a stray
  // `pendingSurahId` is cleared, even though nothing is left to observe it.
  useEffect(() => () => {
    registerRef.current = null;
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
