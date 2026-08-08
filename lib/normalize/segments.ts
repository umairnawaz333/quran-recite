import { countRecitationWeight } from './arabic';
import type {
  NormalizeInput, NormalizeResult, NormalizeWord, WordTiming,
} from './types';

/**
 * Converts Quran.com range-segments into exactly one timing per word.
 *
 * A segment is [startWordIndex, endWordIndexExclusive, startMs, endMs] — it may
 * cover several words, and some words may be covered by none.
 */
export function normalizeAyah(input: NormalizeInput): NormalizeResult {
  const { surah, ayah, words, segments } = input;
  const empty: NormalizeResult = {
    timings: [], mergedGroups: 0, interpolatedWords: 0, uncoveredWords: 0,
  };

  if (words.length === 0) return empty;
  if (segments.length === 0) return { ...empty, uncoveredWords: words.length };

  const ordered = [...segments].sort((a, b) => a[2] - b[2]);

  // Which segment owns each word index. -1 means uncovered.
  const owner = new Array<number>(words.length).fill(-1);
  ordered.forEach((seg, segIndex) => {
    const [start, end] = seg;
    for (let i = start; i < end && i < words.length; i += 1) {
      if (owner[i] === -1) owner[i] = segIndex;
    }
  });

  const uncoveredWords = owner.filter(o => o === -1).length;

  // Case C: attach uncovered words to the preceding segment, or the following
  // one when the gap sits at the start of the ayah.
  for (let i = 0; i < owner.length; i += 1) {
    if (owner[i] !== -1) continue;
    let adopted = -1;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (owner[j] !== -1) { adopted = owner[j]; break; }
    }
    if (adopted === -1) {
      for (let j = i + 1; j < owner.length; j += 1) {
        if (owner[j] !== -1) { adopted = owner[j]; break; }
      }
    }
    if (adopted === -1) return { ...empty, uncoveredWords: words.length };
    owner[i] = adopted;
  }

  // Group consecutive word indices by owning segment.
  const groups: { segIndex: number; indices: number[] }[] = [];
  owner.forEach((segIndex, i) => {
    const last = groups[groups.length - 1];
    if (last && last.segIndex === segIndex) last.indices.push(i);
    else groups.push({ segIndex, indices: [i] });
  });

  const timings: WordTiming[] = [];
  let mergedGroups = 0;
  let interpolatedWords = 0;

  for (const group of groups) {
    const [, , startMs, endMs] = ordered[group.segIndex];

    if (group.indices.length === 1) {
      const i = group.indices[0];
      timings.push({
        id: wordId(surah, ayah, words[i]),
        position: words[i].position,
        startMs,
        endMs,
        estimated: false,
      });
      continue;
    }

    mergedGroups += 1;
    interpolatedWords += group.indices.length;
    const groupId = `${surah}:${ayah}:g${group.segIndex}`;
    timings.push(
      ...apportion(group.indices.map(i => words[i]), startMs, endMs, surah, ayah, groupId),
    );
  }

  timings.sort((a, b) => a.position - b.position);
  return { timings, mergedGroups, interpolatedWords, uncoveredWords };
}

/**
 * Splits one segment's duration across several words, weighted by recitation
 * weight (base letters plus elongation marks — a long vowel takes real time
 * to recite). Every resulting timing is flagged `estimated` — sub-word timing
 * does not exist in the source data, so this is interpolation, not measurement.
 */
function apportion(
  groupWords: NormalizeWord[],
  startMs: number,
  endMs: number,
  surah: number,
  ayah: number,
  groupId: string,
): WordTiming[] {
  const weights = groupWords.map(w => Math.max(countRecitationWeight(w.text), 1));
  const total = weights.reduce((sum, w) => sum + w, 0);
  const span = endMs - startMs;

  let cursor = startMs;
  return groupWords.map((word, i) => {
    const isLast = i === groupWords.length - 1;
    // The last word absorbs rounding so the group ends exactly on endMs.
    const wordEnd = isLast
      ? endMs
      : cursor + Math.round((span * weights[i]) / total);
    const timing: WordTiming = {
      id: wordId(surah, ayah, word),
      position: word.position,
      startMs: cursor,
      endMs: wordEnd,
      estimated: true,
      groupId,
    };
    cursor = wordEnd;
    return timing;
  });
}

function wordId(surah: number, ayah: number, word: NormalizeWord): string {
  return `${surah}:${ayah}:${word.position}`;
}
