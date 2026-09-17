import { beforeEach, describe, expect, it, vi } from 'vitest';

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
/**
 * `usePlayer` is wrapped rather than replaced: with `playerStub.value` set
 * the bar renders against a state this file dictates, and with it null the
 * bar reads the real provider it is mounted in. Both halves of behaviour
 * 13 — the pure rendering rules and the wiring to the real actions — are
 * then testable in one file.
 */
vi.mock('../src/player/PlayerProvider', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/player/PlayerProvider')>();
  const stub = await import('./helpers/playerStub');
  return { ...actual, usePlayer: () => stub.playerStub.value ?? actual.usePlayer() };
});

import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer, ReactTestRendererNode } from 'react-test-renderer';
import { PlayerBar } from '../src/player/PlayerBar';
import type { PlayerContextValue } from '../src/player/PlayerProvider';
import { playerStub, resetPlayerStub, stubPlayer } from './helpers/playerStub';
import { provideTimings } from './helpers/fakeTimings';
import {
  actFlush, flush, mountPlayer, playFully, resetPlayerEnvironment,
} from './helpers/renderPlayer';

/**
 * Every rendered line of text, in document order — each element's own string
 * children joined, so `Ayah {ayah}` reads as one label ("Ayah 255") rather
 * than as the two fragments React hands the renderer.
 */
function renderedText(tree: ReactTestRenderer): string[] {
  const found: string[] = [];
  const walk = (node: ReactTestRendererNode | null) => {
    if (node === null || typeof node === 'string') return;
    const children = node.children ?? [];
    const own = children.filter((c): c is string => typeof c === 'string').join('');
    if (own) found.push(own);
    children.forEach(walk);
  };
  const json = tree.toJSON();
  (Array.isArray(json) ? json : [json]).forEach(walk);
  return found;
}

/**
 * Host nodes only. Every `<Pressable>` appears twice in the tree — once as
 * the component and once as the element it renders — and a test that counted
 * both would be asserting on React's structure rather than on the screen.
 */
function hostNodes(tree: ReactTestRenderer, predicate: (node: ReactTestInstance) => boolean) {
  return tree.root.findAll(node => typeof node.type === 'string' && predicate(node));
}

/** The single control carrying `label`, as a screen reader would find it. */
function control(tree: ReactTestRenderer, label: string): ReactTestInstance {
  const matches = hostNodes(tree, node => node.props.accessibilityLabel === label);
  if (matches.length !== 1) {
    throw new Error(`expected exactly one control labelled "${label}", found ${matches.length}`);
  }
  return matches[0];
}

function controlLabels(tree: ReactTestRenderer): string[] {
  return hostNodes(tree, node => typeof node.props.accessibilityLabel === 'string')
    .map(node => String(node.props.accessibilityLabel));
}

function press(node: ReactTestInstance): void {
  act(() => {
    (node.props.onPress as () => void)();
  });
}

/** Renders the bar alone, against a dictated player state. */
function renderBar(state: Partial<PlayerContextValue> = {}) {
  playerStub.value = stubPlayer(state);
  const onNavigate = vi.fn();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<PlayerBar onNavigate={onNavigate} />);
  });
  return { tree, onNavigate, player: playerStub.value };
}

beforeEach(() => {
  resetPlayerEnvironment();
  resetPlayerStub();
});

describe('PlayerBar — what it shows', () => {
  it('is on screen from the very first launch, offering Al-Fatihah 1:1', async () => {
    provideTimings(1, 3);

    const harness = mountPlayer(<PlayerBar onNavigate={vi.fn()} />);
    await flush();

    expect(harness.tree.toJSON()).not.toBeNull();
    const text = renderedText(harness.tree);
    expect(text).toContain('Al-Fatihah');
    expect(text).toContain('Ayah 1');
    expect(controlLabels(harness.tree)).toContain('Play');
  });

  it('renders no chrome at all when no surah is known', () => {
    const { tree } = renderBar({ surahId: null, surahName: null });

    expect(tree.toJSON()).toBeNull();
  });

  it('shows the surah name and the ayah it is on', () => {
    const { tree } = renderBar({ surahId: 2, surahName: 'Al-Baqarah', ayah: 255 });

    const text = renderedText(tree);
    expect(text).toContain('Al-Baqarah');
    expect(text).toContain('Ayah 255');
  });

  it('labels the toggle Play when paused and Pause when playing', () => {
    expect(controlLabels(renderBar({ isPlaying: false }).tree)).toContain('Play');
    expect(controlLabels(renderBar({ isPlaying: true }).tree)).toContain('Pause');
  });

  it('says Loading, and refuses taps, only while this surah is the one loading', () => {
    const loadingThisSurah = renderBar({
      surahId: 1, isLoading: true, pendingSurahId: 1, isPlaying: false,
    }).tree;

    expect(controlLabels(loadingThisSurah)).toContain('Loading');
    expect(control(loadingThisSurah, 'Loading').props.disabled).toBe(true);
    expect(control(loadingThisSurah, 'Previous ayah').props.disabled).toBe(true);
    expect(control(loadingThisSurah, 'Next ayah').props.disabled).toBe(true);

    // A *different* surah is loading in the background: this bar still
    // describes the surah that is actually making sound, and that surah is
    // not loading, so it must neither spin nor disable its own controls.
    const loadingOtherSurah = renderBar({
      surahId: 1, isLoading: true, pendingSurahId: 2, isPlaying: true,
    }).tree;

    expect(controlLabels(loadingOtherSurah)).toContain('Pause');
    expect(controlLabels(loadingOtherSurah)).not.toContain('Loading');
    expect(control(loadingOtherSurah, 'Pause').props.disabled).toBe(false);
    expect(control(loadingOtherSurah, 'Previous ayah').props.disabled).toBe(false);
    expect(control(loadingOtherSurah, 'Next ayah').props.disabled).toBe(false);
  });

  it('offers prev, toggle and next as the three transport controls', () => {
    const { tree } = renderBar({ isPlaying: true });

    expect(controlLabels(tree)).toEqual(
      expect.arrayContaining(['Previous ayah', 'Pause', 'Next ayah']),
    );
  });
});

describe('PlayerBar — what it does', () => {
  it('wires each control to the matching player action', () => {
    const { tree, player, onNavigate } = renderBar({ surahId: 2, surahName: 'Al-Baqarah', ayah: 4 });

    press(control(tree, 'Previous ayah'));
    press(control(tree, 'Next ayah'));
    press(control(tree, 'Play'));
    press(control(tree, 'Go to Al-Baqarah'));

    expect(player.prev).toHaveBeenCalledTimes(1);
    expect(player.next).toHaveBeenCalledTimes(1);
    expect(player.toggle).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(2);
  });

  it('starts, pauses and steps real playback through the provider', async () => {
    provideTimings(1, 3);
    const harness = mountPlayer(<PlayerBar onNavigate={vi.fn()} />);
    await flush();

    await actFlush(() => { press(control(harness.tree, 'Play')); });
    expect(harness.current.isPlaying).toBe(true);
    expect(controlLabels(harness.tree)).toContain('Pause');
    expect(renderedText(harness.tree)).toContain('Ayah 1');

    await actFlush(() => { press(control(harness.tree, 'Next ayah')); });
    expect(harness.current.ayah).toBe(2);
    expect(renderedText(harness.tree)).toContain('Ayah 2');

    await actFlush(() => { press(control(harness.tree, 'Previous ayah')); });
    expect(harness.current.ayah).toBe(1);
    expect(renderedText(harness.tree)).toContain('Ayah 1');

    await actFlush(() => { press(control(harness.tree, 'Pause')); });
    expect(harness.current.isPlaying).toBe(false);
    expect(controlLabels(harness.tree)).toContain('Play');
  });

  it('keeps describing the playing surah while another one loads', async () => {
    provideTimings(1, 3);
    provideTimings(2, 3);
    const harness = mountPlayer(<PlayerBar onNavigate={vi.fn()} />);
    await playFully(harness, 1);

    const { audio } = await import('./helpers/fakeAudio');
    audio.holdLoadsMatching = /audio-002/;
    const switching = harness.current.play(2);
    await flush();

    const text = renderedText(harness.tree);
    expect(text).toContain('Al-Fatihah');
    expect(controlLabels(harness.tree)).toContain('Pause');
    expect(controlLabels(harness.tree)).not.toContain('Loading');

    const { releaseHeldLoads } = await import('./helpers/fakeAudio');
    await actFlush(async () => {
      releaseHeldLoads();
      await switching;
    });

    expect(renderedText(harness.tree)).toContain('Al-Baqarah');
  });
});
