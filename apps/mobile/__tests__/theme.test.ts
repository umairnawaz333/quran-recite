import { describe, it, expect, vi, beforeEach } from 'vitest';

// `theme.tsx` imports `useColorScheme` from react-native, whose own entry
// point cannot be loaded under vitest's node environment (see
// `helpers/reactNativeMock.tsx`) — so the slice of it this module touches is
// mocked here too, `setColorScheme` standing in for the OS flipping dark mode.
vi.mock('react-native', async () => await import('./helpers/reactNativeMock'));
vi.mock('expo-file-system', async () => (await import('./helpers/fakeFileSystem')).fakeFileSystemModule);
import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { store, reset, setFailWritesMatching } from './helpers/fakeFileSystem';
import { resetReactNative, setColorScheme } from './helpers/reactNativeMock';
import {
  resolveScheme, readThemePreference, writeThemePreference, LIGHT, DARK,
  ThemeProvider, useTheme, useThemePreference, type Palette, type Scheme, type ThemePreference,
} from '../src/theme/theme';

beforeEach(() => {
  reset();
  resetReactNative();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('theme', () => {
  it('"system" follows the device, and falls back to light when the device says nothing', () => {
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', 'light')).toBe('light');
    expect(resolveScheme('system', null)).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
    expect(resolveScheme('light', 'dark')).toBe('light');
  });

  it('persists the preference and reads system when nothing or garbage is stored', async () => {
    expect(await readThemePreference()).toBe('system');
    writeThemePreference('dark');
    expect(await readThemePreference()).toBe('dark');
    store.set('file:///doc/theme.json', '"purple"');
    expect(await readThemePreference()).toBe('system');
  });

  it('never throws when the preference cannot be written', async () => {
    // A full disk, or a document directory that is not there: losing the
    // preference is acceptable, taking the app down with it is not.
    setFailWritesMatching(/theme\.json$/);
    expect(() => writeThemePreference('dark')).not.toThrow();
    expect(await readThemePreference()).toBe('system');
  });

  it('palettes cover every key in both schemes with distinct backgrounds', () => {
    expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort());
    expect(LIGHT.background).not.toBe(DARK.background);
    expect(LIGHT.highlight).toBe('#fde68a');          // the web's .word--active tint stays on light
  });
});

/** Mounts the provider and records what `useTheme()`/`useThemePreference()` hand out per render. */
async function mountTheme() {
  const themes: { palette: Palette; scheme: Scheme }[] = [];
  const preferences: ThemePreference[] = [];
  let setPreference!: (p: ThemePreference) => void;

  function Probe() {
    themes.push(useTheme());
    const [preference, set] = useThemePreference();
    preferences.push(preference);
    setPreference = set;
    return null;
  }

  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(createElement(ThemeProvider, null, createElement(Probe))); });
  return {
    themes,
    preferences,
    get theme() { return themes[themes.length - 1]!; },
    get preference() { return preferences[preferences.length - 1]!; },
    setPreference: async (p: ThemePreference) => { await act(async () => { setPreference(p); }); },
    flipDevice: async (scheme: Scheme) => { await act(async () => { setColorScheme(scheme); }); },
    unmount: () => { act(() => { tree.unmount(); }); },
  };
}

describe('ThemeProvider', () => {
  it('on "system", follows the device scheme as it changes — live, not only at mount', async () => {
    const t = await mountTheme();
    expect(t.preference).toBe('system');
    expect(t.theme.scheme).toBe('light');
    expect(t.theme.palette).toBe(LIGHT);

    await t.flipDevice('dark');
    expect(t.theme.scheme).toBe('dark');
    expect(t.theme.palette).toBe(DARK);

    await t.flipDevice('light');
    expect(t.theme.palette).toBe(LIGHT);
    t.unmount();
  });

  it('reads the stored preference on mount, and an explicit one ignores the device', async () => {
    writeThemePreference('dark');
    setColorScheme('light');
    const t = await mountTheme();
    expect(t.preference).toBe('dark');
    expect(t.theme.scheme).toBe('dark');

    await t.flipDevice('dark');
    expect(t.theme.scheme).toBe('dark');
    await t.flipDevice('light');
    expect(t.theme.scheme).toBe('dark');
    t.unmount();
  });

  it('a new preference applies at once and survives the next launch', async () => {
    const t = await mountTheme();
    await t.setPreference('dark');
    expect(t.theme.palette).toBe(DARK);
    expect(await readThemePreference()).toBe('dark');

    await t.setPreference('light');
    expect(t.theme.palette).toBe(LIGHT);
    expect(await readThemePreference()).toBe('light');
    t.unmount();
  });

  it('hands out the same object until the scheme actually changes', async () => {
    const t = await mountTheme();
    const first = t.theme;
    // A re-render that changes nothing about the theme (the device reports
    // the scheme it already had) must not hand the reader a new object —
    // that identity is what keeps the per-word tick path from re-rendering.
    await t.flipDevice('light');
    expect(t.theme).toBe(first);
    await t.flipDevice('dark');
    expect(t.theme).not.toBe(first);
    t.unmount();
  });

  it('falls back to the light palette when no provider is mounted', async () => {
    const seen: { palette: Palette; scheme: Scheme }[] = [];
    function Bare() { seen.push(useTheme()); return null; }
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(createElement(Bare)); });
    expect(seen[0]).toEqual({ palette: LIGHT, scheme: 'light' });
    act(() => { tree.unmount(); });
  });
});
