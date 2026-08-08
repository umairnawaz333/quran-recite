import { describe, it, expect } from 'vitest';
import { normalizeAyah } from '../segments';
import type { RawSegment } from '../types';

const words = (...texts: string[]) =>
  texts.map((text, i) => ({ position: i + 1, text }));

describe('normalizeAyah — Case A, one segment per word', () => {
  // Real data: surah 1 ayah 1, AbdulBaset Murattal
  const segments: RawSegment[] = [
    [0, 1, 600, 970],
    [1, 2, 980, 1560],
    [2, 3, 1570, 2520],
    [3, 4, 2530, 3920],
  ];

  it('assigns each word its own timing verbatim', () => {
    const r = normalizeAyah({
      surah: 1,
      ayah: 1,
      words: words('بِسۡمِ', 'ٱللَّهِ', 'ٱلرَّحۡمَـٰنِ', 'ٱلرَّحِيمِ'),
      segments,
    });

    expect(r.timings).toHaveLength(4);
    expect(r.timings[0]).toEqual({
      id: '1:1:1', position: 1, startMs: 600, endMs: 970, estimated: false,
    });
    expect(r.timings[3]).toEqual({
      id: '1:1:4', position: 4, startMs: 2530, endMs: 3920, estimated: false,
    });
    expect(r.mergedGroups).toBe(0);
    expect(r.interpolatedWords).toBe(0);
  });

  it('preserves leading silence rather than snapping the first word to 0', () => {
    const r = normalizeAyah({
      surah: 1, ayah: 1,
      words: words('بِسۡمِ', 'ٱللَّهِ', 'ٱلرَّحۡمَـٰنِ', 'ٱلرَّحِيمِ'),
      segments,
    });
    expect(r.timings[0].startMs).toBe(600);
  });
});

describe('normalizeAyah — Case B, one segment covering several words', () => {
  // Real data: surah 1 ayah 4 — ALL three words in one segment
  it('splits proportionally by base-letter count and flags estimates', () => {
    const r = normalizeAyah({
      surah: 1,
      ayah: 4,
      words: words('مَـٰلِكِ', 'يَوۡمِ', 'ٱلدِّينِ'),
      segments: [[0, 3, 0, 4573]],
    });

    expect(r.timings).toHaveLength(3);
    expect(r.timings.every(t => t.estimated)).toBe(true);
    expect(new Set(r.timings.map(t => t.groupId)).size).toBe(1);

    // Contiguous, covering the whole segment
    expect(r.timings[0].startMs).toBe(0);
    expect(r.timings[2].endMs).toBe(4573);
    expect(r.timings[0].endMs).toBe(r.timings[1].startMs);
    expect(r.timings[1].endMs).toBe(r.timings[2].startMs);

    // Longer words get more time: مالك=4, يوم=3, الدين=5
    const d = r.timings.map(t => t.endMs - t.startMs);
    expect(d[2]).toBeGreaterThan(d[0]);
    expect(d[0]).toBeGreaterThan(d[1]);

    expect(r.mergedGroups).toBe(1);
    expect(r.interpolatedWords).toBe(3);
  });
});

describe('normalizeAyah — Case C, a word no segment covers', () => {
  // Real data shape: surah 2 ayah 23 skips word index 10
  it('absorbs the uncovered word into the preceding segment', () => {
    const r = normalizeAyah({
      surah: 2,
      ayah: 23,
      words: words('بِسُورَةٍ', 'مِّن', 'مِّثۡلِهِ'),
      segments: [
        [0, 1, 10920, 13960],
        // index 1 has no segment
        [2, 3, 13970, 14850],
      ],
    });

    expect(r.timings).toHaveLength(3);
    expect(r.timings.map(t => t.position)).toEqual([1, 2, 3]);
    expect(r.uncoveredWords).toBe(1);

    // Words 1 and 2 now share the first segment, split between them
    expect(r.timings[0].startMs).toBe(10920);
    expect(r.timings[1].endMs).toBe(13960);
    expect(r.timings[0].estimated).toBe(true);
    expect(r.timings[1].estimated).toBe(true);

    // Word 3 keeps its own exact timing
    expect(r.timings[2]).toEqual({
      id: '2:23:3', position: 3, startMs: 13970, endMs: 14850, estimated: false,
    });
  });

  it('absorbs into the FOLLOWING segment when the gap is at the ayah start', () => {
    const r = normalizeAyah({
      surah: 2, ayah: 99,
      words: words('وَلَقَدۡ', 'أَنزَلۡنَآ'),
      segments: [[1, 2, 500, 1500]],
    });

    expect(r.timings).toHaveLength(2);
    expect(r.timings[0].startMs).toBe(500);
    expect(r.timings[1].endMs).toBe(1500);
    expect(r.timings.every(t => t.estimated)).toBe(true);
  });
});

describe('normalizeAyah — post-conditions', () => {
  const cases: { name: string; input: Parameters<typeof normalizeAyah>[0] }[] = [
    {
      name: 'case A',
      input: {
        surah: 1, ayah: 1,
        words: words('بِسۡمِ', 'ٱللَّهِ', 'ٱلرَّحۡمَـٰنِ', 'ٱلرَّحِيمِ'),
        segments: [[0, 1, 600, 970], [1, 2, 980, 1560], [2, 3, 1570, 2520], [3, 4, 2530, 3920]],
      },
    },
    {
      name: 'case B',
      input: {
        surah: 1, ayah: 4,
        words: words('مَـٰلِكِ', 'يَوۡمِ', 'ٱلدِّينِ'),
        segments: [[0, 3, 0, 4573]] as RawSegment[],
      },
    },
  ];

  for (const { name, input } of cases) {
    it(`${name}: one entry per word, ascending, start < end, no overlap`, () => {
      const { timings } = normalizeAyah(input);
      expect(timings).toHaveLength(input.words.length);
      timings.forEach((t, i) => {
        expect(t.position).toBe(i + 1);
        expect(t.startMs).toBeLessThan(t.endMs);
        if (i > 0) expect(t.startMs).toBeGreaterThanOrEqual(timings[i - 1].endMs);
      });
    });
  }
});

describe('normalizeAyah — degenerate input', () => {
  it('returns no timings when the ayah has no segments at all', () => {
    const r = normalizeAyah({
      surah: 9, ayah: 1, words: words('ا', 'ب'), segments: [],
    });
    expect(r.timings).toEqual([]);
    expect(r.uncoveredWords).toBe(2);
  });

  it('returns no timings when the ayah has no words', () => {
    const r = normalizeAyah({ surah: 9, ayah: 1, words: [], segments: [] });
    expect(r.timings).toEqual([]);
  });
});
