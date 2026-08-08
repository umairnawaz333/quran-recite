import type { WordTiming } from '@/lib/normalize/types';

export type ActiveWordListener = (wordId: string | null) => void;
export type Unsubscribe = () => void;

/**
 * Binary search for the word whose [startMs, endMs) contains localMs.
 * Returns -1 when the time falls in silence before, between, or after words.
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

/**
 * Drives word highlighting from audio position.
 *
 * Uses requestAnimationFrame rather than the `timeupdate` event, which fires
 * only about four times a second — far too coarse for the 50–100 ms accuracy
 * target. Listeners are notified only when the active word actually changes,
 * so a 60 fps loop produces a couple of updates per second.
 */
export class SyncEngine {
  private listeners = new Set<ActiveWordListener>();
  private words: WordTiming[] = [];
  private getTimeMs: (() => number) | null = null;
  private rafId: number | null = null;
  private lastEmitted: string | null | undefined = undefined;

  onChange(listener: ActiveWordListener): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  attach(getTimeMs: () => number, words: WordTiming[]): void {
    this.getTimeMs = getTimeMs;
    this.words = words;
    this.lastEmitted = undefined;
    this.schedule();
  }

  /** Swaps the timing set without restarting the loop (used at ayah changes). */
  setWords(words: WordTiming[]): void {
    this.words = words;
    this.lastEmitted = undefined;
  }

  detach(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.getTimeMs = null;
    this.lastEmitted = undefined;
  }

  private schedule(): void {
    this.rafId = requestAnimationFrame(() => this.step());
  }

  private step(): void {
    if (!this.getTimeMs) return;

    const index = findActiveWordIndex(this.words, this.getTimeMs());
    const id = index === -1 ? null : this.words[index].id;

    if (id !== this.lastEmitted) {
      this.lastEmitted = id;
      this.listeners.forEach(listener => listener(id));
    }

    this.schedule();
  }
}
