/**
 * Mounts `<PlayerProvider>` with a probe child that captures every value
 * `usePlayer()` hands out, which is what lets the tests assert on the state
 * the app's screens actually see rather than on the provider's internals.
 *
 * Importing this module pulls in `PlayerProvider`, so the test file that
 * imports it must have already registered its `vi.mock`s for `react-native`,
 * `expo-audio`, `expo-file-system`, `react-native-svg`,
 * `../src/audio/expoPlayer` and `../src/audio/nowPlaying` — vitest hoists
 * those above every import, so simply declaring them in the test file is
 * enough.
 */
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import type { ReactNode } from 'react';
import { configureTimings, resetTimingsCache } from '@quran/core';
import { engine } from '../../src/player/PlaybackEngine';
import { PlayerProvider, usePlayer } from '../../src/player/PlayerProvider';
import type { PlayerContextValue } from '../../src/player/PlayerProvider';
import { activeWordStore } from '../../src/reader/activeWordStore';
import { resetAudio } from './fakeAudio';
import { resetFileSystem } from './fakeFileSystem';
import { resetTimings, timingsStore } from './fakeTimings';
import { installFrameClock, resetFrames } from './frames';
import { resetReactNative } from './reactNativeMock';

/**
 * Call from `beforeEach`. `resetTimingsCache()` drops core's memoised
 * timings *and* its configuration — including the store — so the store has
 * to be re-registered here every time, or one test's surah data would leak
 * into the next.
 */
export function resetPlayerEnvironment(): void {
  // Without this React refuses to treat `act` as an act scope ("the current
  // testing environment is not configured to support act(...)"), and the
  // updates a test triggers are no longer guaranteed to be flushed by the
  // time it asserts.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  installFrameClock();
  resetFrames();
  resetAudio();
  resetFileSystem();
  resetTimings();
  resetReactNative();
  // The engine is a module-scope singleton that outlives every React tree
  // (the car can drive it with no Activity), so unmounting a provider no
  // longer releases anything: the harness resets it between tests instead.
  engine.__resetForTests();
  resetTimingsCache();
  configureTimings({ store: timingsStore });
  activeWordStore.set(null);
}

export interface PlayerHarness {
  /** What `usePlayer()` returned on the most recent render. */
  readonly current: PlayerContextValue;
  /** Every value `usePlayer()` has returned, oldest render first. */
  readonly renders: PlayerContextValue[];
  readonly tree: ReactTestRenderer;
  unmount(): void;
}

/**
 * Mounts the provider and returns immediately, on purpose: the mount's
 * "continue where you left off" read is still in flight when this returns,
 * which is the only window in which a test can press play *before* the
 * bookmark resolves. Tests that want the settled state call `await flush()`.
 */
export function mountPlayer(children?: ReactNode): PlayerHarness {
  const renders: PlayerContextValue[] = [];

  function Probe() {
    renders.push(usePlayer());
    return null;
  }

  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <PlayerProvider>
        <Probe />
        {children}
      </PlayerProvider>,
    );
  });

  return {
    get current() {
      const latest = renders[renders.length - 1];
      if (!latest) throw new Error('the provider never rendered its children');
      return latest;
    },
    renders,
    tree,
    unmount() {
      act(() => {
        tree.unmount();
      });
    },
  };
}

/**
 * Lets every pending promise (and the React work it causes) settle. Yields
 * through a timer rather than a bare microtask: the paths under test chain
 * several awaits (an audio-mode call, a timings read, a load) and a single
 * microtask turn would only advance them one link.
 */
export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => { setTimeout(resolve, 0); });
  });
}

/**
 * Starts a `play()` without awaiting it, so the synchronous, immediate state
 * can be asserted before anything resolves. The returned promise is the
 * `play()` call itself.
 */
export function startPlay(harness: PlayerHarness, surahId: number, ayah?: number): Promise<void> {
  let started!: Promise<void>;
  act(() => {
    started = harness.current.play(surahId, ayah);
  });
  return started;
}

/** Plays and waits for playback to be fully live (or to have failed). */
export async function playFully(harness: PlayerHarness, surahId: number, ayah?: number): Promise<void> {
  const started = startPlay(harness, surahId, ayah);
  await actFlush(async () => { await started; });
}

/** Runs `body` inside `act`, then lets everything it started settle. */
export async function actFlush(body: () => void | Promise<void>): Promise<void> {
  await act(async () => {
    await body();
    await new Promise<void>(resolve => { setTimeout(resolve, 0); });
  });
}
