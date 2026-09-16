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

    // It must not advance to 1 — the live position is 2.
    expect(changes.at(-1)).toBe(2);
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
});
