import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => await import('./helpers/reactNativeMock'));
vi.mock('expo-file-system', async () => (await import('./helpers/fakeFileSystem')).fakeFileSystemModule);
vi.mock('expo-audio', async () => { const f = await import('./helpers/fakeAudio'); return { setAudioModeAsync: f.setAudioModeAsync, createAudioPlayer: f.createAudioPlayer }; });
vi.mock('../src/audio/expoPlayer', async () => { const f = await import('./helpers/fakeAudio'); return { createExpoPlayer: f.createExpoPlayer }; });
vi.mock('../src/audio/nowPlaying', async () => { const f = await import('./helpers/fakeAudio'); return { setNowPlaying: f.setNowPlaying, isNowPlaying: f.isNowPlaying }; });
vi.mock('expo-modules-core', async () => (await import('./helpers/fakeCarMedia')).fakeExpoModulesCore);

import { engine } from '../src/player/PlaybackEngine';
import { registerCarEngine } from '../src/car/carEngine';
import { resetPlayerEnvironment } from './helpers/renderPlayer';
import { provideTimings, failTimings } from './helpers/fakeTimings';
import { calls, emitCommand, resetCarMedia } from './helpers/fakeCarMedia';
import { audio } from './helpers/fakeAudio';

const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
let unregister: () => void;
beforeEach(() => { resetPlayerEnvironment(); resetCarMedia(); provideTimings(1, 7); provideTimings(2, 5); provideTimings(3, 4); unregister = registerCarEngine(); });
// `registerCarEngine`'s "registered once" latch is module-scope, so without
// tearing it down between tests it stays latched onto the *previous* test's
// (already-reset) engine subscription and command listener — every test
// after the first would silently stop receiving commands or publishing
// state. Undoing it here is what gives each test its own registration,
// exactly as production gets its own single one for the app's lifetime.
afterEach(() => { unregister(); });

describe('carEngine — commands drive the engine', () => {
  it('playSurah plays that surah from ayah 1', async () => {
    emitCommand('playSurah', 2); await settle();
    expect(engine.getState()).toMatchObject({ surahId: 2, ayah: 1, isPlaying: true });
  });
  it('nextSurah/prevSurah change surah; nextAyah/prevAyah change ayah', async () => {
    emitCommand('playSurah', 2); await settle();
    emitCommand('nextSurah'); await settle(); expect(engine.getState().surahId).toBe(3);
    emitCommand('nextAyah'); await settle(); expect(engine.getState()).toMatchObject({ surahId: 3, ayah: 2 });
    emitCommand('prevAyah'); await settle(); expect(engine.getState()).toMatchObject({ surahId: 3, ayah: 1 });
    emitCommand('prevSurah'); await settle(); expect(engine.getState().surahId).toBe(2);
  });
  it('resume plays the offer when nothing is live', async () => {
    emitCommand('resume'); await settle();
    expect(engine.getState()).toMatchObject({ surahId: 1, isPlaying: true });
  });
  it('seekTo maps a surah position to an ayah', async () => {
    emitCommand('playSurah', 1); await settle();
    const t = engine.currentTimings()!;
    emitCommand('seekTo', t.ayahs[4].startOffsetMs + 100); await settle();
    expect(engine.getState().ayah).toBe(t.ayahs[4].ayah);
  });
});

describe('carEngine — what it tells the car', () => {
  it('announces the engine once, on registration', () => { expect(calls.engineReady).toBe(1); });
  it('publishes the surah-level position offset and duration on every ayah', async () => {
    emitCommand('playSurah', 1); await settle();
    const t = engine.currentTimings()!;
    expect(calls.position.at(-1)).toEqual({ offsetMs: t.ayahs[0].startOffsetMs, durationMs: t.surahDurationMs });
    emitCommand('nextAyah'); await settle();
    expect(calls.position.at(-1)).toEqual({ offsetMs: t.ayahs[1].startOffsetMs, durationMs: t.surahDurationMs });
  });
  it('reports a surah that cannot be loaded with the spec\'s connection message', async () => {
    failTimings(3);
    emitCommand('playSurah', 3); await settle();
    expect(calls.errors).toEqual(['No connection — download this surah on your phone']);
  });
  it('reports a mid-surah playback failure with the engine\'s own text, not the connection copy', async () => {
    emitCommand('playSurah', 1); await settle();
    const t = engine.currentTimings()!;
    // A later ayah's file cannot load — the sequencer's own `onError`, not a
    // surah-start failure (spec §7's "Audio load failure mid-surah" row).
    audio.failLoadsMatching = /001003\.mp3/;
    emitCommand('seekTo', t.ayahs[2].startOffsetMs); await settle();
    expect(engine.getState().errorKind).toBe('playback');
    expect(calls.errors).toEqual([engine.getState().error]);
    expect(calls.errors[0]).not.toBe('No connection — download this surah on your phone');
  });
  it('registers once: a second call is a no-op and the first unregister undoes it', async () => {
    const again = registerCarEngine(); expect(calls.engineReady).toBe(1);
    again(); unregister();
    emitCommand('playSurah', 2); await settle();
    expect(engine.getState().surahId).toBe(1);
  });
});
