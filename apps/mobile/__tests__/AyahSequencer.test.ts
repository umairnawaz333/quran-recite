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
      onPlayingChanged() { return () => {}; },
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

describe('AyahSequencer next() reuses the preloaded slot', () => {
  it('swaps onto the preloaded ayah instead of downloading it again', async () => {
    const players = [fakePlayer(), fakePlayer()];
    let i = 0;
    const seq = new AyahSequencer(ayahs, () => players[i++ % 2]);

    await seq.seekToAyah(0);
    await seq.play();
    // preloadNext is fire-and-forget; let its load() settle.
    await new Promise(r => setTimeout(r, 0));
    expect(players[1].loaded).toEqual([ayahs[1].audioUrl]);

    await seq.next();

    // Stated independently of the code under test: the requested ayah must
    // not be downloaded a second time — slot 1's history stays exactly the
    // one preload — and the only new load anywhere is the *following* ayah
    // being preloaded into the slot that just went idle. Sound moves slots.
    expect(players[1].loaded).toEqual([ayahs[1].audioUrl]);
    expect(players[0].loaded).toEqual([ayahs[0].audioUrl, ayahs[2].audioUrl]);
    expect(players[1].playing).toBe(true);
    expect(players[0].playing).toBe(false);
  });

  it('still advances at the boundary after a swap-based next()', async () => {
    const players = [fakePlayer(), fakePlayer()];
    let i = 0;
    const seq = new AyahSequencer(ayahs, () => players[i++ % 2]);
    const changes: number[] = [];
    seq.on('ayahchange', n => changes.push(n));

    await seq.seekToAyah(0);
    await seq.play();
    await new Promise(r => setTimeout(r, 0));
    await seq.next();

    // The preload's finish subscription was armed under the OLD generation.
    // If next() reused the slot without re-arming it, this completion would
    // be dropped as stale and playback would stall on ayah 2 forever.
    players[1].finish();

    expect(changes).toEqual([0, 1, 2]);
  });
});

describe('AyahSequencer keeps exactly one slot sounding', () => {
  it('pauses the slot that finished before preloading into it', async () => {
    const players = [fakePlayer(), fakePlayer()];
    let i = 0;
    const seq = new AyahSequencer(ayahs, () => players[i++ % 2]);

    await seq.seekToAyah(0);
    await seq.play();
    await new Promise(r => setTimeout(r, 0));
    // The fake never clears `playing` on finish — like a platform player
    // whose play-when-ready stays armed past the end of a track.
    players[0].finish();
    await new Promise(r => setTimeout(r, 0));

    // Slot 1 now recites ayah 2; slot 0, which just finished and is the
    // preload target for ayah 3, must have been told to stop.
    expect(players[1].playing).toBe(true);
    expect(players[0].playing).toBe(false);
  });

  it('does not swap onto a slot whose preload is still in flight', async () => {
    const gate: { release: (() => void) | null } = { release: null };
    const slow = fakePlayer({
      async load(uri) {
        slow.loaded.push(uri);
        // Second load (the preload of ayah 3) hangs until released.
        if (slow.loaded.length === 2) await new Promise<void>(r => { gate.release = r; });
      },
    });
    const fast = fakePlayer();
    const players = [slow, fast];
    let i = 0;
    const seq = new AyahSequencer(ayahs, () => players[i++ % 2]);
    const changes: number[] = [];
    seq.on('ayahchange', n => changes.push(n));

    await seq.seekToAyah(0);          // slot 0 (slow) holds ayah 1
    await seq.play();
    await new Promise(r => setTimeout(r, 0));   // slot 1 (fast) preloads ayah 2
    await seq.next();                  // swap onto slot 1; slot 0 begins loading ayah 3 (hangs)

    // While that load is in flight, ask for ayah 1 again. slotReady[0] must
    // not still claim ayah 1: the source underneath has already been swapped
    // for ayah 3, so a swap here would recite ayah 3 while announcing ayah 1.
    const seekBack = seq.seekToAyah(0);
    await new Promise(r => setTimeout(r, 0));
    // A fresh load of ayah 1 must have been issued into the ACTIVE slot
    // (fast) rather than swapping onto slow's half-replaced source.
    expect(fast.loaded.at(-1)).toBe(ayahs[0].audioUrl);
    gate.release?.();
    await seekBack;
    expect(changes.at(-1)).toBe(0);
  });
  // Android binds its media session — the notification's buttons, the lock
  // screen, media keys — to ONE of the two native players, and its
  // commands reach that player without passing through this app. Half the
  // time that is not the player making sound, so what the sequencer does
  // with such a command decides whether those buttons work at all.

  it('silences a play that landed on the idle slot and keeps the live ayah going', async () => {
    const players = [fakePlayer(), fakePlayer()];
    let i = 0;
    const seq = new AyahSequencer(ayahs, () => players[i++ % 2]);

    await seq.seekToAyah(0);
    await seq.play();
    await flush();               // slot 1 finishes preloading ayah 2

    // The notification's play button, aimed at the idle slot, starts the
    // ayah *after* the live one. Left alone that is two recitations at
    // once — the thing the user actually hears go wrong.
    players[1].transportChanged(true);
    await flush();

    expect(players[1].playing).toBe(false);
    expect(players[0].playing).toBe(true);
  });

  it('stops the recitation, and says so, when a pause lands on the audible slot', async () => {
    const players = [fakePlayer(), fakePlayer()];
    let i = 0;
    const seq = new AyahSequencer(ayahs, () => players[i++ % 2]);
    const states: boolean[] = [];

    await seq.seekToAyah(0);
    await seq.play();
    await flush();
    seq.on('state', s => states.push(s));

    players[0].transportChanged(false);
    await flush();

    expect(players.map(p => p.playing)).toEqual([false, false]);
    // Reported, not just done: nothing else tells the app's own bar and
    // word highlight that the recitation has stopped.
    expect(states).toEqual([false]);
  });

  it('resumes the ayah that was live, not the one the idle slot holds', async () => {
    const players = [fakePlayer(), fakePlayer()];
    let i = 0;
    const seq = new AyahSequencer(ayahs, () => players[i++ % 2]);

    await seq.seekToAyah(0);
    await seq.play();
    await flush();
    seq.pause();

    // Play pressed while the binding sits on the idle slot: what must
    // resume is ayah 1 on the slot that was live, not ayah 2 on this one.
    players[1].transportChanged(true);
    await flush();

    expect(players[0].playing).toBe(true);
    expect(players[1].playing).toBe(false);
    expect(seq.currentIndex).toBe(0);
  });

  it('does not mistake its own pauses for an outside command', async () => {
    const players = [fakePlayer(), fakePlayer()];
    let i = 0;
    const seq = new AyahSequencer(ayahs, () => players[i++ % 2]);

    await seq.seekToAyah(0);
    await seq.play();
    await flush();
    const states: boolean[] = [];
    seq.on('state', s => states.push(s));

    // A seek pauses both slots on its way to the new ayah, and a boundary
    // crossing pauses the slot that just finished. Every one of those is
    // an honest "this player stopped" report; reading any of them as a
    // pause from the lock screen would stop the recitation mid-surah.
    await seq.seekToAyah(1);
    await flush();
    players[seq.currentIndex % 2 === 0 ? 0 : 1].finish();
    await flush();

    expect(states).not.toContain(false);
    expect(players.some(p => p.playing)).toBe(true);
  });

  it('still recognises a play pressed after the surah has ended', async () => {
    const players = [fakePlayer(), fakePlayer()];
    let i = 0;
    const seq = new AyahSequencer(ayahs, () => players[i++ % 2]);
    const states: boolean[] = [];

    await seq.seekToAyah(ayahs.length - 1);
    await seq.play();
    await flush();
    const last = players.find(p => p.playing)!;
    last.finish();               // the final ayah runs out; 'ended' fires
    await flush();
    seq.on('state', s => states.push(s));

    // The end of the surah stops a player without anyone pausing it. If
    // that left the sequencer believing the slot was meant to be playing,
    // this press would look like its own doing and be ignored.
    last.transportChanged(true);
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

  it('keeps the old surah audible while the new first ayah loads, then swaps slots', async () => {
    const players = [fakePlayer(), fakePlayer()];
    let i = 0;
    let releaseLoad: (() => void) | null = null;
    const gate: { release: (() => void) | null } = { release: null };
    players[1].load = async (uri) => {
      players[1].loaded.push(uri);
      // The second load into slot 1 is surah B's first ayah — hold it.
      if (uri.includes('002001')) await new Promise<void>(r => { gate.release = r; });
    };
    const seq = new AyahSequencer(ayahs, () => players[i++ % 2]);
    const changes: number[] = [];
    seq.on('ayahchange', n => changes.push(n));
    await seq.seekToAyah(0);
    await seq.play();
    await new Promise(r => setTimeout(r, 0));

    const switching = seq.switchTo(surahB, 0);
    await new Promise(r => setTimeout(r, 0));
    // Mid-switch: surah A still sounds on slot 0, nothing announced yet.
    expect(players[0].playing).toBe(true);
    expect(changes).toEqual([0]);

    gate.release?.();
    releaseLoad = null;
    await switching;

    // Swapped: slot 1 recites surah B's first ayah, slot 0 is silent, and
    // the SAME two players are in use — none created.
    expect(players[1].loaded.at(-1)).toBe(surahB[0].audioUrl);
    expect(players[1].playing).toBe(true);
    expect(players[0].playing).toBe(false);
    expect(i).toBe(2);
    expect(changes).toEqual([0, 0]);
  });

  it('drops the old surah finishing mid-switch instead of ending or advancing', async () => {
    const players = [fakePlayer(), fakePlayer()];
    let i = 0;
    const gate: { release: (() => void) | null } = { release: null };
    players[1].load = async (uri) => {
      players[1].loaded.push(uri);
      if (uri.includes('002001')) await new Promise<void>(r => { gate.release = r; });
    };
    const seq = new AyahSequencer(ayahs, () => players[i++ % 2]);
    let ended = 0;
    const changes: number[] = [];
    seq.on('ended', () => { ended++; });
    seq.on('ayahchange', n => changes.push(n));
    await seq.seekToAyah(2);           // last ayah of surah A
    await seq.play();

    const switching = seq.switchTo(surahB, 0);
    await new Promise(r => setTimeout(r, 0));
    players[0].finish();               // surah A's last ayah ends during the switch
    gate.release?.();
    await switching;

    expect(ended).toBe(0);
    expect(changes).toEqual([2, 0]);
    expect(players[1].playing).toBe(true);
  });

  it('preloads from the new surah after a switch', async () => {
    const players = [fakePlayer(), fakePlayer()];
    let i = 0;
    const seq = new AyahSequencer(ayahs, () => players[i++ % 2]);
    await seq.seekToAyah(0);
    await seq.switchTo(surahB, 0);
    await new Promise(r => setTimeout(r, 0));
    // Slot 0 (now idle) holds surah B's SECOND ayah, not anything of surah A.
    expect(players[0].loaded.at(-1)).toBe(surahB[1].audioUrl);
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
