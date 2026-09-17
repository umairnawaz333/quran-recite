/**
 * Stand-ins for everything between the provider and real sound: the
 * `PlayerHandle`s `createExpoPlayer` would hand back, the `expo-audio`
 * module-level calls, and the lock-screen binding in `nowPlaying`.
 *
 * `AyahSequencer` itself is deliberately NOT faked — the provider's hardest
 * invariants (the old surah stays audible until the new one's first ayah has
 * loaded; an `ended` on the last ayah continues into the next surah) are
 * properties of the provider *driving a real sequencer*, and a fake
 * sequencer would let them regress untouched. So these fakes sit exactly
 * where the device does, and every player the sequencer creates is recorded
 * here so a test can ask which players exist, which are making sound, and
 * which have been released.
 */
import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type { PlayerHandle } from '../../src/audio/types';

/** The `expo-audio` `AudioPlayer` the provider reaches through for the lock screen. */
export interface FakeNativePlayer {
  readonly id: number;
  setActiveForLockScreen: Mock<(active: boolean, metadata: unknown) => void>;
  updateLockScreenMetadata: Mock<(metadata: unknown) => void>;
}

export interface FakePlayer extends PlayerHandle {
  readonly id: number;
  /** Every uri this player was asked to load, in order. */
  readonly loaded: string[];
  released: boolean;
  /** Set if anything tried to play this player after it was released. */
  playedWhileReleased: boolean;
  readonly nativePlayer: FakeNativePlayer;
  /** Moves the playhead the highlight loop reads. */
  setTime(ms: number): void;
  /** The file reached its natural end (never reported as a transport change). */
  finish(): void;
  /** This player really started/stopped with nothing in the app asking it to. */
  transportChanged(playing: boolean): void;
}

interface HeldLoad {
  uri: string;
  release(): void;
  fail(): void;
}

export const audio = {
  /** Every player created since the last reset, oldest first. */
  players: [] as FakePlayer[],
  /** Loads whose uri matches are parked until `releaseHeldLoads()`. */
  holdLoadsMatching: null as RegExp | null,
  /** Loads whose uri matches reject immediately. */
  failLoadsMatching: null as RegExp | null,
  held: [] as HeldLoad[],
};

let nextId = 1;

export function createFakePlayer(): FakePlayer {
  const finishers = new Set<() => void>();
  const transport = new Set<(playing: boolean) => void>();

  const mutable = (): { playing: boolean; currentTimeMs: number } =>
    player as unknown as { playing: boolean; currentTimeMs: number };

  /**
   * Announces the change on `onPlayingChanged` exactly as a real player
   * does, so the sequencer's own play()/pause() and a command from outside
   * the app arrive through the same channel — the contract in
   * `src/audio/types.ts`, and the only way a test can tell the provider is
   * classifying them correctly.
   */
  const setPlaying = (playing: boolean) => {
    if (player.playing === playing) return;
    mutable().playing = playing;
    [...transport].forEach(cb => cb(playing));
  };

  const id = nextId++;
  const player: FakePlayer = {
    id,
    currentTimeMs: 0,
    playing: false,
    loaded: [],
    released: false,
    playedWhileReleased: false,
    nativePlayer: {
      id,
      setActiveForLockScreen: vi.fn<(active: boolean, metadata: unknown) => void>(),
      updateLockScreenMetadata: vi.fn<(metadata: unknown) => void>(),
    },
    load(uri: string) {
      player.loaded.push(uri);
      if (audio.failLoadsMatching?.test(uri)) {
        return Promise.reject(new Error(`load refused: ${uri}`));
      }
      if (audio.holdLoadsMatching?.test(uri)) {
        return new Promise<void>((resolve, reject) => {
          audio.held.push({
            uri,
            release: () => resolve(),
            fail: () => reject(new Error(`load refused: ${uri}`)),
          });
        });
      }
      return Promise.resolve();
    },
    async play() {
      if (player.released) {
        player.playedWhileReleased = true;
        return;
      }
      setPlaying(true);
    },
    pause() {
      setPlaying(false);
    },
    seekToMs(ms: number) {
      mutable().currentTimeMs = ms;
    },
    onFinished(cb: () => void) {
      finishers.add(cb);
      return () => finishers.delete(cb);
    },
    onPlayingChanged(cb: (playing: boolean) => void) {
      transport.add(cb);
      return () => transport.delete(cb);
    },
    release() {
      // A released player cannot still be making sound.
      setPlaying(false);
      player.released = true;
    },
    setTime(ms: number) {
      mutable().currentTimeMs = ms;
    },
    finish() {
      [...finishers].forEach(cb => cb());
    },
    transportChanged(playing: boolean) {
      setPlaying(playing);
    },
  };

  audio.players.push(player);
  return player;
}

/** Lets every parked load succeed, in the order the loads were issued. */
export function releaseHeldLoads(): void {
  const held = audio.held.splice(0);
  held.forEach(load => load.release());
}

/** Lets every parked load reject, as an offline device would. */
export function failHeldLoads(): void {
  const held = audio.held.splice(0);
  held.forEach(load => load.fail());
}

// ---------------------------------------------------------------------------
// Mocked module surfaces
// ---------------------------------------------------------------------------

/** `../src/audio/expoPlayer` */
export const createExpoPlayer = vi.fn((): PlayerHandle => createFakePlayer());

/** `expo-audio` */
export const setAudioModeAsync = vi.fn(async (_mode: unknown) => {});
export const createAudioPlayer = vi.fn(() => {
  throw new Error('createAudioPlayer must not be reached: expoPlayer is mocked');
});

/** `../src/audio/nowPlaying` — mirrors the real module's same-player branch. */
let boundPlayer: FakeNativePlayer | null = null;

export const setNowPlaying = vi.fn((player: FakeNativePlayer, metadata: unknown) => {
  if (player === boundPlayer) {
    player.updateLockScreenMetadata(metadata);
    return;
  }
  boundPlayer = player;
  player.setActiveForLockScreen(true, metadata);
});

export const isNowPlaying = vi.fn((player: FakeNativePlayer) => player === boundPlayer);

/** The player Android's media session is currently bound to, if any. */
export function lockScreenPlayer(): FakeNativePlayer | null {
  return boundPlayer;
}

export function resetAudio(): void {
  audio.players = [];
  audio.held = [];
  audio.holdLoadsMatching = null;
  audio.failLoadsMatching = null;
  boundPlayer = null;
  nextId = 1;
  createExpoPlayer.mockClear();
  setAudioModeAsync.mockClear();
  createAudioPlayer.mockClear();
  setNowPlaying.mockClear();
  isNowPlaying.mockClear();
}
