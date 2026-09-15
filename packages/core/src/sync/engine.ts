import type { WordTiming } from '../normalize/types';

/**
 * Binary search for the word whose [startMs, endMs) contains localMs.
 * Returns -1 when the time falls in silence before, between, or after words.
 *
 * This is the platform-free half of word-sync: the frame-scheduling half
 * (`SyncEngine`) needs `requestAnimationFrame`, which is a browser global
 * Node does not provide, so it lives in the web app instead
 * (apps/web/lib/sync/engine.ts) and imports this function from here.
 */
export function findActiveWordIndex(words: WordTiming[], localMs: number): number {
  let lo = 0;
  let hi = words.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const w = words[mid];
    if (localMs < w.startMs) hi = mid - 1;
    else if (localMs >= w.endMs) lo = mid + 1;
    else return mid;
  }
  return -1;
}
