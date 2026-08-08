import type { AyahTiming } from '@/lib/data/types';

export interface TimelinePosition {
  ayahIndex: number;
  localMs: number;
}

/**
 * Maps between whole-surah time and per-ayah audio time.
 *
 * Offsets start from the API's rounded integer-second durations and are
 * refined as each ayah's real duration becomes known.
 */
export class Timeline {
  private readonly durations: number[];
  private offsets: number[] = [];

  constructor(ayahs: AyahTiming[]) {
    this.durations = ayahs.map(a => a.durationMs);
    this.recomputeOffsets();
  }

  get count(): number {
    return this.durations.length;
  }

  get totalMs(): number {
    if (this.durations.length === 0) return 0;
    const last = this.durations.length - 1;
    return this.offsets[last] + this.durations[last];
  }

  globalToLocal(globalMs: number): TimelinePosition {
    if (this.durations.length === 0) return { ayahIndex: 0, localMs: 0 };
    if (globalMs <= 0) return { ayahIndex: 0, localMs: 0 };
    if (globalMs >= this.totalMs) {
      const last = this.durations.length - 1;
      return { ayahIndex: last, localMs: this.durations[last] };
    }

    // Binary search for the last offset <= globalMs.
    let lo = 0;
    let hi = this.offsets.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.offsets[mid] <= globalMs) lo = mid;
      else hi = mid - 1;
    }
    return { ayahIndex: lo, localMs: globalMs - this.offsets[lo] };
  }

  localToGlobal(ayahIndex: number, localMs: number): number {
    const i = Math.min(Math.max(ayahIndex, 0), this.durations.length - 1);
    return this.offsets[i] + localMs;
  }

  /**
   * Replaces an estimated duration with the real one.
   *
   * Only applied when the ayah lies ahead of the playhead, so the progress bar
   * cannot jump backward while the user is watching it.
   */
  setActualDuration(ayahIndex: number, durationMs: number, playheadAyahIndex: number): void {
    if (ayahIndex < playheadAyahIndex) return;
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    if (this.durations[ayahIndex] === durationMs) return;
    this.durations[ayahIndex] = durationMs;
    this.recomputeOffsets();
  }

  private recomputeOffsets(): void {
    let running = 0;
    this.offsets = this.durations.map(d => {
      const start = running;
      running += d;
      return start;
    });
  }
}
