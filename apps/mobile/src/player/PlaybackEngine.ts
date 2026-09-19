import { AppState } from 'react-native';
import {
  SyncEngine, loadTimings, configureTimings, configureAudioBase,
} from '@quran/core';
import type { AyahTiming, SurahTimings } from '@quran/core';
import { setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';
import { AyahSequencer } from '../audio/AyahSequencer';
import { createExpoPlayer } from '../audio/expoPlayer';
import { setNowPlaying, isNowPlaying } from '../audio/nowPlaying';
import { cacheAyah, localPathFor } from '../audio/ayahCache';
import { offlinePathFor, offlineTimingsStore } from '../offline/offlineStore';
import { readLastPosition, writeLastPosition } from './lastPosition';
import { activeWordStore } from '../reader/activeWordStore';
import { getSurahMeta } from '../data/surahs';
import { lockScreenMeta } from './lockScreenMeta';

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

/**
 * The warm cache, but only for ayahs that would otherwise stream.
 *
 * `cacheAyah` knows nothing about the offline folder, so without this gate a
 * downloaded surah re-downloaded every one of its ayahs over the network
 * into the 300-file cache directory — the exact cost "downloaded" exists to
 * remove, paid twice over (bytes, and an eviction of someone else's cached
 * ayah). Used at every site that warms: the sequencer's prefetch seam, each
 * `ayahchange`, and the first ayah of a play.
 */
function warmCache(ayah: AyahTiming): Promise<void> {
  return offlinePathFor(ayah) ? Promise.resolve() : cacheAyah(ayah);
}

export interface EngineState {
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

export interface PlaybackEngine {
  /**
   * The current snapshot. The same object is returned until a field
   * actually changes, which is what lets `useSyncExternalStore` (and any
   * other memoising reader) use it directly.
   */
  getState(): EngineState;
  subscribe(listener: () => void): () => void;
  /** Idempotent. Reads the bookmark into the offer, subscribes to AppState. */
  start(): void;
  /** Start (or jump within) a surah; `wordId` recites from that word, as clicking a word does on the web. */
  play(surahId: number, ayah?: number, wordId?: string): Promise<void>;
  toggle(): void;
  /** Next ayah; continues into the next surah on the last one. */
  next(): Promise<void>;
  /** Previous ayah. */
  prev(): Promise<void>;
  /** Play the next/previous surah from ayah 1; no-op at 114 / 1 when nothing else applies. */
  nextSurah(): Promise<void>;
  prevSurah(): Promise<void>;
  /** Play the bookmark (or the offered position) — what the car's bare "play" means. */
  resume(): Promise<void>;
  /** Seek within the live surah by surah-level position (spec §5.4); ignored when nothing is live. */
  seekToSurahPosition(positionMs: number): Promise<void>;
  /**
   * Registers `surahId` as the surah currently on screen and returns an
   * unsubscribe to call on unmount (or before re-registering a new id).
   *
   * The web attaches a whole per-page `WordRegistry` object here because its
   * DOM nodes belong to the page. Mobile has no DOM — `activeWordStore` is
   * one global store shared by every mounted word — so the only thing a
   * screen needs to hand over is *which* surah it is showing; the engine
   * uses that to decide whether it may paint into that shared store at all.
   */
  attachViewer(surahId: number): () => void;
  /** Index into the live surah's ayahs, or -1 when nothing is live. */
  currentAyahIndex(): number;
  /** The live surah's timings, or null. */
  currentTimings(): SurahTimings | null;
  /** Ayah-local position of the live player in ms (0 when nothing is live). */
  localTimeMs(): number;
  /** Release everything (tests, and the provider's unmount). */
  __resetForTests(): void;
}

// The bar is visible from first launch, offering Al-Fatihah 1:1 with a Play
// button — asked for from the device: nothing has played yet, but the user
// should be able to press play and have recitation start, not hunt for a
// surah first. `surahId` here is the *offered* surah; `playingSurah`
// (still null) is what says whether anything is actually live.
const INITIAL: EngineState = {
  surahId: 1,
  surahName: getSurahMeta(1)?.nameSimple ?? 'Al-Fatihah',
  ayah: 1,
  isPlaying: false,
  isLoading: false,
  error: null,
  pendingSurahId: null,
};

/**
 * Owns playback for the whole process.
 *
 * This used to be the body of `PlayerProvider` — refs, effects and all. It
 * is a plain closure now, built once at module scope, because playback has
 * three drivers and only one of them is a screen: the app's own UI (through
 * `usePlayer()`), Android's lock screen / notification, and — from Stage 3a
 * — a car head unit, which may start this JS runtime with no Activity and
 * no React tree at all and drive the same sequencer. Nothing here imports
 * React; `PlayerProvider` is a thin `useSyncExternalStore` binding over the
 * snapshot store below.
 *
 * Built once and never torn down in the app (`__resetForTests` exists for
 * the tests), so — exactly as when this was a provider mounted above the
 * screen switch — navigating between the surah list and the reader never
 * interrupts recitation.
 */
function createEngine(): PlaybackEngine {
  let state: EngineState = INITIAL;
  const listeners = new Set<() => void>();

  let activeSequencer: AyahSequencer | null = null;
  /** The core `SyncEngine` driving the word highlight, or `null`. */
  let activeSync: SyncEngine | null = null;
  let activeTimings: SurahTimings | null = null;
  /** The surah id the live sequencer is actually playing, or `null`. */
  let playingSurah: number | null = null;
  /** The surah id the currently mounted reader screen is showing, or `null`. */
  let viewedSurah: number | null = null;
  /**
   * Monotonically increasing token identifying the most recent `play` call.
   * `loadTimings` for an uncached surah can take arbitrarily long, and
   * nothing otherwise stops a slow call from resolving after a later call
   * has already become the live playback — it would tear that down and
   * replace it with the stale surah. Every call captures its own token and
   * checks it is still current before mutating anything.
   */
  let request = 0;
  /** Index into the live surah's `ayahs` that the sequencer is on. */
  let ayahIndex = 0;
  /** Removes the live surah's sequencer handlers; replaced at each switch-over. */
  let activeDetach: (() => void) | null = null;
  /**
   * Which `play()` call's handlers may act on sequencer events. Bumped the
   * moment a call starts mutating the shared sequencer (`switchTo`), not at
   * its commit: from that moment the sequencer's indices belong to the new
   * surah, and the previous surah's still-registered handlers must not read
   * them as their own — or a superseded switch would paint the bar with the
   * old surah's ayah numbers and word timings over another surah's audio.
   */
  let handlerEpoch = 0;
  /** The native player currently handed to Android as the lock-screen controller. */
  let boundLockScreenPlayer: AudioPlayer | null = null;
  /**
   * The live playback's own "bind Android's media session to whatever is
   * audible now" closure, republished by every `play()` that becomes live.
   *
   * Held here, not in the state: the `AppState` subscription in `start()`
   * has to reach the *current* one without re-subscribing whenever playback
   * changes — this engine's whole discipline is that nothing which ticks per
   * ayah is ever a dependency (see the note on the context value in
   * PlayerProvider.tsx).
   */
  let register: (() => void) | null = null;
  /** `start()` is idempotent: every React mount calls it, the car calls it too. */
  let started = false;
  let appStateSub: { remove(): void } | null = null;

  /**
   * The snapshot changes identity only when a field really moved. Readers
   * memoise on it — `useSyncExternalStore` re-renders on every notify and
   * compares by reference, and would loop ("Maximum update depth exceeded")
   * on a store that allocated a new object per notify.
   */
  function patch(next: Partial<EngineState>): void {
    const keys = Object.keys(next) as (keyof EngineState)[];
    if (keys.every(key => state[key] === next[key])) return;
    state = { ...state, ...next };
    listeners.forEach(listener => { listener(); });
  }

  /**
   * Paint the highlight only while the mounted screen is showing the surah
   * that is actually playing — otherwise opening a different surah while
   * one plays would highlight text on the wrong page.
   */
  function paint(wordId: string | null): void {
    if (viewedSurah !== playingSurah) return;
    activeWordStore.set(wordId);
  }

  /** The ayah number now reciting, for the lock screen's subtitle. */
  function currentAyahNumber(): number {
    return activeTimings?.ayahs[ayahIndex]?.ayah ?? 1;
  }

  function teardown(): void {
    activeDetach?.();
    activeDetach = null;
    boundLockScreenPlayer = null;
    activeSync?.detach();
    activeSequencer?.release();
    activeSync = null;
    activeSequencer = null;
    activeTimings = null;
    playingSurah = null;
    activeWordStore.set(null);
  }

  async function play(surahId: number, ayah?: number, wordId?: string): Promise<void> {
    const token = ++request;

    // Word taps recite from that word, as clicking a word does on the web.
    // Word times are ayah-local, which is exactly what `seekToAyah` takes.
    const localMsFor = (timings: SurahTimings, index: number): number => {
      if (!wordId) return 0;
      return timings.ayahs[index]?.words.find(w => w.id === wordId)?.startMs ?? 0;
    };

    // Fast path: this surah is already the live one — seek/play in place
    // rather than tearing down a working sequencer and rebuilding it.
    if (playingSurah === surahId && activeSequencer && activeTimings) {
      const sequencer = activeSequencer;
      const timings = activeTimings;
      // Clears any transient state left by a superseded load of some other
      // surah — including `isLoading`, or a consumer could be left showing a
      // spinner for a load that stale-bailed and will never resolve it.
      patch({ error: null, isLoading: false, pendingSurahId: null });
      if (ayah !== undefined) {
        const index = timings.ayahs.findIndex(a => a.ayah === ayah);
        if (index !== -1) await sequencer.seekToAyah(index, localMsFor(timings, index));
      }
      if (token !== request) return;
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
    if (playingSurah === null) {
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
    if (token !== request) return;

    let timings: SurahTimings;
    try {
      timings = await loadTimings(surahId);
    } catch {
      // A newer call has already superseded this one — its failure belongs
      // to a surah the user has already moved past, so it must not surface
      // as an error for whatever is live now.
      if (token !== request) return;
      // Attributed to the surah that failed via `pendingSurahId`; `surahId`/
      // `surahName` still name whatever is actually live (or stay null).
      patch({
        error: 'Could not load this surah. Please try again.',
        isLoading: false,
        pendingSurahId: surahId,
      });
      return;
    }
    if (token !== request) return;

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
    const reuse = activeSequencer !== null && activeSync !== null;
    const sync = activeSync ?? new SyncEngine();
    // The next ayah is prefetched to disk while the current one plays
    // (`warmCache`, a no-op for an ayah already in the offline folder), and
    // every load goes through `localAudioFor` (offline folder, then warm
    // cache), so the single player's boundary reload — and "previous", and
    // replays — come from a local file rather than the network, offline
    // surahs included.
    const sequencer = activeSequencer
      ?? new AyahSequencer(timings.ayahs, createExpoPlayer, localAudioFor, warmCache);

    // Nothing from here until the switch-over touches the visible state.
    // The old surah stays the surah every closure variable and every state
    // field describes until the new one has actually loaded its first ayah —
    // the bar never names a surah that has not loaded. (With one player the
    // old surah's sound stops when that load begins; the new one follows
    // within the load.) The handlers below are armed now but gated on
    // `live`, which flips at the switch-over; the previous surah's handlers
    // are removed at that same moment (and this surah's, instead, if its
    // load fails).
    let live = false;
    const epoch = ++handlerEpoch;
    // Until this call owns the sequencer, the previous surah's handlers do.
    // Ownership passes when `switchTo` begins mutating it (below).
    const mine = () => live && handlerEpoch === epoch;

    /**
     * The native player this playback handed to Android as the lock-screen
     * controller. Kept so `registerLockScreen` can tell "the binding is
     * already on one of *my* players" from "it belongs to a surah that is
     * no longer playing" — see the comment in `registerLockScreen`.
     */
    let lockScreenPlayer: AudioPlayer | null = boundLockScreenPlayer;

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
        setNowPlaying(lockScreenPlayer, lockScreenMeta(meta, currentAyahNumber()));
        return;
      }
      lockScreenPlayer = native;
      boundLockScreenPlayer = native;
      setNowPlaying(native, lockScreenMeta(meta, currentAyahNumber()));
    };

    if (!reuse) sync.onChange(paint);

    const onAyahChange = (index: number) => {
      // The sync engine is shared; feeding it is safe before `live` (it
      // paints nothing until `playingSurah` names this surah), and after the
      // switch-over these are the only handlers left standing.
      if (!mine()) return;
      sync.setWords(timings.ayahs[index]?.words ?? []);
      ayahIndex = index;
      const timing = timings.ayahs[index];
      patch({ ayah: timing?.ayah ?? 1, error: null });
      registerLockScreen();
      if (timing) {
        // Bookmark for the next launch, and warm the cache with the ayah now
        // reciting so "previous" and replays come from disk.
        writeLastPosition({ surahId, ayah: timing.ayah, localMs: 0 });
        void warmCache(timing);
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
      if (playing) sync.attach(() => sequencer.localTimeMs, timings.ayahs[sequencer.currentIndex]?.words ?? []);
      else sync.detach();
      patch({ isPlaying: playing });
    };
    const onError = (message: string) => {
      if (mine()) patch({ error: message, isPlaying: false, isLoading: false, pendingSurahId: surahId });
    };
    const onEnded = () => {
      if (!mine()) return;
      sync.detach();
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
    const previousOwner = handlerEpoch;
    handlerEpoch = epoch;
    try {
      if (reuse) await sequencer.switchTo(timings.ayahs, startIndex, localMsFor(timings, startIndex));
      else await sequencer.seekToAyah(startIndex, localMsFor(timings, startIndex));
    } catch {
      detachHandlers();
      if (!reuse) { sync.detach(); sequencer.release(); }
      // The sequencer rolled itself back to the previous surah (unless a
      // newer call has since taken it), so its events belong to the
      // previous owner again.
      if (handlerEpoch === epoch) handlerEpoch = previousOwner;
      if (token !== request) return;
      // This failure belongs to the surah that was asked for, so it is
      // attributed there. The old surah keeps its name in the bar but is no
      // longer sounding — one player, and the load replaced its source — so
      // its `isPlaying` is corrected too; pressing play re-seeks it.
      sync.detach();
      patch({
        error: 'Could not load this recitation. Please try again.',
        isLoading: false,
        isPlaying: false,
        pendingSurahId: surahId,
      });
      return;
    }
    if (token !== request) {
      // A faster later call became the live playback while this loaded.
      detachHandlers();
      if (!reuse) { sync.detach(); sequencer.release(); }
      return;
    }

    // The switch-over: the one point where the visible surah changes.
    // Everything above ran off locals, so until here the old surah's state
    // was intact. The previous surah's handlers go now; nothing is pending
    // any more: this call succeeded, and any later call has already claimed
    // `pendingSurahId`.
    activeTimings = timings;
    ayahIndex = startIndex;
    registerLockScreen();
    register = registerLockScreen;
    activeDetach?.();
    activeDetach = detachHandlers;

    activeSync = sync;
    activeSequencer = sequencer;
    playingSurah = surahId;
    live = true;
    // `switchTo` may have resumed the new surah on its own (the old one was
    // playing); the sync engine follows the live state either way.
    if (sequencer.activePlayer?.playing) {
      sync.attach(() => sequencer.localTimeMs, timings.ayahs[startIndex]?.words ?? []);
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
      void warmCache(first);
    }

    await sequencer.play();
  }

  function toggle(): void {
    const sequencer = activeSequencer;
    if (!sequencer) {
      // Nothing live yet (first launch, or the previous attempt failed):
      // play starts whatever the bar is offering instead of doing nothing.
      // The offer is the snapshot itself — `state.isPlaying`/`surahId`/
      // `ayah` are read straight off it here, where the provider needed
      // mirror refs to read them without taking a dependency on React
      // state it would then re-render on.
      const { surahId, ayah } = state;
      if (surahId !== null) void play(surahId, ayah);
      return;
    }
    if (state.isPlaying) sequencer.pause();
    else void sequencer.play();
  }

  // On the last ayah, "next" continues into the next surah rather than
  // stopping dead — the user asked for exactly this from the device. The
  // web's bar does not do it (its `next` is a bare `playlist.next()`), so
  // this is a deliberate mobile divergence, not a port.
  async function next(): Promise<void> {
    const sequencer = activeSequencer;
    const timings = activeTimings;
    const surahId = playingSurah;
    if (!sequencer || !timings || surahId === null) return;
    if (ayahIndex >= timings.ayahs.length - 1) {
      if (surahId < 114) await play(surahId + 1);
      return;
    }
    await sequencer.next();
  }

  function prev(): Promise<void> {
    return activeSequencer?.prev() ?? Promise.resolve();
  }

  // The car's skip buttons: always from ayah 1 of the neighbouring surah,
  // never a resume-in-place — that is what `next()`/`prev()` are for. Reads
  // `playingSurah` first (what is actually live), falling back to the
  // offered `state.surahId` so a skip pressed before anything has played
  // still moves the offer rather than doing nothing.
  async function nextSurah(): Promise<void> {
    const surahId = playingSurah ?? state.surahId;
    if (surahId !== null && surahId < 114) await play(surahId + 1);
  }

  async function prevSurah(): Promise<void> {
    const surahId = playingSurah ?? state.surahId;
    if (surahId !== null && surahId > 1) await play(surahId - 1);
  }

  // What the car's bare "play" means: resume whatever is already live
  // (paused or playing — `sequencer.play()` on an already-playing sequencer
  // is a no-op), else start playback of whatever is offered — the bookmark
  // once `start()` has read it, or the initial Al-Fatihah 1:1 offer before
  // that.
  async function resume(): Promise<void> {
    if (activeSequencer && playingSurah !== null) {
      await activeSequencer.play();
      return;
    }
    const { surahId, ayah } = state;
    if (surahId !== null) await play(surahId, ayah);
  }

  // Surah-level seek for the car (spec §5.4): maps an absolute position in
  // the live surah onto (ayah index, ayah-local ms) by `startOffsetMs` — the
  // last ayah whose start is at or before the position — then hands the
  // sequencer its own `seekToAyah`. Reads `activeSequencer`/`activeTimings`/
  // `playingSurah` together into locals before any await, exactly as
  // `next()` does above: outside the synchronous switch-over window inside
  // `play()` these three always agree, and capturing them up front is what
  // keeps that true here too. A no-op when nothing is live.
  async function seekToSurahPosition(positionMs: number): Promise<void> {
    const sequencer = activeSequencer;
    const timings = activeTimings;
    const surahId = playingSurah;
    if (!sequencer || !timings || surahId === null) return;
    let index = 0;
    for (let i = 0; i < timings.ayahs.length; i++) {
      if (timings.ayahs[i].startOffsetMs <= positionMs) index = i;
    }
    const localMs = Math.max(0, positionMs - timings.ayahs[index].startOffsetMs);
    await sequencer.seekToAyah(index, localMs);
  }

  function attachViewer(surahId: number): () => void {
    viewedSurah = surahId;
    // Not the surah that's playing: make sure nothing stale is left
    // highlighted on this screen from whatever was last painted.
    if (surahId !== playingSurah) activeWordStore.set(null);
    return () => {
      if (viewedSurah === surahId) viewedSurah = null;
    };
  }

  function start(): void {
    // Idempotent: every `PlayerProvider` mount calls this, and so does the
    // car's headless entry point — whichever runs first wins, and the second
    // must not double-subscribe or re-read the bookmark over live playback.
    if (started) return;
    started = true;

    // Re-bind Android's media session to the audible player whenever the app
    // comes back to the foreground. Boundary crossings keep the binding
    // current on their own, but nothing else re-checks it, so without this a
    // binding left stale by anything at all — a boundary the app slept
    // through, a registration the OS declined while backgrounded — would
    // persist until the *next* boundary, leaving the notification's buttons
    // pointed at a player that is not the one making sound.
    //
    // Subscribed once, for the process: it reaches the live playback only
    // through `register`, never through the state, so it is not re-subscribed
    // on every ayah (see the note on the context value in
    // PlayerProvider.tsx).
    appStateSub = AppState.addEventListener('change', status => {
      if (status === 'active') register?.();
    });

    // Offer "continue where you left off" instead of Al-Fatihah 1:1 — but
    // only if nothing has started by the time the bookmark is read; a user
    // who tapped play before the file loaded must not have the bar yanked
    // back to yesterday's position.
    void readLastPosition().then(pos => {
      if (!pos || request !== 0) return;
      patch({ surahId: pos.surahId, surahName: getSurahMeta(pos.surahId)?.nameSimple ?? null, ayah: pos.ayah });
    });
  }

  /**
   * Back to a freshly imported engine. `teardown()` is the sole release of
   * the sequencer, sync engine and native player — surah switches reuse them
   * — so this is also where a stray `pendingSurahId` goes, along with the
   * request token and the handler epoch the next test starts counting from.
   *
   * Only the tests call it (the provider used to be torn down by unmount;
   * this engine outlives every React tree on purpose). The subscriptions go
   * with it rather than being notified: a renderer from the test just
   * finished is usually still mounted, and telling it about a reset would be
   * an update outside `act`. Anything mounted afterwards subscribes afresh
   * and reads `INITIAL`.
   */
  function __resetForTests(): void {
    register = null;
    teardown();
    appStateSub?.remove();
    appStateSub = null;
    started = false;
    state = INITIAL;
    request = 0;
    handlerEpoch = 0;
    ayahIndex = 0;
    viewedSurah = null;
    listeners.clear();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start,
    play,
    toggle,
    next,
    prev,
    nextSurah,
    prevSurah,
    resume,
    seekToSurahPosition,
    attachViewer,
    currentAyahIndex: () => (playingSurah === null ? -1 : ayahIndex),
    currentTimings: () => activeTimings,
    localTimeMs: () => activeSequencer?.localTimeMs ?? 0,
    __resetForTests,
  };
}

/**
 * The one playback engine for the process — the screens, the lock screen and
 * the car all drive this object.
 */
export const engine: PlaybackEngine = createEngine();
