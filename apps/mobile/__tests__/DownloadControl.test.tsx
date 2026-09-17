import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => await import('./helpers/reactNativeMock'));
vi.mock('react-native-svg', async () => await import('./helpers/reactNativeSvgMock'));
vi.mock('expo-file-system', async () => (await import('./helpers/fakeFileSystem')).fakeFileSystemModule);
/**
 * A fixed, deterministic manifest rather than the real build-time one — the
 * label text this file asserts ("0.9 MB") must not drift if the real
 * recitation's file sizes ever change; the manifest's own correctness is
 * `audioSizes.test.ts`'s job.
 */
vi.mock('@quran/data/audio-sizes.json', () => ({
  default: {
    reciterId: 'test-reciter',
    totalBytes: 900_000,
    totalFiles: 7,
    surahs: { '1': { bytes: 900_000, files: 7 } },
  },
}));

import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { Alert } from 'react-native';
import { configureAudioBase, configureTimings, primeTimings, resetTimingsCache } from '@quran/core';
import { reset, setHoldDownloads, store } from './helpers/fakeFileSystem';
import { resetReactNative } from './helpers/reactNativeMock';
import { downloads as dl, startDownload } from '../src/offline/downloadManager';
import { DownloadControl } from '../src/components/DownloadControl';

const timings = (surah: number, count: number) => ({
  surah, reciterId: 'test-reciter', surahDurationMs: count * 1000,
  ayahs: Array.from({ length: count }, (_, i) => ({
    ayah: i + 1, audioUrl: `/audio/test-reciter/${String(surah).padStart(3, '0')}${String(i + 1).padStart(3, '0')}.mp3`,
    startOffsetMs: 0, durationMs: 1000, words: [],
  })),
});
const flush = () => new Promise(r => setTimeout(r, 0));
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await flush(); };

/** Host nodes only — a `<Pressable>` also appears as the element it renders. */
function hostNodes(tree: ReactTestRenderer, predicate: (node: ReactTestInstance) => boolean) {
  return tree.root.findAll(node => typeof node.type === 'string' && predicate(node));
}

function control(tree: ReactTestRenderer, label: string): ReactTestInstance {
  const matches = hostNodes(tree, node => node.props.accessibilityLabel === label);
  if (matches.length !== 1) {
    throw new Error(`expected exactly one control labelled "${label}", found ${matches.length}`);
  }
  return matches[0];
}

function renderedText(tree: ReactTestRenderer): string[] {
  const found: string[] = [];
  const json = tree.toJSON();
  const walk = (node: unknown): void => {
    if (node === null || typeof node === 'string') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const n = node as { children?: unknown[] };
    const children = n.children ?? [];
    const own = children.filter((c): c is string => typeof c === 'string').join('');
    if (own) found.push(own);
    children.forEach(walk);
  };
  walk(json);
  return found;
}

function press(node: ReactTestInstance): void {
  act(() => { (node.props.onPress as () => void)(); });
}

function renderControl(surahId: number, compact = false) {
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<DownloadControl surahId={surahId} compact={compact} />); });
  return tree;
}

beforeEach(() => {
  reset();
  resetReactNative();
  resetTimingsCache();
  configureTimings({ baseUrl: 'https://example.test' });
  configureAudioBase('https://example.test/audio');
  primeTimings(1, timings(1, 7));
  dl.__resetForTests();
});

describe('DownloadControl', () => {
  it('idle: offers to download, labelled with the surah name and its size', () => {
    const tree = renderControl(1);

    const button = control(tree, 'Download Al-Fatihah (0.9 MB)');
    expect(button.props.accessibilityRole).toBe('button');
    expect(renderedText(tree)).toContain('0.9 MB');
  });

  it('compact: drops the size text but keeps the same label', () => {
    const tree = renderControl(1, true);

    control(tree, 'Download Al-Fatihah (0.9 MB)');
    expect(renderedText(tree)).not.toContain('0.9 MB');
  });

  it('downloading: shows done/total progress and a cancel affordance', async () => {
    setHoldDownloads(/001004/);
    const tree = renderControl(1);

    act(() => { startDownload(1); });
    await act(async () => { await settle(); });

    expect(renderedText(tree)).toContain('3 / 7');
    const cancel = control(tree, 'Cancel download');
    expect(cancel.props.accessibilityRole).toBe('button');
  });

  it('cancelling goes back to idle', async () => {
    setHoldDownloads(/001004/);
    const tree = renderControl(1);
    act(() => { startDownload(1); });
    await act(async () => { await settle(); });

    press(control(tree, 'Cancel download'));
    await act(async () => { await settle(); });

    control(tree, 'Download Al-Fatihah (0.9 MB)');
  });

  it('done: shows a check labelled to delete', async () => {
    const tree = renderControl(1);
    act(() => { startDownload(1); });
    await act(async () => { await settle(); });

    const button = control(tree, 'Downloaded, tap to delete');
    expect(button.props.accessibilityRole).toBe('button');
  });

  it('tapping done confirms, and the destructive button removes the download', async () => {
    const tree = renderControl(1);
    act(() => { startDownload(1); });
    await act(async () => { await settle(); });

    press(control(tree, 'Downloaded, tap to delete'));

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = vi.mocked(Alert.alert).mock.calls[0] as [string, string, { text: string; style?: string; onPress?: () => void }[]];
    expect(title).toBe('Delete Al-Fatihah?');
    expect(message).toBe('Frees 0.9 MB of storage.');
    const destructive = buttons.find(b => b.style === 'destructive');
    expect(destructive?.text).toBe('Delete');

    act(() => { destructive!.onPress!(); });
    await act(async () => { await settle(); });

    expect([...store.keys()].some(k => k.startsWith('file:///doc/offline/1/'))).toBe(false);
    control(tree, 'Download Al-Fatihah (0.9 MB)');
  });

  it('confirming does not remove anything on its own — only the destructive button does', async () => {
    const tree = renderControl(1);
    act(() => { startDownload(1); });
    await act(async () => { await settle(); });

    press(control(tree, 'Downloaded, tap to delete'));
    const [, , buttons] = vi.mocked(Alert.alert).mock.calls[0] as [string, string, { text: string; style?: string; onPress?: () => void }[]];
    const cancelButton = buttons.find(b => b.style === 'cancel');
    expect(cancelButton?.onPress).toBeUndefined();

    // Nothing removed yet: the destructive callback was never invoked.
    control(tree, 'Downloaded, tap to delete');
  });
});
