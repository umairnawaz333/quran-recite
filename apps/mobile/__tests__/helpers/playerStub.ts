/**
 * A `usePlayer()` value the tests control directly.
 *
 * `PlayerBar` reads everything it renders from the context, and two of its
 * cases cannot be reached by driving the real provider: `surahId === null`
 * (today's `INITIAL` never produces it) and the exact
 * `pendingSurahId`/`isLoading` combinations that decide the toggle's label.
 * Rendering the bar against a state object pins those directly. The
 * integrated tests in the same file leave `playerStub.value` null, so
 * `usePlayer()` falls through to the real provider.
 */
import { vi } from 'vitest';
import type { PlayerContextValue } from '../../src/player/PlayerProvider';

export const playerStub: { value: PlayerContextValue | null } = { value: null };

export function stubPlayer(overrides: Partial<PlayerContextValue> = {}): PlayerContextValue {
  return {
    surahId: 1,
    surahName: 'Al-Fatihah',
    ayah: 1,
    isPlaying: false,
    isLoading: false,
    error: null,
    pendingSurahId: null,
    play: vi.fn(async () => {}),
    toggle: vi.fn(),
    next: vi.fn(async () => {}),
    prev: vi.fn(async () => {}),
    attachViewer: vi.fn(() => () => {}),
    ...overrides,
  };
}

export function resetPlayerStub(): void {
  playerStub.value = null;
}
