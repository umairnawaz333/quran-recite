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

/**
 * `playing` moves only through `setPlaying`, which also announces the
 * change on `onPlayingChanged` exactly as a real player does — so every
 * `play()`/`pause()` the sequencer issues comes back to it as a transition,
 * and the sequencer's own commands and a command from outside the app
 * arrive through the same channel, indistinguishable except by what the
 * sequencer knows it asked for. That is the whole point: a fake that only
 * announced the outside ones would never catch the sequencer mistaking a
 * seek's own pause for someone pressing pause on the lock screen.
 */
function fakePlayer(overrides: Partial<PlayerHandle> = {}) {
  const finishers: (() => void)[] = [];
  const transport: ((playing: boolean) => void)[] = [];
  const setPlaying = (playing: boolean) => {
    if (p.playing === playing) return;
    (p as { playing: boolean }).playing = playing;
    transport.forEach(cb => cb(playing));
  };
  const p: PlayerHandle & {
    finish(): void;
    /**
     * This player really did start or stop, with nothing in this app
     * asking it to — what Android's notification buttons, lock screen and
     * media keys do, acting straight on the native player.
     */
    transportChanged(playing: boolean): void;
    loaded: string[];
  } = {
    currentTimeMs: 0,
    playing: false,
    loaded: [],
    // Models the real seam: `expoPlayer.load()` pauses before replacing the
    // source, so a player never comes out of a load playing.
    async load(uri) { p.loaded.push(uri); setPlaying(false); },
    async play() { setPlaying(true); },
    pause() { setPlaying(false); },
    seekToMs() {},
    onFinished(cb) { finishers.push(cb); return () => {}; },
    onPlayingChanged(cb) { transport.push(cb); return () => {}; },
    release() {},
    finish() { finishers.forEach(cb => cb()); },
    transportChanged(playing) { setPlaying(playing); },
    ...overrides,
  };
  return p;
}

/** Lets `void`-ed work the sequencer starts from a callback settle. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('AyahSequencer', () => {
  it('advances to the next ayah when one finishes', async () => {
    const p = fakePlayer();
    const seq = new AyahSequencer(ayahs, () => p);
    const changes: number[] = [];
    seq.on('ayahchange', n => changes.push(n));

    await seq.seekToAyah(0);
    await seq.play();
    p.finish();
    await flush();

    expect(changes).toEqual([0, 1]);
    // The same, single player carries the next ayah — loaded, then playing.
    expect(p.loaded).toEqual([ayahs[0].audioUrl, ayahs[1].audioUrl]);
    expect(p.playing).toBe(true);
  });

  it('never creates a second player', async () => {
    let created = 0;
    const seq = new AyahSequencer(ayahs, () => { created++; return fakePlayer(); });
    await seq.seekToAyah(0);
    await seq.play();
    seq.activePlayer && (seq.activePlayer as ReturnType<typeof fakePlayer>).finish();
    await flush();
    await seq.next();
    await seq.prev();
    expect(created).toBe(1);
  });

  it('prefetches the ayah after the current one to disk while it plays', async () => {
    const prefetched: number[] = [];
    const seq = new AyahSequencer(ayahs, () => fakePlayer(), undefined, async a => { prefetched.push(a.ayah); });
    await seq.seekToAyah(0);
    expect(prefetched).toEqual([2]);
    await seq.next();
    expect(prefetched).toEqual([2, 3]);
    await seq.next();                      // last ayah: nothing after it
    expect(prefetched).toEqual([2, 3]);
  });

  it('loads from the local path when the cache has the ayah', async () => {
    const p = fakePlayer();
    const seq = new AyahSequencer(ayahs, () => p, a => (a.ayah === 2 ? 'file:///cache/002.mp3' : null));
    await seq.seekToAyah(0);
    await seq.next();
    expect(p.loaded.at(-1)).toBe('file:///cache/002.mp3');
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
    expect(p.playing).toBe(false);
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

  it('surfaces a failed boundary load as an error instead of stalling silently', async () => {
    let fail = false;
    const p = fakePlayer({
      async load(uri) {
        if (fail) throw new Error('network error');
        p.loaded.push(uri);
      },
    });
    const seq = new AyahSequencer(ayahs, () => p);
    const errors: string[] = [];
    const states: boolean[] = [];
    seq.on('error', e => errors.push(e));
    seq.on('state', s => states.push(s));

    await seq.seekToAyah(0);
    await seq.play();
    fail = true;
    p.finish();
    await flush();

    expect(errors).toEqual(['network error']);
    expect(states.at(-1)).toBe(false);
  });

  it('silences the player before loading another ayah', async () => {
    const p = fakePlayer();
    const seq = new AyahSequencer(ayahs, () => p);
    await seq.seekToAyah(0);
    await seq.play();
    const pauseOrder: number[] = [];
    const origPause = p.pause.bind(p);
    p.pause = () => { pauseOrder.push(p.loaded.length); origPause(); };

    await seq.seekToAyah(2);

    // Paused while the player still held only ayah 1 — before the new load.
    expect(pauseOrder[0]).toBe(1);
    expect(p.playing).toBe(true);
  });

  it('pause() silences the player and says so', async () => {
    const p = fakePlayer();
    const seq = new AyahSequencer(ayahs, () => p);
    const states: boolean[] = [];
    seq.on('state', s => states.push(s));

    await seq.seekToAyah(0);
    await seq.play();
    seq.pause();

    expect(p.playing).toBe(false);
    expect(states).toEqual([true, false]);
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

  it('does not reload an ayah the player already holds', async () => {
    const p = fakePlayer();
    const seq = new AyahSequencer(ayahs, () => p);
    await seq.seekToAyah(1);
    await seq.seekToAyah(1, 1500);          // e.g. a word tap inside the same ayah
    expect(p.loaded).toEqual([ayahs[1].audioUrl]);
  });
});

describe('AyahSequencer and transport commands from outside the app', () => {
  // Android's notification, lock screen and media keys act straight on the
  // native player. With one player it is always the audible one, so what
  // matters is that the sequencer adopts the command rather than fighting
  // or ignoring it.

  it('stops the recitation, and says so, when a pause lands on the player', async () => {
    const p = fakePlayer();
    const seq = new AyahSequencer(ayahs, () => p);
    const states: boolean[] = [];

    await seq.seekToAyah(0);
    await seq.play();
    await flush();
    seq.on('state', s => states.push(s));

    p.transportChanged(false);
    await flush();

    expect(p.playing).toBe(false);
    // Reported, not just done: nothing else tells the app's own bar and
    // word highlight that the recitation has stopped.
    expect(states).toEqual([false]);
  });

  it('resumes the live ayah when a play lands on the player while paused', async () => {
    const p = fakePlayer();
    const seq = new AyahSequencer(ayahs, () => p);
    const states: boolean[] = [];

    await seq.seekToAyah(1);
    await seq.play();
    await flush();
    seq.pause();
    seq.on('state', s => states.push(s));

    p.transportChanged(true);
    await flush();

    expect(p.playing).toBe(true);
    expect(seq.currentIndex).toBe(1);
    expect(states).toEqual([true]);
  });

  it('does not mistake its own pauses for an outside command', async () => {
    const p = fakePlayer();
    const seq = new AyahSequencer(ayahs, () => p);

    await seq.seekToAyah(0);
    await seq.play();
    await flush();
    const states: boolean[] = [];
    seq.on('state', s => states.push(s));

    // A seek pauses on its way to the new ayah, and a boundary crossing
    // pauses the player that just finished before reloading it. Every one
    // of those is an honest "this player stopped" report; reading any of
    // them as a pause from the lock screen would stop the recitation.
    await seq.seekToAyah(1);
    await flush();
    p.finish();
    await flush();

    expect(states).not.toContain(false);
    expect(p.playing).toBe(true);
  });

  it('still recognises a play pressed after the surah has ended', async () => {
    const p = fakePlayer();
    const seq = new AyahSequencer(ayahs, () => p);
    const states: boolean[] = [];

    await seq.seekToAyah(ayahs.length - 1);
    await seq.play();
    await flush();
    p.finish();                  // the final ayah runs out; 'ended' fires
    await flush();
    seq.on('state', s => states.push(s));

    // The end of the surah stops the player without anyone pausing it. If
    // that left the sequencer believing it was meant to be playing, this
    // press would look like its own doing and be ignored.
    p.transportChanged(true);
    await flush();

    expect(states).toContain(true);
  });
});

describe('AyahSequencer switchTo (one sequencer across surahs)', () => {
  const surahB: AyahTiming[] = [1, 2].map(n => ({
    ayah: n,
    audioUrl: `/audio/abdulbasit-murattal/00200${n}.mp3`,
    startOffsetMs: (n - 1) * 5000,
    durationMs: 5000,
    words: [],
  }));

  it('moves the same player onto the new surah and plays its first ayah', async () => {
    let created = 0;
    const p = fakePlayer();
    const seq = new AyahSequencer(ayahs, () => { created++; return p; });
    const changes: number[] = [];
    seq.on('ayahchange', n => changes.push(n));
    await seq.seekToAyah(1);
    await seq.play();

    await seq.switchTo(surahB, 0);

    expect(created).toBe(1);
    expect(p.loaded.at(-1)).toBe(surahB[0].audioUrl);
    expect(p.playing).toBe(true);
    expect(changes).toEqual([1, 0]);
  });

  it('drops the old surah finishing mid-switch instead of ending or advancing', async () => {
    const gate: { release: (() => void) | null } = { release: null };
    const p = fakePlayer({
      async load(uri) {
        p.loaded.push(uri);
        if (uri.includes('002001')) await new Promise<void>(r => { gate.release = r; });
      },
    });
    const seq = new AyahSequencer(ayahs, () => p);
    let ended = 0;
    const changes: number[] = [];
    seq.on('ended', () => { ended++; });
    seq.on('ayahchange', n => changes.push(n));
    await seq.seekToAyah(2);           // last ayah of surah A
    await seq.play();

    const switching = seq.switchTo(surahB, 0);
    await flush();
    p.finish();                        // surah A's last ayah "ends" during the switch
    gate.release?.();
    await switching;

    expect(ended).toBe(0);
    expect(changes).toEqual([2, 0]);
    expect(p.playing).toBe(true);
  });

  it('prefetches from the new surah after a switch', async () => {
    const prefetched: string[] = [];
    const seq = new AyahSequencer(ayahs, () => fakePlayer(), undefined, async a => { prefetched.push(a.audioUrl); });
    await seq.seekToAyah(0);
    await seq.switchTo(surahB, 0);
    expect(prefetched.at(-1)).toBe(surahB[1].audioUrl);
  });

  it('leaves the old surah in place if the new first ayah fails to load', async () => {
    const p = fakePlayer({
      async load(uri) {
        if (uri.includes('002001')) throw new Error('offline');
        p.loaded.push(uri);
      },
    });
    const seq = new AyahSequencer(ayahs, () => p);
    const errors: string[] = [];
    seq.on('error', e => errors.push(e));
    await seq.seekToAyah(1);
    await seq.play();

    await expect(seq.switchTo(surahB, 0)).rejects.toThrow('offline');

    // Rolled back to the old surah: a later play() reloads ayah 2 of A.
    expect(seq.currentIndex).toBe(1);
    expect(errors).toEqual([]);
    expect(p.playing).toBe(false);
    await seq.play();
    expect(p.loaded.at(-1)).toBe(ayahs[1].audioUrl);
    expect(p.playing).toBe(true);
  });

  it('off() removes a listener', async () => {
    const seq = new AyahSequencer(ayahs, () => fakePlayer());
    const changes: number[] = [];
    const cb = (n: number) => changes.push(n);
    seq.on('ayahchange', cb);
    seq.off('ayahchange', cb);
    await seq.seekToAyah(1);
    expect(changes).toEqual([]);
  });
});
