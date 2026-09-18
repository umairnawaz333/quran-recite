/**
 * The slice of `react-native` the player touches, as plain host components.
 *
 * `react-native`'s own entry point cannot be imported under vitest's `node`
 * environment at all (its sources are Flow-typed and its modules expect the
 * native bridge), and the Jest preset that normally supplies these mocks is
 * not available here. Rendering each of these as a host element instead —
 * `<View>` becomes `{ type: 'View', props }` in `react-test-renderer`'s JSON
 * — keeps every prop the component passed (`accessibilityLabel`, `onPress`,
 * `disabled`) inspectable, which is what the PlayerBar assertions query by.
 */
import { createElement, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';

type HostProps = Record<string, unknown> & { children?: ReactNode };

function host(name: string) {
  const Component = (props: HostProps) => createElement(name, props);
  Component.displayName = name;
  return Component;
}

export const View = host('View');
export const Text = host('Text');
export const Pressable = host('Pressable');
export const ScrollView = host('ScrollView');
export const Image = host('Image');
export const SafeAreaView = host('SafeAreaView');
export const ActivityIndicator = host('ActivityIndicator');

export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  flatten: (style: unknown) => style,
  hairlineWidth: 1,
  absoluteFill: {},
};

class AnimatedValue {
  constructor(private value: number) {}
  /** The real one returns an opaque node; a string is enough for a style. */
  interpolate(_config: unknown): string {
    return `${this.value}deg`;
  }
  setValue(next: number) {
    this.value = next;
  }
}

const animation = { start: (_cb?: () => void) => {}, stop: () => {}, reset: () => {} };

export const Animated = {
  Value: AnimatedValue,
  View: host('Animated.View'),
  Text: host('Animated.Text'),
  timing: (_value: AnimatedValue, _config: unknown) => animation,
  loop: (_animation: unknown) => animation,
  sequence: (_animations: unknown[]) => animation,
};

export const Easing = {
  linear: (t: number) => t,
  inOut: (fn: (t: number) => number) => fn,
};

/**
 * `Alert.alert` as a spy: `DownloadControl`'s delete confirmation calls it
 * with a button list rather than a native dialog, so a test presses the
 * destructive button by invoking `Alert.alert.mock.calls`' last `onPress`.
 */
export const Alert = { alert: vi.fn() };

export const Platform = {
  OS: 'android' as const,
  select: <T,>(specifics: { android?: T; ios?: T; default?: T }): T | undefined =>
    specifics.android ?? specifics.default,
};

export const useWindowDimensions = () => ({ width: 400, height: 800, scale: 2, fontScale: 1 });
export const Dimensions = { get: () => ({ width: 400, height: 800, scale: 2, fontScale: 1 }) };

/**
 * The device's colour scheme, as the real `useColorScheme()` reports it: a
 * hook that re-renders its component when the OS flips dark mode. The theme
 * treats "system" as a live state, so a test has to be able to flip it
 * mid-render-tree — `setColorScheme` is the stand-in for the OS doing so.
 */
type ColorSchemeName = 'light' | 'dark';

let colorScheme: ColorSchemeName = 'light';
const colorSchemeListeners = new Set<(scheme: ColorSchemeName) => void>();

export function useColorScheme(): ColorSchemeName {
  const [scheme, setScheme] = useState(colorScheme);
  useEffect(() => {
    colorSchemeListeners.add(setScheme);
    // A flip between this component's first render and this effect would
    // otherwise be missed.
    setScheme(colorScheme);
    return () => { colorSchemeListeners.delete(setScheme); };
  }, []);
  return scheme;
}

/** Drives the OS flipping dark mode on or off (`adb shell cmd uimode night yes|no`). */
export function setColorScheme(next: ColorSchemeName): void {
  colorScheme = next;
  colorSchemeListeners.forEach(listener => listener(next));
}

/**
 * Android's hardware back button. The real `BackHandler` calls the most
 * recently added subscription first and stops at the first one returning
 * `true`; a run in which every listener returns `false` is the case where
 * the OS itself handles the press — by leaving the app.
 */
type BackListener = () => boolean;

const backListeners: BackListener[] = [];

export const BackHandler = {
  addEventListener(_event: 'hardwareBackPress', listener: BackListener) {
    backListeners.push(listener);
    return {
      remove() {
        const at = backListeners.indexOf(listener);
        if (at !== -1) backListeners.splice(at, 1);
      },
    };
  },
};

/** Presses back. `false` is "nothing handled it" — the app would exit. */
export function pressBack(): boolean {
  for (const listener of [...backListeners].reverse()) if (listener()) return true;
  return false;
}

/** How many live back subscriptions exist — a leak check. */
export function backListenerCount(): number {
  return backListeners.length;
}

export type AppStateStatus = 'active' | 'background' | 'inactive';

type AppStateListener = (status: AppStateStatus) => void;

const appStateListeners = new Set<AppStateListener>();

export const AppState = {
  currentState: 'active' as AppStateStatus,
  addEventListener(_event: 'change', listener: AppStateListener) {
    appStateListeners.add(listener);
    return {
      remove() {
        appStateListeners.delete(listener);
      },
    };
  },
};

/** Drives the real OS event the provider re-binds the media session on. */
export function emitAppState(status: AppStateStatus): void {
  AppState.currentState = status;
  appStateListeners.forEach(listener => listener(status));
}

/** How many live `AppState` subscriptions exist — a leak check. */
export function appStateListenerCount(): number {
  return appStateListeners.size;
}

export function resetReactNative(): void {
  appStateListeners.clear();
  backListeners.length = 0;
  AppState.currentState = 'active';
  colorScheme = 'light';
  Alert.alert.mockClear();
}
