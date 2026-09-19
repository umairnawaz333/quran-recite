import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `vi.mock` factories are hoisted above every import in this file. This test
 * drives `engine` directly — no `PlayerProvider`, no React tree — so it does
 * not need the `react-native-svg` mock `PlayerProvider.test.tsx` also
 * registers; everything else mirrors that file's mocks exactly (see its
 * lines 11-28).
 */
vi.mock('react-native', async () => await import('./helpers/reactNativeMock'));
vi.mock('expo-file-system', async () => {
  const fs = await import('./helpers/fakeFileSystem');
  return fs.fakeFileSystemModule;
});
vi.mock('expo-audio', async () => {
  const fake = await import('./helpers/fakeAudio');
  return { setAudioModeAsync: fake.setAudioModeAsync, createAudioPlayer: fake.createAudioPlayer };
});
vi.mock('../src/audio/expoPlayer', async () => {
  const fake = await import('./helpers/fakeAudio');
  return { createExpoPlayer: fake.createExpoPlayer };
});
vi.mock('../src/audio/nowPlaying', async () => {
  const fake = await import('./helpers/fakeAudio');
  return { setNowPlaying: fake.setNowPlaying, isNowPlaying: fake.isNowPlaying };
});

import { engine } from '../src/player/PlaybackEngine';
import { resetPlayerEnvironment } from './helpers/renderPlayer';
import { provideTimings, failTimings } from './helpers/fakeTimings';
import { audio } from './helpers/fakeAudio';
import { saveLastPosition } from './helpers/fakeFileSystem';

const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

beforeEach(() => {
  resetPlayerEnvironment();
  provideTimings(1, 7);
  provideTimings(2, 5);
  // Registered so "nextSurah plays the following surah from ayah 1" (which
  // advances 2 -> 3) has somewhere to land; the brief's beforeEach omitted
  // it, and `loadTimings` for an unregistered surah rejects rather than
  // falling through to a default.
  provideTimings(3, 4);
  provideTimings(113, 5);
  provideTimings(114, 6);
});

describe('PlaybackEngine — surah skipping for the car', () => {
  it('nextSurah plays the following surah from ayah 1', async () => {
    await engine.play(2, 3); await settle();
    await engine.nextSurah(); await settle();
    expect(engine.getState()).toMatchObject({ surahId: 3, ayah: 1 });
  });
  it('prevSurah plays the preceding surah from ayah 1, and is a no-op at surah 1', async () => {
    await engine.play(2); await settle();
    await engine.prevSurah(); await settle();
    expect(engine.getState().surahId).toBe(1);
    await engine.prevSurah(); await settle();
    expect(engine.getState().surahId).toBe(1);
  });
  it('nextSurah at 114 does nothing', async () => {
    await engine.play(114); await settle();
    await engine.nextSurah(); await settle();
    expect(engine.getState().surahId).toBe(114);
  });
});

describe('PlaybackEngine — resume', () => {
  it('plays the bookmark when nothing is live', async () => {
    saveLastPosition({ surahId: 2, ayah: 4, localMs: 0 });
    engine.start(); await settle();
    await engine.resume(); await settle();
    expect(engine.getState()).toMatchObject({ surahId: 2, ayah: 4, isPlaying: true });
  });
  it('is play() when something is live', async () => {
    await engine.play(1); await settle();
    engine.toggle(); await settle();
    expect(engine.getState().isPlaying).toBe(false);
    await engine.resume(); await settle();
    expect(engine.getState().isPlaying).toBe(true);
  });
});

describe('PlaybackEngine — surah-level seek', () => {
  it('maps a surah position onto (ayah, localMs) by startOffsetMs', async () => {
    await engine.play(1); await settle();
    const t = engine.currentTimings()!;
    const target = t.ayahs[3].startOffsetMs + 250;
    await engine.seekToSurahPosition(target); await settle();
    expect(engine.getState().ayah).toBe(t.ayahs[3].ayah);
    expect(engine.localTimeMs()).toBe(250);
  });
  it('is ignored when nothing is live', async () => {
    await engine.seekToSurahPosition(5000); await settle();
    expect(engine.getState().surahId).toBe(1);   // still the offer, untouched
    expect(audio.players).toHaveLength(0);
  });
});

describe('PlaybackEngine — errorKind (spec §7)', () => {
  it('is \'load\' after a surah fails to start, and clears to null on the next successful play', async () => {
    failTimings(2);
    await engine.play(2); await settle();
    expect(engine.getState().errorKind).toBe('load');
    await engine.play(1); await settle();
    expect(engine.getState().errorKind).toBeNull();
  });
});

describe('PlaybackEngine — snapshots', () => {
  it('returns the same state object until something changes', async () => {
    const a = engine.getState(); const b = engine.getState();
    expect(b).toBe(a);
    await engine.play(1); await settle();
    expect(engine.getState()).not.toBe(a);
  });
});
