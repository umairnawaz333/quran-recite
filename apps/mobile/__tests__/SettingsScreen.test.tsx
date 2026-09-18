import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => await import('./helpers/reactNativeMock'));
vi.mock('react-native-svg', async () => await import('./helpers/reactNativeSvgMock'));
vi.mock('expo-file-system', async () => (await import('./helpers/fakeFileSystem')).fakeFileSystemModule);
vi.mock('expo-application', () => ({ nativeApplicationVersion: '1.2.3' }));

import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { Alert } from 'react-native';
import { configureAudioBase, configureTimings, primeTimings, resetTimingsCache } from '@quran/core';
import { store, reset, listedDirs, setHoldDownloads } from './helpers/fakeFileSystem';
import { resetReactNative } from './helpers/reactNativeMock';
import { downloads as dl, downloadAll, startDownload, refreshFromDisk } from '../src/offline/downloadManager';
import { writeOfflineTimings } from '../src/offline/offlineStore';
import { allAudioSize, formatBytes } from '../src/offline/audioSizes';
import { ThemeProvider } from '../src/theme/theme';
import { SettingsScreen } from '../src/screens/SettingsScreen';

const timings = (surah: number, count: number) => ({
  surah, reciterId: 'test-reciter', surahDurationMs: count * 1000,
  ayahs: Array.from({ length: count }, (_, i) => ({
    ayah: i + 1, audioUrl: `/audio/test-reciter/${String(surah).padStart(3, '0')}${String(i + 1).padStart(3, '0')}.mp3`,
    startOffsetMs: 0, durationMs: 1000, words: [],
  })),
});
const flush = () => new Promise(r => setTimeout(r, 0));
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await flush(); };

/** Puts one complete surah on the fake disk, bypassing the download manager. */
function seedDownloaded(surah: number, count: number, bytesPerFile: number) {
  writeOfflineTimings(surah, timings(surah, count));
  for (let n = 1; n <= count; n++) {
    const name = `${String(surah).padStart(3, '0')}${String(n).padStart(3, '0')}.mp3`;
    store.set(`file:///doc/offline/${surah}/${name}`, 'x'.repeat(bytesPerFile));
  }
}

/**
 * The bytes a cancelled or killed download left behind: some finished ayah
 * files, no timings, fewer files than the surah has.
 */
function seedIncomplete(surah: number, count: number, bytesPerFile: number) {
  for (let n = 1; n <= count; n++) {
    const name = `${String(surah).padStart(3, '0')}${String(n).padStart(3, '0')}.mp3`;
    store.set(`file:///doc/offline/${surah}/${name}`, 'x'.repeat(bytesPerFile));
  }
}

/** The destructive button of the most recent `Alert.alert` call. */
function confirmDestructive(): void {
  const calls = vi.mocked(Alert.alert).mock.calls;
  const [, , buttons] = calls[calls.length - 1] as [string, string, { text: string; style?: string; onPress?: () => void }[]];
  const destructive = buttons.find(b => b.style === 'destructive');
  act(() => { destructive!.onPress!(); });
}

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

async function renderScreen(onBack = vi.fn(), onOpenSurah = vi.fn()) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(createElement(ThemeProvider, null, createElement(SettingsScreen, { onBack, onOpenSurah })));
  });
  return { tree, onBack, onOpenSurah };
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

describe('SettingsScreen — offline management', () => {
  it('lists downloaded surahs with their names, sizes and the disk total', async () => {
    seedDownloaded(1, 7, 100_000); // 700,000 bytes -> "0.7 MB"
    seedDownloaded(108, 3, 100_000); // 300,000 bytes -> "0.3 MB"
    refreshFromDisk();
    const { tree } = await renderScreen();

    const text = renderedText(tree);
    expect(text).toContain('Al-Fatihah');
    expect(text).toContain('0.7 MB');
    expect(text).toContain('Al-Kawthar');
    expect(text).toContain('0.3 MB');
    expect(text.some(t => t.includes('1.0 MB'))).toBe(true); // 1,000,000 bytes total
  });

  it('tapping a downloaded surah opens it', async () => {
    seedDownloaded(1, 7, 100_000);
    refreshFromDisk();
    const { tree, onOpenSurah } = await renderScreen();

    press(control(tree, 'Open Al-Fatihah'));
    expect(onOpenSurah).toHaveBeenCalledWith(1);
  });

  it('deletes one surah after confirming, and removing it clears its row', async () => {
    seedDownloaded(1, 7, 100_000);
    refreshFromDisk();
    const { tree } = await renderScreen();

    press(control(tree, 'Delete Al-Fatihah'));
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = vi.mocked(Alert.alert).mock.calls[0] as [string, string, { text: string; style?: string; onPress?: () => void }[]];
    expect(title).toBe('Delete Al-Fatihah?');
    expect(message).toBe('Frees 0.7 MB of storage.');
    const destructive = buttons.find(b => b.style === 'destructive');

    act(() => { destructive!.onPress!(); });

    expect([...store.keys()].some(k => k.startsWith('file:///doc/offline/1/'))).toBe(false);
    expect(renderedText(tree)).toContain('No surahs downloaded yet.');
  });

  it('"Delete all" confirms, and afterwards nothing is downloaded', async () => {
    seedDownloaded(1, 7, 100_000);
    seedDownloaded(108, 3, 100_000);
    refreshFromDisk();
    const { tree } = await renderScreen();

    press(control(tree, 'Delete all'));
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [, , buttons] = vi.mocked(Alert.alert).mock.calls[0] as [string, string, { text: string; style?: string; onPress?: () => void }[]];
    const destructive = buttons.find(b => b.style === 'destructive');

    act(() => { destructive!.onPress!(); });

    expect(dl.downloaded()).toEqual([]);
    expect(renderedText(tree)).toContain('No surahs downloaded yet.');
  });

  it('"Delete all" also removes a surah that finished downloading while the confirmation was open', async () => {
    seedDownloaded(1, 7, 100_000);
    seedDownloaded(108, 3, 100_000);
    refreshFromDisk();
    const { tree } = await renderScreen();

    press(control(tree, 'Delete all'));
    const [, , buttons] = vi.mocked(Alert.alert).mock.calls[0] as [string, string, { text: string; style?: string; onPress?: () => void }[]];
    const destructive = buttons.find(b => b.style === 'destructive');

    // A third surah finishes downloading while the dialog is still open —
    // it must not be missed just because it postdates the render that
    // captured the button's list of surahs to delete.
    seedDownloaded(114, 6, 100_000);
    refreshFromDisk();

    act(() => { destructive!.onPress!(); });

    expect(dl.downloaded()).toEqual([]);
    expect([...store.keys()].some(k => k.startsWith('file:///doc/offline/'))).toBe(false);
    expect(renderedText(tree)).toContain('No surahs downloaded yet.');
  });

  it('shows incomplete downloads as one row, counts their bytes in the total, and deletes them', async () => {
    seedDownloaded(1, 7, 100_000);      // 0.7 MB, complete
    seedIncomplete(112, 2, 100_000);    // 0.2 MB of a surah that needs 4 files
    refreshFromDisk();
    const { tree } = await renderScreen();

    const text = renderedText(tree);
    expect(text).toContain('Incomplete downloads');
    expect(text).toContain('0.2 MB');
    // Space that is actually being used is space the total has to admit to.
    expect(text).toContain('Total: 0.9 MB');

    press(control(tree, 'Delete incomplete downloads'));
    confirmDestructive();

    expect([...store.keys()].some(k => k.startsWith('file:///doc/offline/112/'))).toBe(false);
    expect(store.has('file:///doc/offline/1/001001.mp3')).toBe(true);
    expect(renderedText(tree)).not.toContain('Incomplete downloads');
  });

  it('"Delete all" clears the incomplete leftovers too, with one disk walk at each end', async () => {
    seedDownloaded(1, 7, 100_000);
    seedDownloaded(108, 3, 100_000);
    seedIncomplete(112, 2, 100_000);
    refreshFromDisk();
    const { tree } = await renderScreen();

    press(control(tree, 'Delete all'));
    listedDirs.length = 0;
    confirmDestructive();

    // Two walks of `offline/` — the confirm-time re-read and the publish —
    // not one per surah (the ANR risk at 114).
    expect(listedDirs.filter(uri => uri === 'file:///doc/offline/')).toHaveLength(2);
    expect(dl.downloaded()).toEqual([]);
    expect(dl.incomplete().ids).toEqual([]);
    expect([...store.keys()].some(k => k.startsWith('file:///doc/offline/'))).toBe(false);
  });

  it('shows no surahs downloaded yet when nothing is on disk', async () => {
    const { tree } = await renderScreen();
    expect(renderedText(tree)).toContain('No surahs downloaded yet.');
  });

  it('"Download all" names the manifest total and is wired to downloadAll, without calling it', async () => {
    const { tree } = await renderScreen();
    const { bytes, files } = allAudioSize();
    const label = `Download all (${formatBytes(bytes)})`;

    press(control(tree, label));

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = vi.mocked(Alert.alert).mock.calls[0] as [string, string, { text: string; onPress?: () => void }[]];
    expect(title).toBe('Download everything?');
    expect(message).toContain(formatBytes(bytes));
    expect(message).toContain(files.toLocaleString());
    const downloadButton = buttons.find(b => b.text === 'Download');
    expect(downloadButton?.onPress).toBe(downloadAll);
  });

  it('shows an in-progress download above the list, with a working cancel', async () => {
    setHoldDownloads(/001004/);
    const { tree } = await renderScreen();

    act(() => { startDownload(1); });
    await act(async () => { await settle(); });

    expect(renderedText(tree)).toContain('3 / 7');
    press(control(tree, 'Cancel Al-Fatihah download'));
    await act(async () => { await settle(); });

    expect(renderedText(tree)).not.toContain('3 / 7');
  });
});

describe('SettingsScreen — appearance', () => {
  it('offers System, Light and Dark, marking the active one selected', async () => {
    const { tree } = await renderScreen();

    const system = control(tree, 'System');
    const light = control(tree, 'Light');
    const dark = control(tree, 'Dark');
    expect(system.props.accessibilityState).toEqual({ selected: true });
    expect(light.props.accessibilityState).toEqual({ selected: false });
    expect(dark.props.accessibilityState).toEqual({ selected: false });
  });

  it('tapping Dark persists the preference and updates the selection', async () => {
    const { tree } = await renderScreen();

    press(control(tree, 'Dark'));

    expect(store.get('file:///doc/theme.json')).toBe('"dark"');
    expect(control(tree, 'Dark').props.accessibilityState).toEqual({ selected: true });
    expect(control(tree, 'System').props.accessibilityState).toEqual({ selected: false });
  });
});

describe('SettingsScreen — about', () => {
  it('shows the native app version and the credit', async () => {
    const { tree } = await renderScreen();

    const text = renderedText(tree);
    expect(text).toContain('Version 1.2.3');
    expect(text).toContain('© 2026 — Umair Nawaz');
  });
});

describe('SettingsScreen — navigation', () => {
  it('back returns to the list', async () => {
    const { tree, onBack } = await renderScreen();

    press(control(tree, 'Back'));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
