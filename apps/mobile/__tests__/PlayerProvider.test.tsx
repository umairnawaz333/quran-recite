import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `vi.mock` factories are hoisted above every import in this file, so the
 * provider and everything it pulls in (the sequencer, the ayah cache, the
 * lock-screen wiring) see these stand-ins instead of the native modules,
 * which cannot even be imported under vitest's `node` environment. Each
 * factory defers to a helper module so the fakes stay inspectable from the
 * tests: the factory and the test import the same module instance.
 */
vi.mock('react-native', async () => await import('./helpers/reactNativeMock'));
vi.mock('react-native-svg', async () => await import('./helpers/reactNativeSvgMock'));
vi.mock('expo-file-system', async () => {
  const fs = await import('./helpers/fakeFileSystem');
  return { File: fs.FakeFile, Directory: fs.FakeDirectory, Paths: fs.Paths };
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

import { act } from 'react-test-renderer';
import {
  audio, lockScreenPlayer, releaseHeldLoads, setAudioModeAsync, setNowPlaying,
} from './helpers/fakeAudio';
import { holdLastPosition, releaseLastPosition, saveLastPosition } from './helpers/fakeFileSystem';
import {
  failTimings, holdTimings, provideTimings, releaseTimings, timingsReads,
} from './helpers/fakeTimings';
import { frames, runFrames } from './helpers/frames';
import { appStateListenerCount, emitAppState } from './helpers/reactNativeMock';
import {
  actFlush, flush, mountPlayer, playFully, resetPlayerEnvironment, startPlay,
} from './helpers/renderPlayer';
import { activeWordStore } from '../src/reader/activeWordStore';

/** The player that is actually making sound right now. */
function sounding() {
  const playing = audio.players.filter(p => p.playing);
  if (playing.length !== 1) {
    throw new Error(`expected exactly one sounding player, found ${playing.length}`);
  }
  return playing[0];
}

beforeEach(() => {
  resetPlayerEnvironment();
});

describe('PlayerProvider — what the bar is offering', () => {
  it('offers Al-Fatihah 1:1, paused, with nothing pending on a first launch', async () => {
    provideTimings(1, 3);

    const player = mountPlayer();
    await flush();

    expect(player.current.surahId).toBe(1);
    expect(player.current.surahName).toBe('Al-Fatihah');
    expect(player.current.ayah).toBe(1);
    expect(player.current.isPlaying).toBe(false);
    expect(player.current.isLoading).toBe(false);
    expect(player.current.error).toBeNull();
    expect(player.current.pendingSurahId).toBeNull();
    // Offering a surah is not building one: nothing native exists yet.
    expect(audio.players).toHaveLength(0);
  });

  it('offers the saved position instead, once the bookmark has been read', async () => {
    saveLastPosition({ surahId: 3, ayah: 12 });

    const player = mountPlayer();
    await flush();

    expect(player.current.surahId).toBe(3);
    expect(player.current.surahName).toBe("Ali 'Imran");
    expect(player.current.ayah).toBe(12);
    expect(player.current.isPlaying).toBe(false);
    expect(player.current.pendingSurahId).toBeNull();
  });

  it('never yanks the bar back to the bookmark when play() was pressed first', async () => {
    // The bookmark is on disk, but the read is slow.
    holdLastPosition({ surahId: 3, ayah: 12 });
    provideTimings(1, 3);

    const player = mountPlayer();
    const started = startPlay(player, 1);
    await actFlush(async () => { await started; });
    expect(player.current.surahId).toBe(1);
    expect(player.current.isPlaying).toBe(true);

    // Yesterday's position finally arrives, with surah 1 already reciting.
    await actFlush(() => { releaseLastPosition(); });

    expect(player.current.surahId).toBe(1);
    expect(player.current.ayah).toBe(1);
    expect(player.current.isPlaying).toBe(true);
    // Not even for one render may the bar have shown yesterday's position.
    expect(player.renders.map(r => r.surahId)).not.toContain(3);
    expect(player.renders.map(r => r.ayah)).not.toContain(12);
  });
});

describe('PlayerProvider — starting playback', () => {
  it('reports the load against the surah asked for, then plays it', async () => {
    holdTimings(1, 3);

    const player = mountPlayer();
    const started = startPlay(player, 1);

    // Immediately, before anything has loaded.
    expect(player.current.isLoading).toBe(true);
    expect(player.current.pendingSurahId).toBe(1);
    expect(player.current.surahId).toBe(1);
    expect(player.current.isPlaying).toBe(false);

    await flush();
    await actFlush(async () => {
      releaseTimings(1);
      await started;
    });

    expect(player.current.surahId).toBe(1);
    expect(player.current.surahName).toBe('Al-Fatihah');
    expect(player.current.ayah).toBe(1);
    expect(player.current.isPlaying).toBe(true);
    expect(player.current.isLoading).toBe(false);
    expect(player.current.error).toBeNull();
    expect(player.current.pendingSurahId).toBeNull();
    expect(sounding().playing).toBe(true);
  });

  it('registers the audible player for the lock screen, with this surah on it', async () => {
    provideTimings(1, 3);

    const player = mountPlayer();
    await playFully(player, 1);

    // Without this registration Android kills background playback after
    // about three minutes (see nowPlaying.ts) — it is a correctness
    // requirement, so its absence has to fail a test.
    expect(setNowPlaying).toHaveBeenCalled();
    const bound = lockScreenPlayer();
    expect(bound).not.toBeNull();
    expect(bound?.id).toBe(sounding().nativePlayer.id);
    expect(bound?.setActiveForLockScreen).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ title: 'Al-Fatihah' }),
    );
    // `interruptionMode: 'doNotMix'` is what makes that binding take.
    expect(setAudioModeAsync).toHaveBeenCalledWith(
      expect.objectContaining({ shouldPlayInBackground: true, interruptionMode: 'doNotMix' }),
    );
  });

  it('re-binds the media session to the audible player on return to the foreground', async () => {
    provideTimings(1, 3);

    const player = mountPlayer();
    await playFully(player, 1);

    setNowPlaying.mockClear();
    emitAppState('background');
    expect(setNowPlaying).not.toHaveBeenCalled();
    emitAppState('active');

    expect(setNowPlaying).toHaveBeenCalled();
    // Subscribed once for the provider's lifetime, not once per ayah.
    expect(appStateListenerCount()).toBe(1);
  });
});

describe('PlayerProvider — switching surahs', () => {
  it('keeps the old surah live and audible until the new one has loaded its first ayah', async () => {
    provideTimings(1, 3);
    provideTimings(2, 3);

    const player = mountPlayer();
    await playFully(player, 1);
    const surahAPlayers = [...audio.players];
    expect(surahAPlayers.length).toBeGreaterThan(0);

    // Park surah 2's audio loads: the window this test is about.
    audio.holdLoadsMatching = /audio-002/;
    const started = startPlay(player, 2);
    await flush();

    expect(player.current.surahId).toBe(1);
    expect(player.current.surahName).toBe('Al-Fatihah');
    expect(player.current.isPlaying).toBe(true);
    expect(player.current.isLoading).toBe(true);
    expect(player.current.pendingSurahId).toBe(2);
    // One native player: surah 1's sound stops as surah 2's load begins,
    // but the player is neither released nor replaced.
    expect(surahAPlayers.some(p => p.released)).toBe(false);
    expect(audio.players.length).toBe(surahAPlayers.length);

    await actFlush(async () => {
      releaseHeldLoads();
      await started;
    });

    expect(player.current.surahId).toBe(2);
    expect(player.current.surahName).toBe('Al-Baqarah');
    expect(player.current.ayah).toBe(1);
    expect(player.current.isPlaying).toBe(true);
    expect(player.current.isLoading).toBe(false);
    expect(player.current.pendingSurahId).toBeNull();
    // The SAME two native players carry on into surah 2 — none released,
    // none created. This is what keeps the lock-screen binding alive across
    // a surah boundary in the background: Android binds its media session
    // to one native player and refuses to re-bind while backgrounded.
    expect(audio.players.length).toBe(surahAPlayers.length);
    expect(surahAPlayers.every(p => !p.released)).toBe(true);
    // Exactly one of them sounds now, and it holds surah 2's first ayah.
    const sounding = surahAPlayers.filter(p => p.playing);
    expect(sounding).toHaveLength(1);
    expect(sounding[0].loaded.at(-1)).toMatch(/audio-002/);

    // One atomic patch: surah 2 never appeared half-switched — never paused,
    // never still pending — in any render the screens could have seen.
    const surahBRenders = player.renders.filter(r => r.surahId === 2);
    expect(surahBRenders.length).toBeGreaterThan(0);
    expect(surahBRenders.every(r => r.isPlaying && r.pendingSurahId === null && !r.isLoading)).toBe(true);
  });

  it('attributes a failed timings load to the surah that failed, leaving the live one playing', async () => {
    provideTimings(1, 3);
    failTimings(2);

    const player = mountPlayer();
    await playFully(player, 1);
    const surahAPlayers = [...audio.players];

    await actFlush(() => player.current.play(2));

    expect(player.current.error).toMatch(/could not load/i);
    expect(player.current.pendingSurahId).toBe(2);
    expect(player.current.surahId).toBe(1);
    expect(player.current.surahName).toBe('Al-Fatihah');
    expect(player.current.isPlaying).toBe(true);
    expect(player.current.isLoading).toBe(false);
    expect(surahAPlayers.some(p => p.playing)).toBe(true);
    expect(surahAPlayers.some(p => p.released)).toBe(false);
    // A surah whose timings never arrived cannot have built any players.
    expect(audio.players).toHaveLength(surahAPlayers.length);
  });

  it('attributes a failed first-ayah load to the surah that failed, and reports the live one paused', async () => {
    provideTimings(1, 3);
    provideTimings(2, 3);

    const player = mountPlayer();
    await playFully(player, 1);
    const surahAPlayers = [...audio.players];
    expect(sounding()).toBeDefined();

    audio.failLoadsMatching = /audio-002/;
    await actFlush(() => player.current.play(2));

    expect(player.current.error).toMatch(/could not load/i);
    expect(player.current.pendingSurahId).toBe(2);
    // Surah 1 keeps its name in the bar, but with one native player its
    // sound stopped when surah 2's load began — so it is reported paused,
    // not left claiming to play over silence.
    expect(player.current.surahId).toBe(1);
    expect(player.current.isPlaying).toBe(false);
    expect(player.current.isLoading).toBe(false);
    expect(surahAPlayers.every(p => !p.released)).toBe(true);
    expect(audio.players.some(p => p.playing)).toBe(false);
  });

  it('seeks within the live surah instead of rebuilding it, clearing stale transient state', async () => {
    provideTimings(1, 3);
    failTimings(2);

    const player = mountPlayer();
    await playFully(player, 1);
    // Leaves an error and a pendingSurahId belonging to surah 2 behind.
    await actFlush(() => player.current.play(2));
    expect(player.current.error).not.toBeNull();
    const playersBefore = audio.players.length;

    await actFlush(() => player.current.play(1, 3));

    expect(player.current.surahId).toBe(1);
    expect(player.current.ayah).toBe(3);
    expect(player.current.isPlaying).toBe(true);
    expect(player.current.error).toBeNull();
    expect(player.current.isLoading).toBe(false);
    expect(player.current.pendingSurahId).toBeNull();
    // No native player was created: a seek, not a teardown and rebuild.
    expect(audio.players).toHaveLength(playersBefore);
    expect(audio.players.every(p => !p.released)).toBe(true);
  });

  it('lets the newest request win when an older surah resolves late', async () => {
    holdTimings(2, 3);
    holdTimings(3, 3);

    const player = mountPlayer();
    await flush();
    const surahB = startPlay(player, 2);
    await flush();
    const surahC = startPlay(player, 3);
    await flush();

    await actFlush(async () => {
      releaseTimings(3);
      await surahC;
    });
    expect(player.current.surahId).toBe(3);
    expect(player.current.isPlaying).toBe(true);

    // Surah 2's timings finally arrive, long after the user moved on.
    await actFlush(async () => {
      releaseTimings(2);
      await surahB;
    });

    expect(player.current.surahId).toBe(3);
    expect(player.current.surahName).toBe("Ali 'Imran");
    expect(player.current.isPlaying).toBe(true);
    expect(player.current.pendingSurahId).toBeNull();
    expect(player.current.error).toBeNull();
    // Not one byte of surah 2 was ever loaded into a player.
    const loaded = audio.players.flatMap(p => p.loaded);
    expect(loaded.some(uri => uri.includes('audio-003'))).toBe(true);
    expect(loaded.some(uri => uri.includes('audio-002'))).toBe(false);
  });
});

describe('PlayerProvider — running on past the end of a surah', () => {
  it('continues into the next surah when "next" is pressed on the last ayah', async () => {
    provideTimings(1, 3);
    provideTimings(2, 4);

    const player = mountPlayer();
    await playFully(player, 1, 3);
    expect(player.current.ayah).toBe(3);

    await actFlush(() => player.current.next());

    expect(player.current.surahId).toBe(2);
    expect(player.current.surahName).toBe('Al-Baqarah');
    expect(player.current.ayah).toBe(1);
    expect(player.current.isPlaying).toBe(true);
  });

  it('continues into the next surah when the last ayah plays out on its own', async () => {
    provideTimings(1, 3);
    provideTimings(2, 4);

    const player = mountPlayer();
    await playFully(player, 1, 3);
    const last = sounding();

    await actFlush(() => { last.finish(); });

    expect(player.current.surahId).toBe(2);
    expect(player.current.ayah).toBe(1);
    expect(player.current.isPlaying).toBe(true);
    expect(player.current.error).toBeNull();
  });

  it('stops at the end of surah 114 rather than asking for a 115th', async () => {
    provideTimings(114, 2);

    const player = mountPlayer();
    await playFully(player, 114, 2);
    const last = sounding();

    await actFlush(() => { last.finish(); });

    expect(player.current.surahId).toBe(114);
    expect(player.current.surahName).toBe('An-Nas');
    expect(player.current.isPlaying).toBe(false);
    expect(player.current.error).toBeNull();
    expect(timingsReads).not.toContain(115);

    // "Next" on the very last ayah of the Qur'an has nowhere to go either.
    await actFlush(() => player.current.next());
    expect(player.current.surahId).toBe(114);
    expect(timingsReads).not.toContain(115);
  });
});

describe('PlayerProvider — toggle', () => {
  it('starts the position the bar is offering when nothing is live yet', async () => {
    saveLastPosition({ surahId: 3, ayah: 2 });
    provideTimings(3, 4);

    const player = mountPlayer();
    await flush();
    expect(player.current.isPlaying).toBe(false);

    await actFlush(() => { player.current.toggle(); });

    expect(player.current.surahId).toBe(3);
    expect(player.current.ayah).toBe(2);
    expect(player.current.isPlaying).toBe(true);
    expect(sounding().playing).toBe(true);
  });

  it('pauses and resumes the live sequencer', async () => {
    provideTimings(1, 3);

    const player = mountPlayer();
    await playFully(player, 1);
    const live = sounding();

    act(() => { player.current.toggle(); });

    expect(player.current.isPlaying).toBe(false);
    expect(audio.players.every(p => !p.playing)).toBe(true);
    expect(live.released).toBe(false);

    await actFlush(() => { player.current.toggle(); });

    expect(player.current.isPlaying).toBe(true);
    expect(live.playing).toBe(true);
    expect(player.current.surahId).toBe(1);
    expect(player.current.ayah).toBe(1);
  });
});

describe('PlayerProvider — the highlight', () => {
  it('paints the active word only while the viewed surah is the one playing', async () => {
    provideTimings(1, 3);
    provideTimings(2, 3);

    const player = mountPlayer();
    await flush();
    player.current.attachViewer(1);
    await playFully(player, 1);

    const live = sounding();
    live.setTime(2500);
    act(() => { runFrames(2); });
    expect(activeWordStore.getSnapshot()).toBe('1:1:2');

    // The user opens a different surah while surah 1 keeps playing.
    act(() => { player.current.attachViewer(2); });
    expect(activeWordStore.getSnapshot()).toBeNull();

    live.setTime(500);
    act(() => { runFrames(2); });
    expect(activeWordStore.getSnapshot()).toBeNull();

    // Back on the playing surah, painting resumes.
    act(() => { player.current.attachViewer(1); });
    live.setTime(2500);
    act(() => { runFrames(2); });
    expect(activeWordStore.getSnapshot()).toBe('1:1:2');
  });

  it('runs the frame loop only while sound is actually playing', async () => {
    provideTimings(1, 3);

    const player = mountPlayer();
    expect(frames.requested).toBe(0);
    await playFully(player, 1);

    expect(frames.requested).toBeGreaterThan(0);
    expect(frames.pending).toBeGreaterThan(0);

    act(() => { player.current.toggle(); });

    expect(frames.pending).toBe(0);
    const requestedAtPause = frames.requested;
    act(() => { runFrames(3); });
    expect(frames.requested).toBe(requestedAtPause);

    await actFlush(() => { player.current.toggle(); });
    expect(frames.pending).toBeGreaterThan(0);
  });

  it('stops the frame loop when a surah ends', async () => {
    provideTimings(114, 2);

    const player = mountPlayer();
    await playFully(player, 114, 2);
    expect(frames.pending).toBeGreaterThan(0);

    await actFlush(() => { sounding().finish(); });

    expect(player.current.isPlaying).toBe(false);
    expect(frames.pending).toBe(0);
    const requestedAtEnd = frames.requested;
    act(() => { runFrames(3); });
    expect(frames.requested).toBe(requestedAtEnd);
  });
});

describe('PlayerProvider — action identity', () => {
  it('hands out the same action functions across state updates', async () => {
    provideTimings(1, 3);

    const player = mountPlayer();
    await flush();
    const first = player.renders[0];
    expect(first).toBeDefined();

    await playFully(player, 1);
    const latest = player.current;

    // The comparison is only meaningful if the state really did tick.
    expect(player.renders.length).toBeGreaterThan(1);
    expect(latest).not.toBe(first);
    expect(latest.isPlaying).not.toBe(first!.isPlaying);

    expect(latest.play).toBe(first!.play);
    expect(latest.toggle).toBe(first!.toggle);
    expect(latest.next).toBe(first!.next);
    expect(latest.prev).toBe(first!.prev);
    expect(latest.attachViewer).toBe(first!.attachViewer);
  });
});
