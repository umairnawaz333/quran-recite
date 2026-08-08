import { describe, it, expect } from 'vitest';
import { Timeline } from '../timeline';
import type { AyahTiming } from '@/lib/data/types';

const ayah = (n: number, startOffsetMs: number, durationMs: number): AyahTiming => ({
  ayah: n, audioUrl: `/audio/x/${n}.mp3`, startOffsetMs, durationMs, words: [],
});

const build = () => new Timeline([
  ayah(1, 0, 4000),
  ayah(2, 4000, 5000),
  ayah(3, 9000, 4000),
]);

describe('Timeline', () => {
  it('reports total duration', () => {
    expect(build().totalMs).toBe(13000);
  });

  it('maps global time into the containing ayah', () => {
    const t = build();
    expect(t.globalToLocal(0)).toEqual({ ayahIndex: 0, localMs: 0 });
    expect(t.globalToLocal(3999)).toEqual({ ayahIndex: 0, localMs: 3999 });
    expect(t.globalToLocal(4000)).toEqual({ ayahIndex: 1, localMs: 0 });
    expect(t.globalToLocal(9500)).toEqual({ ayahIndex: 2, localMs: 500 });
  });

  it('clamps out-of-range input', () => {
    const t = build();
    expect(t.globalToLocal(-100)).toEqual({ ayahIndex: 0, localMs: 0 });
    expect(t.globalToLocal(99999)).toEqual({ ayahIndex: 2, localMs: 4000 });
  });

  it('maps local time back to global', () => {
    const t = build();
    expect(t.localToGlobal(1, 500)).toBe(4500);
    expect(t.localToGlobal(2, 0)).toBe(9000);
  });

  it('round-trips at every ayah boundary', () => {
    const t = build();
    for (let i = 0; i < 3; i += 1) {
      const g = t.localToGlobal(i, 0);
      expect(t.globalToLocal(g)).toEqual({ ayahIndex: i, localMs: 0 });
    }
  });

  it('corrects a duration and shifts later offsets', () => {
    const t = build();
    t.setActualDuration(1, 5500, 1);        // ayah 2 is really 5.5s
    expect(t.totalMs).toBe(13500);
    expect(t.localToGlobal(2, 0)).toBe(9500);
  });

  it('never rewrites offsets at or before the playhead', () => {
    const t = build();
    t.setActualDuration(0, 4800, 2);        // playhead already in ayah 3
    expect(t.localToGlobal(1, 0)).toBe(4000);  // unchanged
    expect(t.totalMs).toBe(13000);
  });

  it('ignores an out-of-range ayah index instead of sparsely growing durations', () => {
    const t = build();
    // A `loadedmetadata` event arriving with an index equal to (or past) the
    // array length must not corrupt totalMs / later offsets.
    t.setActualDuration(3, 9999, 0);
    expect(t.totalMs).toBe(13000);
    expect(t.localToGlobal(2, 0)).toBe(9000);

    t.setActualDuration(-1, 9999, 0);
    expect(t.totalMs).toBe(13000);
  });
});
