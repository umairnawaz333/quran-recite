import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The app shell's own job: which screen is showing, and what Android's
 * hardware back button does to it. The three screens are stubbed — their
 * contents are tested in their own files, and what matters here is which one
 * the shell decided to render and with what props.
 */
vi.mock('react-native', async () => await import('./helpers/reactNativeMock'));
vi.mock('react-native-svg', async () => await import('./helpers/reactNativeSvgMock'));
vi.mock('expo-file-system', async () => (await import('./helpers/fakeFileSystem')).fakeFileSystemModule);
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
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children?: unknown }) => children,
  SafeAreaView: (props: Record<string, unknown>) => createElement('SafeAreaView', props),
}));
vi.mock('expo-splash-screen', () => ({ preventAutoHideAsync: async () => true, hideAsync: async () => true, setOptions: () => {} }));
vi.mock('expo-status-bar', () => ({ StatusBar: (props: Record<string, unknown>) => createElement('StatusBar', props) }));
/** The real hook loads bundled `.ttf` assets, which vitest cannot resolve. */
vi.mock('../src/reader/fonts', () => ({ useQuranFonts: () => true }));
vi.mock('../src/screens/SurahListScreen', () => ({
  SurahListScreen: (props: Record<string, unknown>) => createElement('SurahListScreen', props),
}));
vi.mock('../src/screens/ReaderScreen', () => ({
  ReaderScreen: (props: Record<string, unknown>) => createElement('ReaderScreen', props),
}));
vi.mock('../src/screens/SettingsScreen', () => ({
  SettingsScreen: (props: Record<string, unknown>) => createElement('SettingsScreen', props),
}));

import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import App from '../App';
import { reset } from './helpers/fakeFileSystem';
import { resetAudio } from './helpers/fakeAudio';
import { backListenerCount, pressBack, resetReactNative } from './helpers/reactNativeMock';

function screenNode(tree: ReactTestRenderer, name: string): ReactTestInstance | null {
  const found = tree.root.findAll(node => node.type === name);
  return found[0] ?? null;
}

/** Which of the three top-level screens is mounted. */
function currentScreen(tree: ReactTestRenderer): string {
  const names = ['SurahListScreen', 'ReaderScreen', 'SettingsScreen'].filter(n => screenNode(tree, n) !== null);
  if (names.length !== 1) throw new Error(`expected exactly one screen, found ${names.join(', ') || 'none'}`);
  return names[0];
}

async function mountApp(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(App)); });
  return tree;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  reset();
  resetAudio();
  resetReactNative();
});

describe('App — the Android back button', () => {
  it('takes Settings back to the list', async () => {
    const tree = await mountApp();
    act(() => { (screenNode(tree, 'SurahListScreen')!.props.onOpenSettings as () => void)(); });
    expect(currentScreen(tree)).toBe('SettingsScreen');

    let handled!: boolean;
    act(() => { handled = pressBack(); });

    expect(handled).toBe(true);
    expect(currentScreen(tree)).toBe('SurahListScreen');
  });

  it('takes the reader back to the list, forgetting the surah it was showing', async () => {
    const tree = await mountApp();
    act(() => { (screenNode(tree, 'SurahListScreen')!.props.onSelect as (id: number) => void)(112); });
    expect(currentScreen(tree)).toBe('ReaderScreen');
    expect(screenNode(tree, 'ReaderScreen')!.props.surahId).toBe(112);

    let handled!: boolean;
    act(() => { handled = pressBack(); });

    expect(handled).toBe(true);
    expect(currentScreen(tree)).toBe('SurahListScreen');

    // The surah is forgotten, so re-opening Settings and coming back cannot
    // land on a reader nobody asked for.
    act(() => { (screenNode(tree, 'SurahListScreen')!.props.onOpenSettings as () => void)(); });
    act(() => { pressBack(); });
    expect(currentScreen(tree)).toBe('SurahListScreen');
  });

  it('leaves back alone on the list, so the OS closes the app', async () => {
    const tree = await mountApp();
    expect(currentScreen(tree)).toBe('SurahListScreen');

    let handled!: boolean;
    act(() => { handled = pressBack(); });

    expect(handled).toBe(false);
    expect(currentScreen(tree)).toBe('SurahListScreen');
  });

  it('subscribes once, and unsubscribes on unmount', async () => {
    const tree = await mountApp();
    expect(backListenerCount()).toBe(1);

    // A screen change re-arms the handler; it must not stack up.
    act(() => { (screenNode(tree, 'SurahListScreen')!.props.onOpenSettings as () => void)(); });
    expect(backListenerCount()).toBe(1);

    await act(async () => { tree.unmount(); });
    expect(backListenerCount()).toBe(0);
  });
});
