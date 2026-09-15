import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AyahPlaylist } from '../playlist';
import type { AyahTiming } from '@quran/core';

const ayahs: AyahTiming[] = [
  { ayah: 1, audioUrl: '/audio/x/1.mp3', startOffsetMs: 0, durationMs: 4000, words: [] },
  { ayah: 2, audioUrl: '/audio/x/2.mp3', startOffsetMs: 4000, durationMs: 5000, words: [] },
  { ayah: 3, audioUrl: '/audio/x/3.mp3', startOffsetMs: 9000, durationMs: 4000, words: [] },
];

// Flushes the microtask queue so a play() promise's .catch handler (and any
// synchronous retry it issues) has had a chance to run before assertions.
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

const domError = (name: string): DOMException => new DOMException(name, name);

beforeEach(() => {
  // jsdom does not implement media playback.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

describe('AyahPlaylist', () => {
  it('starts on the first ayah', () => {
    const p = new AyahPlaylist(ayahs);
    expect(p.currentAyahIndex).toBe(0);
    p.destroy();
  });

  it('advances to the next ayah when one ends', () => {
    const p = new AyahPlaylist(ayahs);
    const seen: number[] = [];
    p.on('ayahchange', i => seen.push(i));
    p.play();
    p.handleEndedForTest();
    expect(p.currentAyahIndex).toBe(1);
    expect(seen).toContain(1);
    p.destroy();
  });

  it('emits ended and stops after the final ayah', () => {
    const p = new AyahPlaylist(ayahs);
    const ended = vi.fn();
    p.on('ended', ended);
    p.seekToAyah(2, 0);
    p.play();
    p.handleEndedForTest();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(p.isPlaying).toBe(false);
    p.destroy();
  });

  it('prev and next clamp at the boundaries', () => {
    const p = new AyahPlaylist(ayahs);
    p.prev();
    expect(p.currentAyahIndex).toBe(0);
    p.seekToAyah(2, 0);
    p.next();
    expect(p.currentAyahIndex).toBe(2);
    p.destroy();
  });

  it('emits state changes on play and pause', () => {
    const p = new AyahPlaylist(ayahs);
    const seen: boolean[] = [];
    p.on('state', playing => seen.push(playing));
    p.play();
    p.pause();
    expect(seen).toEqual([true, false]);
    p.destroy();
  });

  it('a rejected play() results in isPlaying === false and an emitted error, not a stuck true', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValueOnce(domError('NotAllowedError'));
    const p = new AyahPlaylist(ayahs);
    const errors: number[] = [];
    p.on('error', i => errors.push(i));

    p.play();
    expect(p.isPlaying).toBe(true); // optimistic until the promise settles

    await flush();

    expect(p.isPlaying).toBe(false);
    expect(errors).toEqual([0]);
    p.destroy();
  });

  it('a rejected boundary transition does not leave the playlist claiming to play', async () => {
    const p = new AyahPlaylist(ayahs);
    const errors: number[] = [];
    p.on('error', i => errors.push(i));

    p.play();
    await flush();
    expect(p.isPlaying).toBe(true);

    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValueOnce(domError('NotAllowedError'));
    p.handleEndedForTest();
    expect(p.currentAyahIndex).toBe(1);

    await flush();

    expect(p.isPlaying).toBe(false);
    expect(errors).toEqual([1]);
    p.destroy();
  });

  it('retries once and recovers when play() is aborted by a concurrent load()', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValueOnce(domError('AbortError'));
    const p = new AyahPlaylist(ayahs);
    const errors: number[] = [];
    const seen: boolean[] = [];
    p.on('error', i => errors.push(i));
    p.on('state', s => seen.push(s));

    p.play();
    await flush();

    expect(errors).toEqual([]);
    expect(p.isPlaying).toBe(true);
    expect(seen).toEqual([true]);
    p.destroy();
  });

  it('after final-ayah ended, currentAyahIndex resets to 0', () => {
    const p = new AyahPlaylist(ayahs);
    p.seekToAyah(2, 0);
    p.play();
    p.handleEndedForTest();
    expect(p.currentAyahIndex).toBe(0);
    p.destroy();
  });

  it('setVolume applies to both the active and the idle/preloading element', () => {
    const p = new AyahPlaylist(ayahs);
    p.setVolume(0.3);
    expect(p.current.volume).toBeCloseTo(0.3);
    expect(p.idleForTest.volume).toBeCloseTo(0.3);
    p.destroy();
  });

  it('an error on the preloading element does not emit an error for the currently playing ayah', () => {
    const p = new AyahPlaylist(ayahs);
    const errors: number[] = [];
    p.on('error', i => errors.push(i));

    // ayah 0 is active and playing fine; ayah 1 is preloading into the idle
    // element and fails (e.g. bad network). That must not be blamed on the
    // ayah currently playing, nor surfaced as a playback error at all.
    p.idleForTest.dispatchEvent(new Event('error'));

    expect(errors).toEqual([]);
    expect(p.currentAyahIndex).toBe(0);
    p.destroy();
  });

  it('an error on the active element reports the ayah that is actually failing', () => {
    const p = new AyahPlaylist(ayahs);
    const errors: number[] = [];
    p.on('error', i => errors.push(i));

    p.current.dispatchEvent(new Event('error'));

    expect(errors).toEqual([0]);
    p.destroy();
  });

  it('calling play() after ended starts from the surah beginning, not the last ayah\'s tail', () => {
    const p = new AyahPlaylist(ayahs);
    p.seekToAyah(2, 0);
    p.play();
    p.handleEndedForTest();

    p.play();

    expect(p.currentAyahIndex).toBe(0);
    expect(p.current.getAttribute('src')).toBe(ayahs[0].audioUrl);
    p.destroy();
  });
});
