import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { File, Paths } from 'expo-file-system';

export type ThemePreference = 'system' | 'light' | 'dark';
export type Scheme = 'light' | 'dark';

/**
 * Every colour the app draws with. The one place colours live: a screen
 * that hardcodes a hex value has no way to follow the scheme, so nothing
 * outside this file may name a colour — the tajweed rule colours excepted
 * (`reader/tajweedColours.ts`), since those are the reading standard and are
 * the same in both schemes.
 */
export interface Palette {
  background: string; surface: string; text: string; textMuted: string; border: string;
  accent: string; accentText: string; highlight: string; error: string; errorText: string; loadingBg: string;
}

export const LIGHT: Palette = {
  background: '#ffffff', surface: '#f3f4f6', text: '#1a1a1a', textMuted: '#777777', border: '#e5e7eb',
  accent: '#1a1a1a', accentText: '#ffffff', highlight: '#fde68a', error: '#fee2e2', errorText: '#991b1b', loadingBg: '#f3f4f6',
};
export const DARK: Palette = {
  background: '#0f1115', surface: '#1b1f27', text: '#f3f4f6', textMuted: '#9ca3af', border: '#2a2f3a',
  accent: '#f3f4f6', accentText: '#0f1115', highlight: '#6b5b12', error: '#4c1d1d', errorText: '#fecaca', loadingBg: '#1b1f27',
};

/** "system" is a live state: it resolves against whatever the device says NOW. */
export function resolveScheme(pref: ThemePreference, system: Scheme | null | undefined): Scheme {
  if (pref === 'system') return system === 'dark' ? 'dark' : 'light';
  return pref;
}

const FILE_NAME = 'theme.json';
const VALID: ThemePreference[] = ['system', 'light', 'dark'];

/** Never throws: any failure reads as "follow the system", the default. */
export async function readThemePreference(): Promise<ThemePreference> {
  try {
    const file = new File(Paths.document, FILE_NAME);
    if (!file.exists) return 'system';
    const parsed: unknown = JSON.parse(await file.text());
    return VALID.includes(parsed as ThemePreference) ? (parsed as ThemePreference) : 'system';
  } catch { return 'system'; }
}

/** Never throws: losing the preference is acceptable, crashing the app is not. */
export function writeThemePreference(pref: ThemePreference): void {
  try {
    const file = new File(Paths.document, FILE_NAME);
    if (!file.exists) file.create();
    file.write(JSON.stringify(pref));
  } catch { /* losing the preference is acceptable */ }
}

interface ThemeContextValue {
  /** Memoised on the scheme alone — see `useTheme`. */
  theme: { palette: Palette; scheme: Scheme };
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * What `useTheme()` reports with no provider above it: the light palette,
 * rather than a throw. The provider is mounted once, at the root of the
 * real app, so the only callers without one are tests that render a screen
 * or the player bar on its own — and those are about playback, not colour.
 */
const DEFAULT_THEME: { palette: Palette; scheme: Scheme } = { palette: LIGHT, scheme: 'light' };

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  useEffect(() => { void readThemePreference().then(setPreferenceState); }, []);
  const setPreference = useCallback((p: ThemePreference) => { setPreferenceState(p); writeThemePreference(p); }, []);
  // RN's `ColorSchemeName` also has `'unspecified'` (and null) for "the
  // device did not say" — both mean the same thing here: fall back to light.
  const scheme = resolveScheme(preference, system === 'dark' || system === 'light' ? system : null);
  // Two memos, not one: `theme` is what every screen reads on every render,
  // and it must keep its identity when only the *preference* changed
  // ('system' → 'light' on an already-light device), so a scheme-shaped
  // no-op cannot re-render the reader's per-word path.
  const theme = useMemo(() => ({ palette: scheme === 'dark' ? DARK : LIGHT, scheme }), [scheme]);
  const value = useMemo(() => ({ theme, preference, setPreference }), [theme, preference, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * The colours to draw with. The returned object is stable until the scheme
 * actually changes, so it is safe in a dependency array — and a word tick
 * in the reader never sees a new one.
 */
export function useTheme(): { palette: Palette; scheme: Scheme } {
  return useContext(ThemeContext)?.theme ?? DEFAULT_THEME;
}

/** The stored preference and a setter that persists it — for the Settings screen. */
export function useThemePreference(): [ThemePreference, (p: ThemePreference) => void] {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemePreference must be used inside <ThemeProvider>');
  return [ctx.preference, ctx.setPreference];
}
