const KEY = 'quran.lastPosition';

export interface LastPosition {
  surahId: number;
  ayah: number;
  localMs: number;
  updatedAt: number;
}

function isValid(value: unknown): value is LastPosition {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.surahId === 'number' && Number.isInteger(v.surahId) && v.surahId >= 1 && v.surahId <= 114 &&
    typeof v.ayah === 'number' && Number.isInteger(v.ayah) && v.ayah >= 1 &&
    typeof v.localMs === 'number' && Number.isFinite(v.localMs) && v.localMs >= 0 &&
    typeof v.updatedAt === 'number' && Number.isFinite(v.updatedAt)
  );
}

/**
 * Never throws. A corrupt or absent entry reads as "no saved position" — the
 * home page must not break because of leftover storage from an older version.
 */
export function readLastPosition(): LastPosition | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValid(parsed) ? parsed : null;
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
