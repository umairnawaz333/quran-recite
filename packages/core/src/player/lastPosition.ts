export interface LastPosition {
  surahId: number;
  ayah: number;
  localMs: number;
  updatedAt: number;
}

/**
 * Exported so it can be tested directly with real `NaN`/`Infinity` values.
 * Those values can never survive a `JSON.stringify`/`JSON.parse` round trip
 * (JSON has no representation for them — both serialise to `null`), so the
 * `Number.isFinite` branches below are unreachable via the localStorage-based
 * public API. Testing them requires calling this function directly.
 */
export function isValidPosition(value: unknown): value is LastPosition {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.surahId === 'number' && Number.isInteger(v.surahId) && v.surahId >= 1 && v.surahId <= 114 &&
    typeof v.ayah === 'number' && Number.isInteger(v.ayah) && v.ayah >= 1 &&
    typeof v.localMs === 'number' && Number.isFinite(v.localMs) && v.localMs >= 0 &&
    typeof v.updatedAt === 'number' && Number.isFinite(v.updatedAt)
  );
}
