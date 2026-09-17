import { File, Paths } from 'expo-file-system';
import { isValidPosition, type LastPosition } from '@quran/core';

export type { LastPosition };

/**
 * Where the user left off, so the bar can offer "continue from here" on the
 * next launch instead of always Al-Fatihah 1:1. Mirrors the web's
 * `apps/web/lib/player/lastPosition.ts`, with a JSON file in the app's
 * document directory standing in for `localStorage`. Validation is the
 * shared `isValidPosition` from core, so a corrupt or stale file from an
 * older version reads as "no saved position" on both platforms alike.
 */
const FILE_NAME = 'lastPosition.json';

function positionFile(): File {
  return new File(Paths.document, FILE_NAME);
}

/** Never throws: any failure reads as "nothing saved". */
export async function readLastPosition(): Promise<LastPosition | null> {
  try {
    const file = positionFile();
    if (!file.exists) return null;
    const parsed: unknown = JSON.parse(await file.text());
    return isValidPosition(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Never throws: losing the bookmark is acceptable, breaking playback is not. */
export function writeLastPosition(pos: Omit<LastPosition, 'updatedAt'>): void {
  try {
    const file = positionFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify({ ...pos, updatedAt: Date.now() }));
  } catch {
    // Disk full, or the document directory unavailable — ignore.
  }
}
