import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AyahPlaylist } from '../playlist';
import type { AyahTiming } from '@/lib/data/types';

const ayahs: AyahTiming[] = [
  { ayah: 1, audioUrl: '/audio/x/1.mp3', startOffsetMs: 0, durationMs: 4000, words: [] },
  { ayah: 2, audioUrl: '/audio/x/2.mp3', startOffsetMs: 4000, durationMs: 5000, words: [] },
  { ayah: 3, audioUrl: '/audio/x/3.mp3', startOffsetMs: 9000, durationMs: 4000, words: [] },
];

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

  it('reports global time from the current ayah offset', () => {
    const p = new AyahPlaylist(ayahs);
    p.seekToAyah(1, 500);
    expect(p.globalTimeMs()).toBe(4500);
    p.destroy();
  });

  it('seekGlobal lands on the right ayah', () => {
    const p = new AyahPlaylist(ayahs);
    const seen: number[] = [];
    p.on('ayahchange', i => seen.push(i));
    p.seekGlobal(9500);
    expect(p.currentAyahIndex).toBe(2);
    expect(seen).toContain(2);
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
});
