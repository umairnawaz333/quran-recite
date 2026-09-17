import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createExpoPlayer } from '../src/audio/expoPlayer';

/**
 * Fakes just enough of expo-audio's `AudioPlayer` to exercise the promise
 * orchestration in `expoPlayer.ts` — the part that is genuinely this
 * project's own logic, as opposed to "does the real native module always
 * emit a fresh status per call", which is an integration assumption about
 * the library's contract that no fake can establish.
 *
 * `addListener` records callbacks in a registry (so tests can assert on how
 * many are still attached, e.g. after `release()`) and returns a real
 * `remove()` that unregisters them, mirroring expo-modules-core's
 * `EventSubscription`. `emit` is the test-only hook that fires a synthetic
 * `playbackStatusUpdate`.
 */
function createFakePlayer() {
  const listeners = new Set<(status: unknown) => void>();
  // Every callback ever passed to `addListener`, in order and never removed
  // from this array — independent of `listeners` above, which shrinks on
  // `remove()`. This is what lets a test invoke the *first* (persistent,
  // finish-tracking) listener directly, bypassing the mock's own
  // unsubscription bookkeeping entirely, to check that `release()` doesn't
  // rely on unsubscription being the only thing standing between a stray
  // status event and a stale `onFinished` callback firing.
  const everAdded: ((status: unknown) => void)[] = [];
  return {
    playing: false,
    currentTime: 0,
    addListener: vi.fn((_event: string, cb: (status: unknown) => void) => {
      listeners.add(cb);
      everAdded.push(cb);
      return { remove: () => listeners.delete(cb) };
    }),
    replace: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    seekTo: vi.fn(() => Promise.resolve()),
    remove: vi.fn(),
    emit(status: unknown) {
      // Snapshot before iterating: a listener's own reaction to a status
      // (e.g. `load()`'s handler calling `sub.remove()`) mutates `listeners`
      // mid-emit otherwise, which is exactly the kind of self-inflicted bug
      // this fake should not paper over.
      [...listeners].forEach(cb => cb(status));
    },
    listenerCount: () => listeners.size,
    /** The persistent `playbackStatusUpdate` listener `createExpoPlayer` adds once, up front. */
    firstListener: () => everAdded[0],
  };
}

let fakePlayer: ReturnType<typeof createFakePlayer>;

vi.mock('expo-audio', () => ({
  createAudioPlayer: () => fakePlayer,
}));

beforeEach(() => {
  fakePlayer = createFakePlayer();
});

describe('createExpoPlayer', () => {
  it('load() resolves once a status reporting isLoaded is emitted', async () => {
    const player = createExpoPlayer();
    const loaded = player.load('https://example.com/001001.mp3');

    expect(fakePlayer.replace).toHaveBeenCalledWith({ uri: 'https://example.com/001001.mp3' });
    fakePlayer.emit({ isLoaded: true });

    await expect(loaded).resolves.toBeUndefined();
  });

  it('load() rejects with the status error when one is emitted', async () => {
    const player = createExpoPlayer();
    const loaded = player.load('https://example.com/missing.mp3');

    fakePlayer.emit({ error: 'source not found' });

    await expect(loaded).rejects.toThrow('source not found');
  });

  it('play() rejects with the status error when one is emitted', async () => {
    const player = createExpoPlayer();
    const played = player.play();

    fakePlayer.emit({ error: 'decode error' });

    await expect(played).rejects.toThrow('decode error');
  });

  it('play() resolves once a status reporting playing is emitted', async () => {
    const player = createExpoPlayer();
    const played = player.play();

    fakePlayer.emit({ playing: true });

    await expect(played).resolves.toBeUndefined();
  });

  it('play() short-circuits when the player is already playing, rather than waiting for an event', async () => {
    fakePlayer.playing = true;
    const player = createExpoPlayer();

    // No emit() here at all: if play() attached a listener and waited for a
    // status the way it does from a stopped state, this would hang and the
    // test would time out rather than resolve.
    await expect(player.play()).resolves.toBeUndefined();
    expect(fakePlayer.play).not.toHaveBeenCalled();
  });

  it('release() removes the status subscription', () => {
    const player = createExpoPlayer();
    player.onFinished(vi.fn());

    // One listener: the persistent playbackStatusUpdate subscription that
    // turns didJustFinish into onFinished callbacks.
    expect(fakePlayer.listenerCount()).toBe(1);

    player.release();

    expect(fakePlayer.listenerCount()).toBe(0);
  });

  it('release() pauses the player before removing it, so a released player cannot keep sounding', () => {
    const player = createExpoPlayer();
    fakePlayer.playing = true;

    player.release();

    expect(fakePlayer.pause).toHaveBeenCalled();
    // Order matters, not just the call: pausing after the native player has
    // already been removed is too late to stop anything.
    const pauseOrder = fakePlayer.pause.mock.invocationCallOrder[0];
    const removeOrder = fakePlayer.remove.mock.invocationCallOrder[0];
    expect(pauseOrder).toBeLessThan(removeOrder);
  });

  it('release() clears finished callbacks, independent of the subscription being removed', () => {
    const player = createExpoPlayer();
    const onFinished = vi.fn();
    player.onFinished(onFinished);

    const persistentListener = fakePlayer.firstListener();
    player.release();

    // Call the raw listener directly, bypassing `listeners.delete()` in the
    // fake entirely — this is deliberately not `fakePlayer.emit(...)`, which
    // would prove nothing here since `release()` already unsubscribed it
    // there. This simulates a status event already in flight the instant
    // `release()` ran (or a native unsubscribe that hasn't taken effect
    // yet): `release()` must not depend solely on unsubscription to keep a
    // released player's callbacks from firing.
    persistentListener!({ didJustFinish: true });

    expect(onFinished).not.toHaveBeenCalled();
  });

  it('onFinished invokes registered callbacks when a status reports didJustFinish', () => {
    const player = createExpoPlayer();
    const onFinished = vi.fn();
    player.onFinished(onFinished);

    fakePlayer.emit({ didJustFinish: true });

    expect(onFinished).toHaveBeenCalledTimes(1);
  });
});
