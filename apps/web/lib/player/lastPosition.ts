import { isValidPosition, type LastPosition } from '@quran/core';

export type { LastPosition };

const KEY = 'quran.lastPosition';

/**
 * Never throws. A corrupt or absent entry reads as "no saved position" — the
 * home page must not break because of leftover storage from an older version.
 */
export function readLastPosition(): LastPosition | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidPosition(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeLastPosition(pos: Omit<LastPosition, 'updatedAt'>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...pos, updatedAt: Date.now() }));
  } catch {
    // Storage full or blocked (private browsing). Losing the bookmark is
    // acceptable; breaking playback is not.
  }
}

export function clearLastPosition(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
