import { describe, it, expect, vi } from 'vitest';
import type { AyahTiming } from '@quran/core';
import { AyahSequencer } from '../src/audio/AyahSequencer';
import type { PlayerHandle } from '../src/audio/types';

const ayahs: AyahTiming[] = [1, 2, 3].map(n => ({
  ayah: n,
  audioUrl: `/audio/abdulbasit-murattal/00100${n}.mp3`,
  startOffsetMs: (n - 1) * 5000,
  durationMs: 5000,
  words: [],
}));

function fakePlayer(overrides: Partial<PlayerHandle> = {}) {
  const finishers: (() => void)[] = [];
  const p: PlayerHandle & { finish(): void; loaded: string[] } = {
    currentTimeMs: 0,
    playing: false,
    loaded: [],
    async load(uri) { p.loaded.push(uri); },
    async play() { (p as { playing: boolean }).playing = true; },
    pause() { (p as { playing: boolean }).playing = false; },
    seekToMs() {},
    onFinished(cb) { finishers.push(cb); return () => {}; },
    release() {},
    finish() { finishers.forEach(cb => cb()); },
    ...overrides,
  };
  return p;
}

describe('AyahSequencer', () => {
  it('advances to the next ayah when one finishes', async () => {
    const players = [fakePlayer(), fakePlayer()];
    let i = 0;
    const seq = new AyahSequencer(ayahs, () => players[i++ % 2]);
    const changes: number[] = [];
    seq.on('ayahchange', n => changes.push(n));

    await seq.seekToAyah(0);
    await seq.play();
    players.forEach(p => p.finish());

    expect(changes).toContain(1);
  });

  it('reports not-playing and an error when play() fails terminally', async () => {
    const p = fakePlayer({ play: () => Promise.reject(new Error('NotAllowedError')) });
    const seq = new AyahSequencer(ayahs, () => p);
    const states: boolean[] = [];
    const errors: string[] = [];
    seq.on('state', s => states.push(s));
    seq.on('error', e => errors.push(e));

    await seq.seekToAyah(0);
    await seq.play();

    // The web app shipped a bug where a rejected play() left isPlaying true
    // forever. That must not recur.
    expect(states.at(-1)).toBe(false);
    expect(errors).toHaveLength(1);
  });

  it('retries once when play() rejects with AbortError', async () => {
    const play = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      .mockResolvedValueOnce(undefined);
    const seq = new AyahSequencer(ayahs, () => fakePlayer({ play }));

    await seq.seekToAyah(0);
    await seq.play();

    expect(play).toHaveBeenCalledTimes(2);
  });

  it('ignores a finish from an ayah the user has already skipped past', async () => {
    const p = fakePlayer();
    const seq = new AyahSequencer(ayahs, () => p);
    const changes: number[] = [];
    seq.on('ayahchange', n => changes.push(n));

    await seq.seekToAyah(0);
    await seq.seekToAyah(2);      // user jumps ahead
    p.finish();                    // the stale ayah 0 completion lands late

    // The full sequence, not just its last element: with the generation guard
    // removed the stale completion advances to 1 and the next change comes back
    // to 2, giving [0, 2, 1, 2] — which has the same last element as the correct
    // [0, 2]. Pinning only `at(-1)` therefore passes either way.
    expect(changes).toEqual([0, 2]);
  });

  it('emits ended and does not advance past the final ayah', async () => {
    const p = fakePlayer();
    const seq = new AyahSequencer(ayahs, () => p);
    const ended = vi.fn();
    seq.on('ended', ended);

    await seq.seekToAyah(2);
    await seq.play();
    p.finish();

    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('ignores a superseded seekToAyah when its own load resolves after a later seek', async () => {
    const resolvers: (() => void)[] = [];
    const p = fakePlayer({
      load: () => new Promise<void>(resolve => { resolvers.push(resolve); }),
    });
    const seq = new AyahSequencer(ayahs, () => p);
    const changes: number[] = [];
    seq.on('ayahchange', n => changes.push(n));

    const a = seq.seekToAyah(0); // not awaited — its load() is still pending
    const b = seq.seekToAyah(2); // supersedes A before A's load settles

    // Resolve the later call's load first, then the superseded call's late.
    // Without a generation recheck right after the await, A's continuation
    // would still run and emit a phantom ayahchange(0) after the correct
    // ayahchange(2) — changes: [2, 0].
    resolvers[1]();
    await b;
    resolvers[0]();
    await a;

    expect(changes).toEqual([2]);
  });

  it('reloads a slot before playing if its preloaded load rejected', async () => {
    // Unlike a real <audio> element, this fake's play() only succeeds if
    // load() previously succeeded — modelling that a rejected preload really
    // does leave the slot silent unless something reloads it before playing.
    let ready = false;
    let failNextLoad = true;
    const finishers: (() => void)[] = [];
    const flaky: PlayerHandle & { finish(): void } = {
      currentTimeMs: 0,
      playing: false,
      async load() {
        if (failNextLoad) {
          failNextLoad = false;
          throw new Error('network error');
        }
        ready = true;
      },
      async play() {
        if (!ready) throw new Error('no source loaded');
        (flaky as { playing: boolean }).playing = true;
      },
      pause() { (flaky as { playing: boolean }).playing = false; },
      seekToMs() {},
      onFinished(cb) { finishers.push(cb); return () => {}; },
      release() {},
      finish() { finishers.forEach(cb => cb()); },
    };

    const players: (PlayerHandle & { finish(): void })[] = [fakePlayer(), flaky];
    let i = 0;
    const seq = new AyahSequencer(ayahs, () => players[i++ % 2]);
    const errors: string[] = [];
    seq.on('error', e => errors.push(e));

    await seq.seekToAyah(0); // loads players[0] with ayah 0; preloads `flaky` with ayah 1 — rejects
    await seq.play();
    players[0].finish(); // ayah 0 ends — the boundary crossing lands on `flaky`, whose preload failed

    // Let the reload that advanceInto triggers on the failed slot settle.
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(flaky.playing).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('silences the previous player when seeking to another ayah', async () => {
    const players = [fakePlayer(), fakePlayer()];
    let i = 0;
    const seq = new AyahSequencer(ayahs, () => players[i++ % 2]);

    await seq.seekToAyah(0);
    await seq.play();
    // Advance so the OTHER slot becomes the sounding one.
    players.forEach(p => p.finish());
    await seq.seekToAyah(2);

    // Exactly one player may be producing sound.
    expect(players.filter(p => p.playing)).toHaveLength(1);
  });

  it('pause() silences both players, not just the active slot', async () => {
    const players = [fakePlayer(), fakePlayer()];
    let i = 0;
    const seq = new AyahSequencer(ayahs, () => players[i++ % 2]);

    await seq.seekToAyah(0);
    await seq.play();
    players.forEach(p => p.finish());
    seq.pause();

    expect(players.some(p => p.playing)).toBe(false);
  });

  it('reports not-playing when play() rejection is deferred past a macrotask boundary', async () => {
    // An immediately-rejecting mock (as in the terminal-failure test above)
    // can't tell "awaited" apart from "called but not awaited"; attemptPlay's
    // own try/catch runs regardless, and happens to settle before the outer
    // caller's continuation either way. Deferring the rejection past a
    // setTimeout does discriminate: `void this.attemptPlay(...)` instead of
    // `await this.attemptPlay(...)` would let seq.play() resolve while
    // states is still sitting on [true], before the rejection ever lands.
    const play = () => new Promise<void>((_resolve, reject) => {
      setTimeout(() => reject(new Error('NotAllowedError')), 0);
    });
    const seq = new AyahSequencer(ayahs, () => fakePlayer({ play }));
    const states: boolean[] = [];
    seq.on('state', s => states.push(s));

    await seq.seekToAyah(0);
    await seq.play();

    expect(states).toEqual([true, false]);
  });
});
