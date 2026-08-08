# Quran Word-by-Word Highlighting — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working Quran reader for Surah Al-Fatihah where pressing play once recites the whole surah while the currently recited word highlights in real time, in either Tajweed or IndoPak script.

**Architecture:** A Next.js static-export app with zero runtime third-party dependencies. All Quran text, word timings, and audio are fetched once by a build-time script and committed to the repository. The synchronization engine is pure TypeScript with no React imports, driven by `requestAnimationFrame`, and updates the highlight by toggling classes on two DOM nodes rather than re-rendering React.

**Tech Stack:** Next.js 15 (App Router, `output: 'export'`), React 19, TypeScript, Tailwind CSS v4, Vitest + @testing-library/react + jsdom.

**Spec:** `docs/superpowers/specs/2026-08-09-quran-word-highlighting-design.md`

## Global Constraints

- **Reciter:** AbdulBaset AbdulSamad, Murattal — Quran.com recitation id `2`, directory slug `abdulbasit-murattal`.
- **Phase 1 data scope:** Surah 1 (Al-Fatihah) only. All 113 other surahs render as unavailable in the surah list.
- **No runtime third-party calls.** Quran.com is a build-time source only. No component may reference `verses.quran.com` or `api.quran.com`.
- **`lib/sync/` must not import React.** It is pure TypeScript, testable standalone.
- **Highlight must be a background treatment, never a foreground color change** — tajweed rules own the text color.
- **The surah must not re-render during playback.** Highlight changes go through direct DOM class toggles via a ref map.
- **Sync driver is `requestAnimationFrame`, never the `timeupdate` event** (`timeupdate` fires ~4 Hz, too coarse for the 50–100 ms accuracy target).
- **Segment format is `[startWordIndex, endWordIndexExclusive, startMs, endMs]`** — a word *range*, not one entry per word.
- **Word timings are local to their own ayah's audio file** (each file starts at 0). `startOffsetMs` maps an ayah into the global surah timeline.
- **Audio files are copied byte-for-byte, never re-encoded** — encoder delay would shift sync by tens of milliseconds.
- **Git identity:** `umairnawaz333 <umair.nawaz1997@gmail.com>` (already configured locally).
- **Node:** 20+. Package manager: `npm`.

### Spec refinement

The spec's §3 places the normalizer at `scripts/normalize-segments.ts`. This plan puts it at `lib/normalize/segments.ts` instead, so both the build script and the test suite import it from one place. Everything else follows the spec's structure.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/normalize/types.ts` | Shared data types for timings and words |
| `lib/normalize/arabic.ts` | Base-letter counting (diacritic stripping) |
| `lib/normalize/segments.ts` | Converts range-segments to one timing per word |
| `lib/sync/timeline.ts` | Global surah time ⇄ (ayah, local time) mapping |
| `lib/sync/engine.ts` | rAF loop + binary search → active word id |
| `lib/audio/playlist.ts` | Double-buffered ayah playlist, continuous playback |
| `lib/data/loaders.ts` | Loads committed JSON for a surah |
| `lib/data/audioUrl.ts` | Single point resolving an ayah to its audio path |
| `scripts/fetch-quran-data.ts` | Build-time fetch: text, timings, audio downloads |
| `scripts/fetch-fonts.ts` | Downloads the two OFL fonts as woff2 |
| `components/QuranWord.tsx` | One word span; registers itself in the ref map |
| `components/AyahBlock.tsx` | One ayah: words, number, play button |
| `components/QuranReader.tsx` | Renders the surah; owns the word ref map |
| `components/AudioPlayer.tsx` | Transport controls |
| `components/ProgressBar.tsx` | Whole-surah scrub bar |
| `components/ScriptToggle.tsx` | Tajweed ⇄ IndoPak switch |
| `components/JumpToAyahPill.tsx` | Auto-scroll override affordance |
| `app/page.tsx` | Surah list |
| `app/surah/[id]/page.tsx` | Reader page |
| `app/surah/[id]/SurahClient.tsx` | Client component wiring player + reader |
| `app/globals.css` | Fonts, tajweed palette, highlight styles |

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `postcss.config.mjs`
- Test: `lib/__tests__/smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: a buildable Next.js static-export app and a working `npm test`

- [ ] **Step 1: Create the Next.js app**

```bash
npx create-next-app@latest . \
  --typescript --tailwind --eslint --app \
  --src-dir=false --import-alias "@/*" --use-npm --yes
```

If it refuses because the directory is non-empty, answer yes to proceed — the existing `docs/`, `.git/`, and the PRD markdown file must be preserved.

- [ ] **Step 2: Configure static export**

Replace `next.config.ts`:

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
```

- [ ] **Step 3: Install and configure Vitest**

```bash
npm install -D vitest @vitejs/plugin-react jsdom \
  @testing-library/react @testing-library/dom @testing-library/jest-dom
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
```

Create `vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest",
"fetch:data": "npx tsx scripts/fetch-quran-data.ts",
"fetch:fonts": "npx tsx scripts/fetch-fonts.ts"
```

Install `tsx`:

```bash
npm install -D tsx
```

- [ ] **Step 4: Write a smoke test**

Create `lib/__tests__/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('test harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Verify test and build both pass**

Run: `npm test`
Expected: 1 passing test.

Run: `npm run build`
Expected: build succeeds and produces an `out/` directory.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js static-export app with Vitest"
```

---

## Task 2: Arabic base-letter counting

**Files:**
- Create: `lib/normalize/arabic.ts`
- Test: `lib/normalize/__tests__/arabic.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `countBaseLetters(text: string): number` — used by Task 3 to split merged segments proportionally

Diacritics are stripped before counting because they do not consume recitation time. A word's *letters* approximate how long it takes to recite; its vowel marks do not.

- [ ] **Step 1: Write the failing test**

Create `lib/normalize/__tests__/arabic.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { countBaseLetters } from '../arabic';

describe('countBaseLetters', () => {
  it('counts plain letters', () => {
    expect(countBaseLetters('بسم')).toBe(3);
  });

  it('ignores fatha, kasra, sukun and shadda', () => {
    // بِسْمِ — 3 letters, 3 marks
    expect(countBaseLetters('بِسْمِ')).toBe(3);
  });

  it('ignores superscript alef and Quranic annotation marks', () => {
    // ٱلرَّحۡمَـٰنِ — hamzat wasl + ل ر ح م ـٰ ن
    expect(countBaseLetters('ٱلرَّحۡمَـٰنِ')).toBe(6);
  });

  it('ignores tatweel', () => {
    expect(countBaseLetters('بــســم')).toBe(3);
  });

  it('strips HTML tajweed rule markup before counting', () => {
    expect(countBaseLetters('<rule class=ham_wasl>ٱ</rule>للَّهِ')).toBe(4);
  });

  it('returns 0 for an empty string', () => {
    expect(countBaseLetters('')).toBe(0);
  });

  it('never returns 0 for a string containing only marks', () => {
    expect(countBaseLetters('ِّ')).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/normalize/__tests__/arabic.test.ts`
Expected: FAIL — cannot resolve `../arabic`.

- [ ] **Step 3: Implement**

Create `lib/normalize/arabic.ts`:

```ts
/**
 * Arabic marks that do not represent a recited letter.
 * - U+064B–U+0652: tanween, harakat, shadda, sukun
 * - U+0653–U+0655: maddah and hamza above/below
 * - U+0670: superscript (dagger) alef
 * - U+06D6–U+06ED: Quranic annotation marks (small high seen, sajdah, etc.)
 * - U+0640: tatweel (kashida) — a stretching glyph, not a letter
 */
const NON_LETTER_MARKS = /[ً-ٰٕۖ-ۭـ]/g;

const HTML_TAG = /<[^>]*>/g;

/**
 * Counts recited base letters, ignoring diacritics and markup.
 * Used to apportion a merged audio segment across the words it covers.
 */
export function countBaseLetters(text: string): number {
  return text
    .replace(HTML_TAG, '')
    .replace(NON_LETTER_MARKS, '')
    .replace(/\s+/g, '').length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/normalize/__tests__/arabic.test.ts`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/normalize/arabic.ts lib/normalize/__tests__/arabic.test.ts
git commit -m "feat: add Arabic base-letter counting for segment apportioning"
```

---

## Task 3: The segment normalizer

This is the highest-value task in the plan. Every downstream feature depends on it being correct.

**Files:**
- Create: `lib/normalize/types.ts`, `lib/normalize/segments.ts`
- Test: `lib/normalize/__tests__/segments.test.ts`

**Interfaces:**
- Consumes: `countBaseLetters` from Task 2
- Produces:
  - `type RawSegment = [number, number, number, number]`
  - `interface WordTiming { id: string; position: number; startMs: number; endMs: number; estimated: boolean; groupId?: string }`
  - `interface NormalizeInput { surah: number; ayah: number; words: NormalizeWord[]; segments: RawSegment[] }`
  - `interface NormalizeResult { timings: WordTiming[]; mergedGroups: number; interpolatedWords: number; uncoveredWords: number }`
  - `function normalizeAyah(input: NormalizeInput): NormalizeResult`

### The three cases

- **Case A** — segment covers one word (`b - a === 1`). Direct assignment, `estimated: false`.
- **Case B** — segment covers multiple words (`b - a > 1`), e.g. `1:4 → [[0, 3, 0, 4573]]`. Duration is split proportionally by base-letter count. All words get `estimated: true` and a shared `groupId`.
- **Case C** — a word no segment covers, e.g. `2:23` index 10. It is absorbed into the *preceding* segment's group (or the following one if it is at the ayah's start), which is then re-split by Case B's rule.

- [ ] **Step 1: Write the types**

Create `lib/normalize/types.ts`:

```ts
/** [startWordIndex, endWordIndexExclusive, startMs, endMs] — a word RANGE. */
export type RawSegment = [number, number, number, number];

export interface NormalizeWord {
  /** 1-based position within the ayah. */
  position: number;
  /** Text used for proportional splitting. Tajweed markup is fine; it is stripped. */
  text: string;
}

export interface WordTiming {
  /** "surah:ayah:position", e.g. "1:4:2" */
  id: string;
  position: number;
  startMs: number;
  endMs: number;
  /** True when the timing was interpolated rather than read from the source. */
  estimated: boolean;
  /** Present when this word shares a source segment with its neighbours. */
  groupId?: string;
}

export interface NormalizeInput {
  surah: number;
  ayah: number;
  words: NormalizeWord[];
  segments: RawSegment[];
}

export interface NormalizeResult {
  timings: WordTiming[];
  mergedGroups: number;
  interpolatedWords: number;
  uncoveredWords: number;
}
```

- [ ] **Step 2: Write the failing tests using real captured API data**

Create `lib/normalize/__tests__/segments.test.ts`:

```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run lib/normalize/__tests__/segments.test.ts`
Expected: FAIL — cannot resolve `../segments`.

- [ ] **Step 4: Implement the normalizer**

Create `lib/normalize/segments.ts`:

```ts
import { countBaseLetters } from './arabic';
import type {
  NormalizeInput, NormalizeResult, NormalizeWord, RawSegment, WordTiming,
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
 * Splits one segment's duration across several words, weighted by base-letter
 * count. Every resulting timing is flagged `estimated` — sub-word timing does
 * not exist in the source data, so this is interpolation, not measurement.
 */
function apportion(
  groupWords: NormalizeWord[],
  startMs: number,
  endMs: number,
  surah: number,
  ayah: number,
  groupId: string,
): WordTiming[] {
  const weights = groupWords.map(w => Math.max(countBaseLetters(w.text), 1));
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/normalize/__tests__/segments.test.ts`
Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add lib/normalize
git commit -m "feat: normalize range-segments into one timing per word

Handles the three real cases found in the Quran.com data: one segment per
word, one segment covering several words (1:4), and words no segment covers
(2:23). Interpolated timings are flagged so the UI can signal them."
```

---

## Task 4: Font download script

**Files:**
- Create: `scripts/fetch-fonts.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing
- Produces: `public/fonts/amiri-quran.woff2`, `public/fonts/noto-naskh-arabic.woff2`

Both fonts are SIL Open Font License, so they are committed to the repository.

- [ ] **Step 1: Write the script**

Create `scripts/fetch-fonts.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Google Fonts serves woff2 only when the UA looks like a modern browser. */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FONTS = [
  { family: 'Amiri Quran', file: 'amiri-quran.woff2' },
  { family: 'Noto Naskh Arabic', file: 'noto-naskh-arabic.woff2' },
];

const OUT_DIR = path.join(process.cwd(), 'public', 'fonts');

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  for (const font of FONTS) {
    const cssUrl =
      `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.family)}` +
      `&display=swap&subset=arabic`;

    const css = await fetch(cssUrl, { headers: { 'User-Agent': UA } }).then(r => {
      if (!r.ok) throw new Error(`CSS fetch failed for ${font.family}: ${r.status}`);
      return r.text();
    });

    const urls = [...css.matchAll(/url\((https:[^)]+\.woff2)\)/g)].map(m => m[1]);
    if (urls.length === 0) throw new Error(`No woff2 URL found for ${font.family}`);

    // The arabic subset is the largest; take it rather than the latin fallback.
    const buffers = await Promise.all(
      urls.map(u => fetch(u).then(r => r.arrayBuffer())),
    );
    const largest = buffers.reduce((a, b) => (b.byteLength > a.byteLength ? b : a));

    const dest = path.join(OUT_DIR, font.file);
    await writeFile(dest, Buffer.from(largest));
    console.log(`${font.family} -> ${font.file} (${(largest.byteLength / 1024).toFixed(0)} KB)`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `npm run fetch:fonts`
Expected: two files written, each printing a KB size greater than 20.

- [ ] **Step 3: Verify the files exist and are real woff2**

Run: `ls -la public/fonts/ && file public/fonts/*.woff2`
Expected: both files listed, `file` reporting Web Open Font Format.

- [ ] **Step 4: Commit**

```bash
git add scripts/fetch-fonts.ts public/fonts
git commit -m "feat: add OFL Quran fonts (Amiri Quran, Noto Naskh Arabic)"
```

---

## Task 5: The build-time fetch script

**Files:**
- Create: `scripts/fetch-quran-data.ts`
- Create: `lib/data/types.ts`

**Interfaces:**
- Consumes: `normalizeAyah` from Task 3
- Produces: committed data files, and these types used by every later task:
  - `interface SurahMeta { id: number; nameArabic: string; nameSimple: string; nameEnglish: string; ayahCount: number; revelationPlace: string; available: boolean }`
  - `interface SurahWord { id: string; position: number; tajweed: string; indopak: string }`
  - `interface SurahText { surah: number; ayahs: { ayah: number; words: SurahWord[] }[] }`
  - `interface AyahTiming { ayah: number; audioUrl: string; startOffsetMs: number; durationMs: number; words: WordTiming[] }`
  - `interface SurahTimings { surah: number; reciterId: string; surahDurationMs: number; ayahs: AyahTiming[] }`

- [ ] **Step 1: Define the data types**

Create `lib/data/types.ts`:

```ts
import type { WordTiming } from '@/lib/normalize/types';

export interface SurahMeta {
  id: number;
  nameArabic: string;
  nameSimple: string;
  nameEnglish: string;
  ayahCount: number;
  revelationPlace: string;
  /** False until this surah's data has been fetched. */
  available: boolean;
}

export interface SurahWord {
  /** "surah:ayah:position" */
  id: string;
  position: number;
  /** Tajweed markup, may contain <rule class="..."> elements. */
  tajweed: string;
  indopak: string;
}

export interface SurahText {
  surah: number;
  ayahs: { ayah: number; words: SurahWord[] }[];
}

export interface AyahTiming {
  ayah: number;
  /** Local path, e.g. "/audio/abdulbasit-murattal/001001.mp3". */
  audioUrl: string;
  /** Where this ayah begins on the global surah timeline. */
  startOffsetMs: number;
  /** Seeded from the API's integer seconds; corrected at runtime. */
  durationMs: number;
  words: WordTiming[];
}

export interface SurahTimings {
  surah: number;
  reciterId: string;
  surahDurationMs: number;
  ayahs: AyahTiming[];
}

export type { WordTiming };
```

- [ ] **Step 2: Write the fetch script**

Create `scripts/fetch-quran-data.ts`:

```ts
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { normalizeAyah } from '../lib/normalize/segments';
import type { RawSegment } from '../lib/normalize/types';
import type {
  AyahTiming, SurahMeta, SurahText, SurahTimings, SurahWord,
} from '../lib/data/types';

const API = 'https://api.quran.com/api/v4';
const RECITATION_ID = 2;                    // AbdulBaset AbdulSamad, Murattal
const RECITER_SLUG = 'abdulbasit-murattal';
const AUDIO_HOST = 'https://verses.quran.com/';
const UA = 'quran-word-sync-build-script';

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'data');
const AUDIO_DIR = path.join(ROOT, 'public', 'audio', RECITER_SLUG);

async function api<T>(pathname: string): Promise<T> {
  const res = await fetch(`${API}${pathname}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${pathname}`);
  return res.json() as Promise<T>;
}

/** Walks a paginated endpoint and returns every item. */
async function paginate<T>(
  build: (page: number) => string,
  pick: (body: any) => T[],
): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  for (;;) {
    const body = await api<any>(build(page));
    out.push(...pick(body));
    const next = body.pagination?.next_page;
    if (!next) return out;
    page = next;
  }
}

function parseSurahArg(): number[] {
  const arg = process.argv.slice(2).find(a => a.startsWith('--surahs='))?.split('=')[1]
    ?? process.argv[process.argv.indexOf('--surahs') + 1];
  if (!arg) return [1];
  if (arg.includes('-')) {
    const [from, to] = arg.split('-').map(Number);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }
  return arg.split(',').map(Number);
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

/** Downloads one MP3 byte-for-byte. Skips files already on disk. */
async function downloadAudio(remotePath: string): Promise<string> {
  const filename = remotePath.split('/').pop()!;
  const dest = path.join(AUDIO_DIR, filename);
  if (!(await exists(dest))) {
    const res = await fetch(AUDIO_HOST + remotePath, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`audio ${res.status} for ${remotePath}`);
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  }
  return `/audio/${RECITER_SLUG}/${filename}`;
}

async function fetchSurahMeta(): Promise<Omit<SurahMeta, 'available'>[]> {
  const body = await api<any>('/chapters?language=en');
  return body.chapters.map((c: any) => ({
    id: c.id,
    nameArabic: c.name_arabic,
    nameSimple: c.name_simple,
    nameEnglish: c.translated_name.name,
    ayahCount: c.verses_count,
    revelationPlace: c.revelation_place,
  }));
}

async function buildSurah(surah: number) {
  // 1. Words, both scripts
  const verses = await paginate<any>(
    p => `/verses/by_chapter/${surah}?words=true&per_page=50&page=${p}` +
         `&word_fields=text_uthmani_tajweed,text_indopak`,
    b => b.verses,
  );

  // 2. Segments and durations for this reciter
  const audioFiles = await paginate<any>(
    p => `/recitations/${RECITATION_ID}/by_chapter/${surah}?per_page=50&page=${p}` +
         `&fields=segments,duration`,
    b => b.audio_files,
  );
  const byKey = new Map(audioFiles.map(f => [f.verse_key, f]));

  const text: SurahText = { surah, ayahs: [] };
  const ayahTimings: AyahTiming[] = [];
  const report = { surah, ayahs: 0, mergedGroups: 0, interpolatedWords: 0, uncoveredWords: 0, untimedAyahs: [] as number[] };

  let offset = 0;

  for (const verse of verses) {
    const ayah = verse.verse_number as number;
    const words = (verse.words as any[])
      .filter(w => w.char_type_name === 'word')
      .map((w): SurahWord => ({
        id: `${surah}:${ayah}:${w.position}`,
        position: w.position,
        tajweed: w.text_uthmani_tajweed ?? '',
        indopak: w.text_indopak ?? '',
      }));

    text.ayahs.push({ ayah, words });

    const file = byKey.get(`${surah}:${ayah}`);
    if (!file) throw new Error(`no audio entry for ${surah}:${ayah}`);

    const result = normalizeAyah({
      surah,
      ayah,
      words: words.map(w => ({ position: w.position, text: w.tajweed })),
      segments: (file.segments ?? []) as RawSegment[],
    });

    report.ayahs += 1;
    report.mergedGroups += result.mergedGroups;
    report.interpolatedWords += result.interpolatedWords;
    report.uncoveredWords += result.uncoveredWords;
    if (result.timings.length === 0) report.untimedAyahs.push(ayah);

    const durationMs = Math.round((file.duration ?? 0) * 1000);
    const audioUrl = await downloadAudio(file.url);

    ayahTimings.push({ ayah, audioUrl, startOffsetMs: offset, durationMs, words: result.timings });
    offset += durationMs;

    process.stdout.write(`\r  ${surah}:${ayah} `);
  }

  const timings: SurahTimings = {
    surah,
    reciterId: RECITER_SLUG,
    surahDurationMs: offset,
    ayahs: ayahTimings,
  };

  await writeFile(path.join(DATA, 'text', `${surah}.json`), JSON.stringify(text));
  await writeFile(
    path.join(DATA, 'timings', RECITER_SLUG, `${surah}.json`),
    JSON.stringify(timings),
  );

  console.log(`\n  surah ${surah}: ${report.ayahs} ayahs, ` +
    `${report.mergedGroups} merged groups, ${report.uncoveredWords} uncovered words`);
  return report;
}

async function main() {
  const surahs = parseSurahArg();
  console.log(`Fetching surahs: ${surahs.join(', ')}`);

  await mkdir(path.join(DATA, 'text'), { recursive: true });
  await mkdir(path.join(DATA, 'timings', RECITER_SLUG), { recursive: true });
  await mkdir(AUDIO_DIR, { recursive: true });

  const meta = await fetchSurahMeta();
  const reports = [];
  for (const surah of surahs) reports.push(await buildSurah(surah));

  const fetched = new Set(surahs);
  const withAvailability: SurahMeta[] = meta.map(m => ({ ...m, available: fetched.has(m.id) }));

  await writeFile(path.join(DATA, 'surahs.json'), JSON.stringify(withAvailability, null, 2));
  await writeFile(
    path.join(DATA, 'reciters.json'),
    JSON.stringify([{ id: RECITER_SLUG, name: 'AbdulBaset AbdulSamad', style: 'Murattal' }], null, 2),
  );
  await writeFile(
    path.join(DATA, 'validation-report.json'),
    JSON.stringify(reports, null, 2),
  );

  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Run it for Surah 1**

Run: `npm run fetch:data -- --surahs=1`
Expected output includes: `surah 1: 7 ayahs, 1 merged groups, 0 uncovered words`

The single merged group is `1:4`, exactly as measured during design.

- [ ] **Step 4: Verify the output**

Run:

```bash
ls public/audio/abdulbasit-murattal/ | wc -l   # expect 7
du -sh public/audio/abdulbasit-murattal/       # expect ~1.0M
cat data/validation-report.json
node -e "const t=require('./data/timings/abdulbasit-murattal/1.json');
console.log('total ms', t.surahDurationMs);
console.log('ayah 4 words', JSON.stringify(t.ayahs[3].words, null, 1));"
```

Expected: 7 files, ~1 MB, and ayah 4's three words all showing `"estimated": true` with a shared `groupId`.

- [ ] **Step 5: Commit script and data together**

```bash
git add scripts/fetch-quran-data.ts lib/data/types.ts data public/audio
git commit -m "feat: fetch and commit Al-Fatihah text, timings and audio

Build-time only. Surah 1 yields one merged segment (1:4) and no uncovered
words, matching the measurements taken during design."
```

---

## Task 6: The timeline

**Files:**
- Create: `lib/sync/timeline.ts`
- Test: `lib/sync/__tests__/timeline.test.ts`

**Interfaces:**
- Consumes: `AyahTiming` from Task 5
- Produces:
  - `class Timeline` with `totalMs`, `globalToLocal(ms)`, `localToGlobal(ayahIndex, localMs)`, `setActualDuration(ayahIndex, durationMs, playheadAyahIndex)`

Durations are seeded from the API's integer seconds and corrected as real audio loads. Corrections apply only *ahead* of the playhead so the progress bar never jumps backward under the user.

- [ ] **Step 1: Write the failing test**

Create `lib/sync/__tests__/timeline.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/sync/__tests__/timeline.test.ts`
Expected: FAIL — cannot resolve `../timeline`.

- [ ] **Step 3: Implement**

Create `lib/sync/timeline.ts`:

```ts
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
    if (ayahIndex <= playheadAyahIndex) return;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/sync/__tests__/timeline.test.ts`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/sync/timeline.ts lib/sync/__tests__/timeline.test.ts
git commit -m "feat: add surah timeline with forward-only duration correction"
```

---

## Task 7: The sync engine

**Files:**
- Create: `lib/sync/engine.ts`
- Test: `lib/sync/__tests__/engine.test.ts`

**Interfaces:**
- Consumes: `WordTiming` from Task 3
- Produces:
  - `function findActiveWordIndex(words: WordTiming[], localMs: number): number` — returns `-1` when no word is active
  - `class SyncEngine` with `attach(getTimeMs, words)`, `onChange(cb): () => void`, `detach()`

- [ ] **Step 1: Write the failing test**

Create `lib/sync/__tests__/engine.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { findActiveWordIndex, SyncEngine } from '../engine';
import type { WordTiming } from '@/lib/normalize/types';

const t = (position: number, startMs: number, endMs: number): WordTiming => ({
  id: `1:1:${position}`, position, startMs, endMs, estimated: false,
});

// Real Al-Fatihah 1:1 timings
const WORDS = [t(1, 600, 970), t(2, 980, 1560), t(3, 1570, 2520), t(4, 2530, 3920)];

describe('findActiveWordIndex', () => {
  it('finds the word containing the time', () => {
    expect(findActiveWordIndex(WORDS, 700)).toBe(0);
    expect(findActiveWordIndex(WORDS, 2000)).toBe(2);
  });

  it('is inclusive of startMs and exclusive of endMs', () => {
    expect(findActiveWordIndex(WORDS, 600)).toBe(0);
    expect(findActiveWordIndex(WORDS, 970)).toBe(-1);   // in the gap
    expect(findActiveWordIndex(WORDS, 980)).toBe(1);
  });

  it('returns -1 before the first word (leading silence)', () => {
    expect(findActiveWordIndex(WORDS, 0)).toBe(-1);
    expect(findActiveWordIndex(WORDS, 599)).toBe(-1);
  });

  it('returns -1 after the last word', () => {
    expect(findActiveWordIndex(WORDS, 3920)).toBe(-1);
    expect(findActiveWordIndex(WORDS, 99999)).toBe(-1);
  });

  it('returns -1 for an empty timing list', () => {
    expect(findActiveWordIndex([], 100)).toBe(-1);
  });
});

describe('SyncEngine', () => {
  let raf: ReturnType<typeof vi.spyOn>;
  let frame: FrameRequestCallback | null = null;

  beforeEach(() => {
    frame = null;
    raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(cb => {
      frame = cb;
      return 1;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  const tick = () => frame?.(0);

  it('emits the active word id when it changes', () => {
    let now = 700;
    const engine = new SyncEngine();
    const seen: (string | null)[] = [];
    engine.onChange(id => seen.push(id));
    engine.attach(() => now, WORDS);

    tick();
    now = 2000;
    tick();

    expect(seen).toEqual(['1:1:1', '1:1:3']);
    engine.detach();
  });

  it('does not re-emit while the same word stays active', () => {
    let now = 700;
    const engine = new SyncEngine();
    const cb = vi.fn();
    engine.onChange(cb);
    engine.attach(() => now, WORDS);

    tick();
    now = 800;
    tick();
    now = 900;
    tick();

    expect(cb).toHaveBeenCalledTimes(1);
    engine.detach();
  });

  it('emits null when playback enters a gap', () => {
    let now = 700;
    const engine = new SyncEngine();
    const seen: (string | null)[] = [];
    engine.onChange(id => seen.push(id));
    engine.attach(() => now, WORDS);

    tick();
    now = 975;   // between words
    tick();

    expect(seen).toEqual(['1:1:1', null]);
    engine.detach();
  });

  it('stops scheduling frames after detach', () => {
    const engine = new SyncEngine();
    engine.attach(() => 700, WORDS);
    const before = raf.mock.calls.length;
    engine.detach();
    tick();
    expect(raf.mock.calls.length).toBe(before);
  });

  it('unsubscribing stops delivery', () => {
    let now = 700;
    const engine = new SyncEngine();
    const cb = vi.fn();
    const off = engine.onChange(cb);
    engine.attach(() => now, WORDS);
    off();
    tick();
    expect(cb).not.toHaveBeenCalled();
    engine.detach();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/sync/__tests__/engine.test.ts`
Expected: FAIL — cannot resolve `../engine`.

- [ ] **Step 3: Implement**

Create `lib/sync/engine.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/sync/__tests__/engine.test.ts`
Expected: 10 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/sync/engine.ts lib/sync/__tests__/engine.test.ts
git commit -m "feat: add rAF-driven sync engine with binary-search word lookup"
```

---

## Task 8: The ayah playlist

**Files:**
- Create: `lib/audio/playlist.ts`, `lib/data/audioUrl.ts`
- Test: `lib/audio/__tests__/playlist.test.ts`

**Interfaces:**
- Consumes: `AyahTiming` from Task 5, `Timeline` from Task 6
- Produces:
  - `class AyahPlaylist` with `play()`, `pause()`, `seekGlobal(ms)`, `seekToAyah(index, localMs)`, `next()`, `prev()`, `globalTimeMs()`, `currentAyahIndex`, `isPlaying`, `on(event, cb)`, `destroy()`
  - Events: `'ayahchange'`, `'state'`, `'ended'`, `'error'`, `'loading'`
  - `function resolveAudioUrl(rawUrl: string): string`

`resolveAudioUrl` exists so that if large surahs later move to external storage, only that one function changes.

- [ ] **Step 1: Write the audio URL resolver**

Create `lib/data/audioUrl.ts`:

```ts
/**
 * Single point of resolution for ayah audio.
 *
 * Today every file is committed under public/audio and the stored path is used
 * verbatim. If large surahs later move to external object storage, this is the
 * only function that changes.
 */
export function resolveAudioUrl(rawUrl: string): string {
  return rawUrl;
}
```

- [ ] **Step 2: Write the failing test**

Create `lib/audio/__tests__/playlist.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AyahPlaylist } from '../playlist';
import type { AyahTiming } from '@/lib/data/types';

const ayahs: AyahTiming[] = [
  { ayah: 1, audioUrl: '/audio/x/1.mp3', startOffsetMs: 0, durationMs: 4000, words: [] },
  { ayah: 2, audioUrl: '/audio/x/2.mp3', startOffsetMs: 4000, durationMs: 5000, words: [] },
  { ayah: 3, audioUrl: '/audio/x/3.mp3', startOffsetMs: 9000, durationMs: 4000, words: [] },
];

beforeEach(() => {
  // jsdom does not implement media playback.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

describe('AyahPlaylist', () => {
  it('starts on the first ayah', () => {
    const p = new AyahPlaylist(ayahs);
    expect(p.currentAyahIndex).toBe(0);
    p.destroy();
  });

  it('reports global time from the current ayah offset', () => {
    const p = new AyahPlaylist(ayahs);
    p.seekToAyah(1, 500);
    expect(p.globalTimeMs()).toBe(4500);
    p.destroy();
  });

  it('seekGlobal lands on the right ayah', () => {
    const p = new AyahPlaylist(ayahs);
    const seen: number[] = [];
    p.on('ayahchange', i => seen.push(i));
    p.seekGlobal(9500);
    expect(p.currentAyahIndex).toBe(2);
    expect(seen).toContain(2);
    p.destroy();
  });

  it('advances to the next ayah when one ends', () => {
    const p = new AyahPlaylist(ayahs);
    const seen: number[] = [];
    p.on('ayahchange', i => seen.push(i));
    p.play();
    p.handleEndedForTest();
    expect(p.currentAyahIndex).toBe(1);
    expect(seen).toContain(1);
    p.destroy();
  });

  it('emits ended and stops after the final ayah', () => {
    const p = new AyahPlaylist(ayahs);
    const ended = vi.fn();
    p.on('ended', ended);
    p.seekToAyah(2, 0);
    p.play();
    p.handleEndedForTest();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(p.isPlaying).toBe(false);
    p.destroy();
  });

  it('prev and next clamp at the boundaries', () => {
    const p = new AyahPlaylist(ayahs);
    p.prev();
    expect(p.currentAyahIndex).toBe(0);
    p.seekToAyah(2, 0);
    p.next();
    expect(p.currentAyahIndex).toBe(2);
    p.destroy();
  });

  it('emits state changes on play and pause', () => {
    const p = new AyahPlaylist(ayahs);
    const seen: boolean[] = [];
    p.on('state', playing => seen.push(playing));
    p.play();
    p.pause();
    expect(seen).toEqual([true, false]);
    p.destroy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/audio/__tests__/playlist.test.ts`
Expected: FAIL — cannot resolve `../playlist`.

- [ ] **Step 4: Implement**

Create `lib/audio/playlist.ts`:

```ts
import type { AyahTiming } from '@/lib/data/types';
import { resolveAudioUrl } from '@/lib/data/audioUrl';

type Events = {
  ayahchange: (ayahIndex: number) => void;
  state: (isPlaying: boolean) => void;
  ended: () => void;
  error: (ayahIndex: number) => void;
  loading: (isLoading: boolean) => void;
  duration: (ayahIndex: number, durationMs: number) => void;
};

/**
 * Plays a surah as a sequence of per-ayah audio files.
 *
 * Word timings only exist per ayah, so playback cannot use a single file. Two
 * audio elements alternate: while ayah N plays, N+1 preloads into the idle
 * element, so a boundary does not stall on the network.
 */
export class AyahPlaylist {
  private readonly ayahs: AyahTiming[];
  private readonly elements: [HTMLAudioElement, HTMLAudioElement];
  private activeSlot = 0;
  private index = 0;
  private playing = false;
  private listeners: { [K in keyof Events]: Set<Events[K]> } = {
    ayahchange: new Set(), state: new Set(), ended: new Set(),
    error: new Set(), loading: new Set(), duration: new Set(),
  };

  constructor(ayahs: AyahTiming[]) {
    this.ayahs = ayahs;
    this.elements = [new Audio(), new Audio()];
    this.elements.forEach(el => {
      el.preload = 'auto';
      el.addEventListener('ended', () => this.handleEnded(el));
      el.addEventListener('error', () => this.emit('error', this.index));
      el.addEventListener('waiting', () => this.emit('loading', true));
      el.addEventListener('playing', () => this.emit('loading', false));
      el.addEventListener('loadedmetadata', () => {
        const slot = this.elements.indexOf(el);
        const idx = slot === this.activeSlot ? this.index : this.index + 1;
        if (Number.isFinite(el.duration)) {
          this.emit('duration', idx, Math.round(el.duration * 1000));
        }
      });
    });
    this.loadInto(this.activeSlot, 0);
    this.preloadNext();
  }

  get currentAyahIndex(): number { return this.index; }
  get isPlaying(): boolean { return this.playing; }
  get current(): HTMLAudioElement { return this.elements[this.activeSlot]; }

  on<K extends keyof Events>(event: K, cb: Events[K]): () => void {
    this.listeners[event].add(cb as never);
    return () => { this.listeners[event].delete(cb as never); };
  }

  globalTimeMs(): number {
    const local = this.current.currentTime * 1000;
    return this.ayahs[this.index].startOffsetMs + local;
  }

  localTimeMs(): number {
    return this.current.currentTime * 1000;
  }

  play(): void {
    this.playing = true;
    void this.current.play();
    this.emit('state', true);
  }

  pause(): void {
    this.playing = false;
    this.current.pause();
    this.emit('state', false);
  }

  seekToAyah(index: number, localMs = 0): void {
    const clamped = Math.min(Math.max(index, 0), this.ayahs.length - 1);
    if (clamped !== this.index) {
      this.index = clamped;
      this.loadInto(this.activeSlot, clamped);
      this.emit('ayahchange', clamped);
      this.preloadNext();
    }
    this.current.currentTime = localMs / 1000;
    if (this.playing) void this.current.play();
  }

  seekGlobal(globalMs: number): void {
    let index = 0;
    for (let i = this.ayahs.length - 1; i >= 0; i -= 1) {
      if (globalMs >= this.ayahs[i].startOffsetMs) { index = i; break; }
    }
    this.seekToAyah(index, globalMs - this.ayahs[index].startOffsetMs);
  }

  next(): void { this.seekToAyah(this.index + 1, 0); }
  prev(): void { this.seekToAyah(this.index - 1, 0); }

  destroy(): void {
    this.elements.forEach(el => { el.pause(); el.src = ''; });
    (Object.keys(this.listeners) as (keyof Events)[])
      .forEach(k => this.listeners[k].clear());
  }

  /** Exposed so tests can drive an ayah boundary without real playback. */
  handleEndedForTest(): void {
    this.handleEnded(this.current);
  }

  private handleEnded(el: HTMLAudioElement): void {
    if (el !== this.current) return;

    if (this.index >= this.ayahs.length - 1) {
      this.playing = false;
      this.emit('state', false);
      this.emit('ended');
      return;
    }

    // Swap to the buffer that already holds the next ayah.
    this.activeSlot = this.activeSlot === 0 ? 1 : 0;
    this.index += 1;
    this.current.currentTime = 0;
    if (this.playing) void this.current.play();
    this.emit('ayahchange', this.index);
    this.preloadNext();
  }

  private preloadNext(): void {
    const nextIndex = this.index + 1;
    if (nextIndex >= this.ayahs.length) return;
    this.loadInto(this.activeSlot === 0 ? 1 : 0, nextIndex);
  }

  private loadInto(slot: number, ayahIndex: number): void {
    const el = this.elements[slot];
    const url = resolveAudioUrl(this.ayahs[ayahIndex].audioUrl);
    if (el.getAttribute('src') === url) return;
    el.setAttribute('src', url);
    el.src = url;
    el.load();
  }

  private emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): void {
    this.listeners[event].forEach(cb => (cb as (...a: unknown[]) => void)(...args));
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/audio/__tests__/playlist.test.ts`
Expected: 7 passing.

- [ ] **Step 6: Commit**

```bash
git add lib/audio lib/data/audioUrl.ts
git commit -m "feat: add double-buffered ayah playlist for continuous playback"
```

---

## Task 9: Data loaders and styles

**Files:**
- Create: `lib/data/loaders.ts`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: types from Task 5, fonts from Task 4
- Produces:
  - `function getSurahList(): SurahMeta[]`
  - `function getSurahText(id: number): SurahText`
  - `function getSurahTimings(id: number): SurahTimings`
  - CSS classes: `.quran-text`, `.script-tajweed`, `.script-indopak`, `.word`, `.word--active`, `.word--active-estimated`

- [ ] **Step 1: Write the loaders**

Create `lib/data/loaders.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import surahs from '@/data/surahs.json';
import type { SurahMeta, SurahText, SurahTimings } from './types';

export function getSurahList(): SurahMeta[] {
  return surahs as SurahMeta[];
}

export function getSurahMeta(id: number): SurahMeta | undefined {
  return getSurahList().find(s => s.id === id);
}

/** Available surah ids, used to generate static routes. */
export function getAvailableSurahIds(): number[] {
  return getSurahList().filter(s => s.available).map(s => s.id);
}

/**
 * Read from disk rather than imported.
 *
 * A dynamic `import()`/`require()` of a templated path cannot be statically
 * analysed by the bundler, and listing 114 static imports is worse. These are
 * only ever called from server components during the static export, so reading
 * the file directly at build time is both correct and simplest.
 */
function readJson<T>(...segments: string[]): T {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), 'data', ...segments), 'utf8'),
  ) as T;
}

export function getSurahText(id: number): SurahText {
  return readJson<SurahText>('text', `${id}.json`);
}

export function getSurahTimings(id: number): SurahTimings {
  return readJson<SurahTimings>('timings', 'abdulbasit-murattal', `${id}.json`);
}
```

Add `"resolveJsonModule": true` to `tsconfig.json` `compilerOptions` if it is not already present.

- [ ] **Step 2: Write the fonts, tajweed palette and highlight styles**

Append to `app/globals.css`:

```css
@font-face {
  font-family: 'Amiri Quran';
  src: url('/fonts/amiri-quran.woff2') format('woff2');
  font-display: swap;
  font-weight: 400;
}

@font-face {
  font-family: 'Noto Naskh Arabic';
  src: url('/fonts/noto-naskh-arabic.woff2') format('woff2');
  font-display: swap;
  font-weight: 400;
}

.quran-text {
  direction: rtl;
  text-align: center;
  font-size: clamp(1.75rem, 5vw, 2.75rem);
  line-height: 2.4;
  word-spacing: 0.15em;
}

.script-tajweed { font-family: 'Amiri Quran', serif; }
.script-indopak { font-family: 'Noto Naskh Arabic', serif; }

.word {
  display: inline-block;
  padding: 0.05em 0.18em;
  margin: 0 0.04em;
  border-radius: 0.35rem;
  cursor: pointer;
  background-color: transparent;
  transition: background-color 140ms ease-out;
}

.word:hover { background-color: rgb(0 0 0 / 0.05); }

/*
 * The highlight is a BACKGROUND, never a colour change: tajweed rules own the
 * text colour, and recolouring the active word would destroy that information.
 * The tint is kept light so every rule colour below stays legible on top of it.
 */
.word--active { background-color: #fde68a; }

/* Interpolated timings get a softer tint — the UI must not imply precision
   the source data does not have. */
.word--active-estimated { background-color: #fef3c7; }

/* Tajweed rule palette. Contrast-checked against both highlight tints above. */
rule[class='madda_necessary']    { color: #9b1c1c; }
rule[class='madda_obligatory']   { color: #b45309; }
rule[class='madda_permissible']  { color: #b45309; }
rule[class='madda_normal']       { color: #1d4ed8; }
rule[class='qalqalah']           { color: #a30006; }
rule[class='ikhafa']             { color: #6b21a8; }
rule[class='ikhafa_shafawi']     { color: #6b21a8; }
rule[class='idgham_ghunnah']     { color: #0f6b00; }
rule[class='ghunnah']            { color: #0f6b00; }
rule[class='iqlab']              { color: #0369a1; }
rule[class='ham_wasl']           { color: #6b7280; }
rule[class='slnt']               { color: #6b7280; }
rule[class='laam_shamsiyah']     { color: #6b7280; }
rule[class='idgham_wo_ghunnah']  { color: #6b7280; }
rule[class='idgham_shafawi']     { color: #6b7280; }
rule[class='idgham_mutajanisayn'] { color: #6b7280; }
rule[class='idgham_mutaqaribayn'] { color: #6b7280; }
```

- [ ] **Step 3: Verify the build still succeeds**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add lib/data/loaders.ts app/globals.css tsconfig.json
git commit -m "feat: add data loaders, Quran fonts and tajweed palette"
```

---

## Task 10: Word and ayah rendering

**Files:**
- Create: `components/QuranWord.tsx`, `components/AyahBlock.tsx`, `components/QuranReader.tsx`, `lib/reader/wordRegistry.ts`
- Test: `components/__tests__/QuranReader.test.tsx`

**Interfaces:**
- Consumes: `SurahText`, `SurahWord` from Task 5
- Produces:
  - `class WordRegistry` with `register(id, el)`, `setActive(id, estimated)`, `clear()`
  - `<QuranReader text script registry onWordClick onAyahPlay activeAyah />`

The registry is how highlighting bypasses React: the reader renders once, and the sync engine toggles classes through this object.

- [ ] **Step 1: Write the failing test**

Create `components/__tests__/QuranReader.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuranReader } from '../QuranReader';
import { WordRegistry } from '@/lib/reader/wordRegistry';
import type { SurahText } from '@/lib/data/types';

const text: SurahText = {
  surah: 1,
  ayahs: [
    { ayah: 1, words: [
      { id: '1:1:1', position: 1, tajweed: 'بِسۡمِ', indopak: 'بِسۡمِ' },
      { id: '1:1:2', position: 2, tajweed: '<rule class=ham_wasl>ٱ</rule>للَّهِ', indopak: 'اللهِ' },
    ] },
    { ayah: 2, words: [
      { id: '1:2:1', position: 1, tajweed: 'ٱلۡحَمۡدُ', indopak: 'اَلۡحَمۡدُ' },
    ] },
  ],
};

const setup = (overrides = {}) => {
  const registry = new WordRegistry();
  const onWordClick = vi.fn();
  const onAyahPlay = vi.fn();
  render(
    <QuranReader
      text={text}
      script="tajweed"
      registry={registry}
      onWordClick={onWordClick}
      onAyahPlay={onAyahPlay}
      activeAyah={1}
      {...overrides}
    />,
  );
  return { registry, onWordClick, onAyahPlay };
};

describe('QuranReader', () => {
  it('renders every word as an addressable element', () => {
    setup();
    expect(document.querySelector('[data-word-id="1:1:1"]')).toBeInTheDocument();
    expect(document.querySelector('[data-word-id="1:2:1"]')).toBeInTheDocument();
  });

  it('renders tajweed rule markup as elements, not escaped text', () => {
    setup();
    const word = document.querySelector('[data-word-id="1:1:2"]')!;
    expect(word.querySelector('rule')).not.toBeNull();
    expect(word.textContent).not.toContain('<rule');
  });

  it('renders IndoPak text when that script is selected', () => {
    setup({ script: 'indopak' });
    const word = document.querySelector('[data-word-id="1:1:2"]')!;
    expect(word.textContent).toBe('اللهِ');
    expect(word.querySelector('rule')).toBeNull();
  });

  it('produces identical word ids in both scripts', () => {
    const ids = (script: 'tajweed' | 'indopak') => {
      document.body.innerHTML = '';
      setup({ script });
      return [...document.querySelectorAll('[data-word-id]')]
        .map(el => el.getAttribute('data-word-id'));
    };
    expect(ids('tajweed')).toEqual(ids('indopak'));
  });

  it('calls onWordClick with the word id', async () => {
    const { onWordClick } = setup();
    await userEvent.click(document.querySelector('[data-word-id="1:1:2"]')!);
    expect(onWordClick).toHaveBeenCalledWith('1:1:2');
  });

  it('calls onAyahPlay with the ayah number', async () => {
    const { onAyahPlay } = setup();
    await userEvent.click(screen.getByRole('button', { name: /play ayah 2/i }));
    expect(onAyahPlay).toHaveBeenCalledWith(2);
  });

  it('registry.setActive toggles classes without re-rendering', () => {
    const { registry } = setup();
    const first = document.querySelector('[data-word-id="1:1:1"]')!;
    const second = document.querySelector('[data-word-id="1:1:2"]')!;

    registry.setActive('1:1:1', false);
    expect(first.classList.contains('word--active')).toBe(true);

    registry.setActive('1:1:2', false);
    expect(first.classList.contains('word--active')).toBe(false);
    expect(second.classList.contains('word--active')).toBe(true);
  });

  it('marks estimated timings with the softer class', () => {
    const { registry } = setup();
    registry.setActive('1:1:1', true);
    const first = document.querySelector('[data-word-id="1:1:1"]')!;
    expect(first.classList.contains('word--active-estimated')).toBe(true);
  });

  it('clears the highlight when given null', () => {
    const { registry } = setup();
    registry.setActive('1:1:1', false);
    registry.setActive(null, false);
    expect(document.querySelector('.word--active')).toBeNull();
  });
});
```

Install the user-event package:

```bash
npm install -D @testing-library/user-event
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/__tests__/QuranReader.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the registry**

Create `lib/reader/wordRegistry.ts`:

```ts
const ACTIVE = 'word--active';
const ACTIVE_ESTIMATED = 'word--active-estimated';

/**
 * Maps word ids to their DOM nodes so the sync engine can move the highlight
 * without re-rendering React. Exactly two nodes are touched per change.
 */
export class WordRegistry {
  private nodes = new Map<string, HTMLElement>();
  private activeId: string | null = null;

  register(id: string, el: HTMLElement | null): void {
    if (el) this.nodes.set(id, el);
    else this.nodes.delete(id);
  }

  setActive(id: string | null, estimated: boolean): void {
    if (id === this.activeId) return;

    const previous = this.activeId ? this.nodes.get(this.activeId) : undefined;
    previous?.classList.remove(ACTIVE, ACTIVE_ESTIMATED);

    const next = id ? this.nodes.get(id) : undefined;
    if (next) {
      next.classList.add(ACTIVE);
      if (estimated) next.classList.add(ACTIVE_ESTIMATED);
    }

    this.activeId = id;
  }

  getNode(id: string): HTMLElement | undefined {
    return this.nodes.get(id);
  }

  clear(): void {
    this.setActive(null, false);
    this.nodes.clear();
  }
}
```

- [ ] **Step 4: Implement the components**

Create `components/QuranWord.tsx`:

```tsx
'use client';

import { useCallback } from 'react';
import type { SurahWord } from '@/lib/data/types';
import type { WordRegistry } from '@/lib/reader/wordRegistry';

export type Script = 'tajweed' | 'indopak';

interface Props {
  word: SurahWord;
  script: Script;
  registry: WordRegistry;
  onClick: (wordId: string) => void;
}

export function QuranWord({ word, script, registry, onClick }: Props) {
  const ref = useCallback(
    (el: HTMLSpanElement | null) => registry.register(word.id, el),
    [registry, word.id],
  );

  // Tajweed text carries <rule> markup that must render as elements.
  if (script === 'tajweed') {
    return (
      <span
        ref={ref}
        className="word"
        data-word-id={word.id}
        role="button"
        tabIndex={0}
        onClick={() => onClick(word.id)}
        onKeyDown={e => { if (e.key === 'Enter') onClick(word.id); }}
        dangerouslySetInnerHTML={{ __html: word.tajweed }}
      />
    );
  }

  return (
    <span
      ref={ref}
      className="word"
      data-word-id={word.id}
      role="button"
      tabIndex={0}
      onClick={() => onClick(word.id)}
      onKeyDown={e => { if (e.key === 'Enter') onClick(word.id); }}
    >
      {word.indopak}
    </span>
  );
}
```

Create `components/AyahBlock.tsx`:

```tsx
'use client';

import { QuranWord, type Script } from './QuranWord';
import type { SurahWord } from '@/lib/data/types';
import type { WordRegistry } from '@/lib/reader/wordRegistry';

interface Props {
  surah: number;
  ayah: number;
  words: SurahWord[];
  script: Script;
  registry: WordRegistry;
  isActive: boolean;
  onWordClick: (wordId: string) => void;
  onAyahPlay: (ayah: number) => void;
}

export function AyahBlock({
  surah, ayah, words, script, registry, isActive, onWordClick, onAyahPlay,
}: Props) {
  return (
    <div
      data-ayah={ayah}
      className={`rounded-xl px-3 py-5 transition-colors ${
        isActive ? 'bg-amber-50/60' : ''
      }`}
    >
      <div className={`quran-text script-${script}`}>
        {words.map(word => (
          <QuranWord
            key={word.id}
            word={word}
            script={script}
            registry={registry}
            onClick={onWordClick}
          />
        ))}
        <span className="mx-2 text-2xl text-neutral-400">
          ﴿{toArabicDigits(ayah)}﴾
        </span>
      </div>

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          aria-label={`Play ayah ${ayah}`}
          onClick={() => onAyahPlay(ayah)}
          className="rounded-full px-3 py-1 text-sm text-neutral-500 hover:bg-neutral-100"
        >
          ▶ {surah}:{ayah}
        </button>
      </div>
    </div>
  );
}

function toArabicDigits(n: number): string {
  return String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
}
```

Create `components/QuranReader.tsx`:

```tsx
'use client';

import { AyahBlock } from './AyahBlock';
import type { Script } from './QuranWord';
import type { SurahText } from '@/lib/data/types';
import type { WordRegistry } from '@/lib/reader/wordRegistry';

interface Props {
  text: SurahText;
  script: Script;
  registry: WordRegistry;
  activeAyah: number;
  onWordClick: (wordId: string) => void;
  onAyahPlay: (ayah: number) => void;
}

export function QuranReader({
  text, script, registry, activeAyah, onWordClick, onAyahPlay,
}: Props) {
  return (
    <div className="mx-auto max-w-3xl pb-40">
      {text.ayahs.map(ayah => (
        <AyahBlock
          key={ayah.ayah}
          surah={text.surah}
          ayah={ayah.ayah}
          words={ayah.words}
          script={script}
          registry={registry}
          isActive={ayah.ayah === activeAyah}
          onWordClick={onWordClick}
          onAyahPlay={onAyahPlay}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run components/__tests__/QuranReader.test.tsx`
Expected: 9 passing.

- [ ] **Step 6: Commit**

```bash
git add components lib/reader
git commit -m "feat: render Quran words with registry-driven highlighting

The reader renders once; the sync engine moves the highlight by toggling
classes on two DOM nodes through WordRegistry, so playback causes no React
re-renders."
```

---

## Task 11: Player controls

**Files:**
- Create: `components/ProgressBar.tsx`, `components/AudioPlayer.tsx`, `components/ScriptToggle.tsx`
- Test: `components/__tests__/ProgressBar.test.tsx`

**Interfaces:**
- Consumes: nothing beyond props
- Produces:
  - `<ProgressBar valueMs totalMs onSeek />` — reports only on release
  - `<AudioPlayer isPlaying currentMs totalMs ayahLabel onPlayPause onPrev onNext onSeek volume onVolumeChange />`
  - `<ScriptToggle script onChange />`

- [ ] **Step 1: Write the failing test**

Create `components/__tests__/ProgressBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProgressBar, formatTime } from '../ProgressBar';

describe('formatTime', () => {
  it('formats milliseconds as m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(9000)).toBe('0:09');
    expect(formatTime(95000)).toBe('1:35');
    expect(formatTime(3600000)).toBe('60:00');
  });

  it('handles non-finite input', () => {
    expect(formatTime(Number.NaN)).toBe('0:00');
  });
});

describe('ProgressBar', () => {
  it('shows elapsed and total time', () => {
    render(<ProgressBar valueMs={9000} totalMs={95000} onSeek={vi.fn()} />);
    expect(screen.getByText('0:09')).toBeInTheDocument();
    expect(screen.getByText('1:35')).toBeInTheDocument();
  });

  it('does not seek while dragging', () => {
    const onSeek = vi.fn();
    render(<ProgressBar valueMs={0} totalMs={10000} onSeek={onSeek} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '5000' } });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('seeks on release with the dragged value', () => {
    const onSeek = vi.fn();
    render(<ProgressBar valueMs={0} totalMs={10000} onSeek={onSeek} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '5000' } });
    fireEvent.pointerUp(slider);
    expect(onSeek).toHaveBeenCalledWith(5000);
  });

  it('shows the dragged position rather than the incoming one', () => {
    const { rerender } = render(
      <ProgressBar valueMs={0} totalMs={10000} onSeek={vi.fn()} />,
    );
    const slider = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '7000' } });
    rerender(<ProgressBar valueMs={100} totalMs={10000} onSeek={vi.fn()} />);
    expect(slider.value).toBe('7000');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/__tests__/ProgressBar.test.tsx`
Expected: FAIL — cannot resolve `../ProgressBar`.

- [ ] **Step 3: Implement**

Create `components/ProgressBar.tsx`:

```tsx
'use client';

import { useState } from 'react';

export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

interface Props {
  valueMs: number;
  totalMs: number;
  onSeek: (ms: number) => void;
}

/**
 * Whole-surah scrub bar. The seek commits on release so that dragging across
 * ayah boundaries does not trigger a load for every intermediate position.
 */
export function ProgressBar({ valueMs, totalMs, onSeek }: Props) {
  const [dragMs, setDragMs] = useState<number | null>(null);
  const shown = dragMs ?? valueMs;

  const commit = () => {
    if (dragMs !== null) {
      onSeek(dragMs);
      setDragMs(null);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <span className="w-10 text-right text-xs tabular-nums text-neutral-500">
        {formatTime(shown)}
      </span>
      <input
        type="range"
        min={0}
        max={Math.max(totalMs, 1)}
        value={shown}
        aria-label="Seek within surah"
        onChange={e => setDragMs(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        className="h-1 flex-1 cursor-pointer appearance-none rounded bg-neutral-200 accent-amber-600"
      />
      <span className="w-10 text-xs tabular-nums text-neutral-500">
        {formatTime(totalMs)}
      </span>
    </div>
  );
}
```

Create `components/ScriptToggle.tsx`:

```tsx
'use client';

import type { Script } from './QuranWord';

interface Props {
  script: Script;
  onChange: (script: Script) => void;
}

export function ScriptToggle({ script, onChange }: Props) {
  return (
    <div className="inline-flex rounded-lg border border-neutral-200 p-0.5 text-sm">
      {(['tajweed', 'indopak'] as const).map(option => (
        <button
          key={option}
          type="button"
          aria-pressed={script === option}
          onClick={() => onChange(option)}
          className={`rounded-md px-3 py-1 capitalize ${
            script === option ? 'bg-neutral-900 text-white' : 'text-neutral-600'
          }`}
        >
          {option === 'tajweed' ? 'Tajweed' : 'IndoPak'}
        </button>
      ))}
    </div>
  );
}
```

Create `components/AudioPlayer.tsx`:

```tsx
'use client';

import { ProgressBar } from './ProgressBar';

interface Props {
  isPlaying: boolean;
  currentMs: number;
  totalMs: number;
  ayahLabel: string;
  isLoading: boolean;
  volume: number;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (ms: number) => void;
  onVolumeChange: (volume: number) => void;
}

export function AudioPlayer({
  isPlaying, currentMs, totalMs, ayahLabel, isLoading, volume,
  onPlayPause, onPrev, onNext, onSeek, onVolumeChange,
}: Props) {
  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-3">
        <ProgressBar valueMs={currentMs} totalMs={totalMs} onSeek={onSeek} />

        <div className="flex items-center justify-between">
          <span className="w-24 text-xs text-neutral-500">{ayahLabel}</span>

          <div className="flex items-center gap-2">
            <button type="button" aria-label="Previous ayah" onClick={onPrev}
              className="rounded-full p-2 hover:bg-neutral-100">⏮</button>

            <button
              type="button"
              aria-label={isPlaying ? 'Pause' : 'Play'}
              onClick={onPlayPause}
              className="rounded-full bg-neutral-900 p-3 text-white hover:bg-neutral-700"
            >
              {isLoading ? '…' : isPlaying ? '⏸' : '▶'}
            </button>

            <button type="button" aria-label="Next ayah" onClick={onNext}
              className="rounded-full p-2 hover:bg-neutral-100">⏭</button>
          </div>

          <div className="flex w-24 justify-end">
            <input
              type="range" min={0} max={1} step={0.05} value={volume}
              aria-label="Volume"
              onChange={e => onVolumeChange(Number(e.target.value))}
              className="h-1 w-16 cursor-pointer appearance-none rounded bg-neutral-200 accent-neutral-700"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/__tests__/ProgressBar.test.tsx`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add components/ProgressBar.tsx components/AudioPlayer.tsx components/ScriptToggle.tsx components/__tests__/ProgressBar.test.tsx
git commit -m "feat: add transport controls and whole-surah progress bar"
```

---

## Task 12: Auto-scroll

**Files:**
- Create: `lib/reader/useAutoScroll.ts`, `components/JumpToAyahPill.tsx`
- Test: `lib/reader/__tests__/useAutoScroll.test.tsx`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `function useAutoScroll(activeAyah: number, enabled: boolean): { suspended: boolean; resume: () => void }`
  - `<JumpToAyahPill visible onClick />`

Programmatic scrolls must not be mistaken for user scrolls. A suppression flag distinguishes them.

- [ ] **Step 1: Write the failing test**

Create `lib/reader/__tests__/useAutoScroll.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoScroll } from '../useAutoScroll';

beforeEach(() => {
  document.body.innerHTML = `
    <div data-ayah="1"></div>
    <div data-ayah="2"></div>`;
  Element.prototype.scrollIntoView = vi.fn();
});

describe('useAutoScroll', () => {
  it('scrolls the active ayah into view', () => {
    renderHook(({ ayah }) => useAutoScroll(ayah, true), {
      initialProps: { ayah: 1 },
    });
    expect(document.querySelector('[data-ayah="1"]')!.scrollIntoView)
      .toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  });

  it('does nothing when disabled', () => {
    renderHook(() => useAutoScroll(1, false));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('suspends after a manual wheel scroll', () => {
    const { result } = renderHook(() => useAutoScroll(1, true));
    expect(result.current.suspended).toBe(false);
    act(() => { window.dispatchEvent(new Event('wheel')); });
    expect(result.current.suspended).toBe(true);
  });

  it('stops scrolling while suspended', () => {
    const { rerender } = renderHook(({ ayah }) => useAutoScroll(ayah, true), {
      initialProps: { ayah: 1 },
    });
    act(() => { window.dispatchEvent(new Event('wheel')); });
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    rerender({ ayah: 2 });
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('resume() restores scrolling', () => {
    const { result, rerender } = renderHook(({ ayah }) => useAutoScroll(ayah, true), {
      initialProps: { ayah: 1 },
    });
    act(() => { window.dispatchEvent(new Event('wheel')); });
    act(() => { result.current.resume(); });
    expect(result.current.suspended).toBe(false);
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    rerender({ ayah: 2 });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/reader/__tests__/useAutoScroll.test.tsx`
Expected: FAIL — cannot resolve `../useAutoScroll`.

- [ ] **Step 3: Implement**

Create `lib/reader/useAutoScroll.ts`:

```ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Keeps the active ayah in view, and gets out of the way when the user scrolls.
 *
 * A short suppression window after each programmatic scroll prevents the smooth
 * scroll itself from being read as user intent.
 */
export function useAutoScroll(activeAyah: number, enabled: boolean) {
  const [suspended, setSuspended] = useState(false);
  const suppressUntil = useRef(0);

  useEffect(() => {
    const onUserScroll = () => {
      if (performance.now() < suppressUntil.current) return;
      setSuspended(true);
    };
    window.addEventListener('wheel', onUserScroll, { passive: true });
    window.addEventListener('touchmove', onUserScroll, { passive: true });
    return () => {
      window.removeEventListener('wheel', onUserScroll);
      window.removeEventListener('touchmove', onUserScroll);
    };
  }, []);

  useEffect(() => {
    if (!enabled || suspended) return;
    const el = document.querySelector(`[data-ayah="${activeAyah}"]`);
    if (!el) return;
    suppressUntil.current = performance.now() + 900;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeAyah, enabled, suspended]);

  const resume = useCallback(() => {
    setSuspended(false);
    suppressUntil.current = performance.now() + 900;
  }, []);

  return { suspended, resume };
}
```

Create `components/JumpToAyahPill.tsx`:

```tsx
'use client';

interface Props {
  visible: boolean;
  onClick: () => void;
}

export function JumpToAyahPill({ visible, onClick }: Props) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-28 left-1/2 z-10 -translate-x-1/2 rounded-full bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg"
    >
      Jump to current ayah
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/reader/__tests__/useAutoScroll.test.tsx`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/reader/useAutoScroll.ts components/JumpToAyahPill.tsx lib/reader/__tests__
git commit -m "feat: auto-scroll to the active ayah with manual-scroll override"
```

---

## Task 13: Wire the surah page

**Files:**
- Create: `app/surah/[id]/page.tsx`, `app/surah/[id]/SurahClient.tsx`
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: everything from Tasks 6–12
- Produces: a working reader route at `/surah/1/`

- [ ] **Step 1: Write the static route**

Create `app/surah/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import {
  getAvailableSurahIds, getSurahMeta, getSurahText, getSurahTimings,
} from '@/lib/data/loaders';
import { SurahClient } from './SurahClient';

export function generateStaticParams() {
  return getAvailableSurahIds().map(id => ({ id: String(id) }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const meta = getSurahMeta(Number(id));
  if (!meta) return {};
  return {
    title: `Surah ${meta.nameSimple} — listen and follow word by word`,
    description: `Listen to Surah ${meta.nameSimple} (${meta.nameEnglish}) recited by AbdulBaset AbdulSamad, with each word highlighted as it is recited.`,
  };
}

export default async function SurahPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const surahId = Number(id);
  const meta = getSurahMeta(surahId);
  if (!meta || !meta.available) notFound();

  return (
    <SurahClient
      meta={meta}
      text={getSurahText(surahId)}
      timings={getSurahTimings(surahId)}
    />
  );
}
```

- [ ] **Step 2: Write the client wiring**

Create `app/surah/[id]/SurahClient.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { QuranReader } from '@/components/QuranReader';
import { AudioPlayer } from '@/components/AudioPlayer';
import { ScriptToggle } from '@/components/ScriptToggle';
import { JumpToAyahPill } from '@/components/JumpToAyahPill';
import type { Script } from '@/components/QuranWord';
import { WordRegistry } from '@/lib/reader/wordRegistry';
import { useAutoScroll } from '@/lib/reader/useAutoScroll';
import { AyahPlaylist } from '@/lib/audio/playlist';
import { SyncEngine } from '@/lib/sync/engine';
import { Timeline } from '@/lib/sync/timeline';
import type { SurahMeta, SurahText, SurahTimings } from '@/lib/data/types';

const SCRIPT_KEY = 'quran.script';

interface Props {
  meta: SurahMeta;
  text: SurahText;
  timings: SurahTimings;
}

export function SurahClient({ meta, text, timings }: Props) {
  const registry = useMemo(() => new WordRegistry(), []);
  const timeline = useMemo(() => new Timeline(timings.ayahs), [timings]);

  const playlistRef = useRef<AyahPlaylist | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);

  const [script, setScript] = useState<Script>('tajweed');
  const [isPlaying, setPlaying] = useState(false);
  const [isLoading, setLoading] = useState(false);
  const [ayahIndex, setAyahIndex] = useState(0);
  const [currentMs, setCurrentMs] = useState(0);
  const [totalMs, setTotalMs] = useState(timeline.totalMs);
  const [volume, setVolume] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const activeAyah = timings.ayahs[ayahIndex]?.ayah ?? 1;
  const { suspended, resume } = useAutoScroll(activeAyah, isPlaying);

  // Restore the saved script choice.
  useEffect(() => {
    const saved = window.localStorage.getItem(SCRIPT_KEY);
    if (saved === 'tajweed' || saved === 'indopak') setScript(saved);
  }, []);

  const changeScript = useCallback((next: Script) => {
    setScript(next);
    window.localStorage.setItem(SCRIPT_KEY, next);
  }, []);

  // Build the playlist and sync engine once.
  useEffect(() => {
    const playlist = new AyahPlaylist(timings.ayahs);
    const engine = new SyncEngine();
    playlistRef.current = playlist;
    engineRef.current = engine;

    const offs = [
      playlist.on('state', setPlaying),
      playlist.on('loading', setLoading),
      playlist.on('error', i => setError(
        `Unable to load the recitation for ayah ${timings.ayahs[i]?.ayah ?? i + 1}.`,
      )),
      playlist.on('ended', () => {
        registry.setActive(null, false);
        playlist.seekToAyah(0, 0);
        setAyahIndex(0);
      }),
      playlist.on('ayahchange', index => {
        setAyahIndex(index);
        engine.setWords(timings.ayahs[index]?.words ?? []);
        setError(null);
      }),
      playlist.on('duration', (index, durationMs) => {
        timeline.setActualDuration(index, durationMs, playlist.currentAyahIndex);
        setTotalMs(timeline.totalMs);
      }),
      engine.onChange(wordId => {
        const words = timings.ayahs[playlist.currentAyahIndex]?.words ?? [];
        const word = words.find(w => w.id === wordId);
        registry.setActive(wordId, word?.estimated ?? false);
      }),
    ];

    engine.attach(() => playlist.localTimeMs(), timings.ayahs[0]?.words ?? []);

    // Progress bar updates at a human rate; the highlight runs at frame rate.
    const ticker = window.setInterval(() => {
      setCurrentMs(
        timeline.localToGlobal(playlist.currentAyahIndex, playlist.localTimeMs()),
      );
    }, 250);

    return () => {
      window.clearInterval(ticker);
      offs.forEach(off => off());
      engine.detach();
      playlist.destroy();
      registry.clear();
    };
  }, [timings, timeline, registry]);

  useEffect(() => {
    const playlist = playlistRef.current;
    if (playlist) playlist.current.volume = volume;
  }, [volume, ayahIndex]);

  // Space toggles playback unless the user is typing or on a control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const target = e.target as HTMLElement;
      if (target.closest('input, button, textarea')) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const togglePlay = useCallback(() => {
    const playlist = playlistRef.current;
    if (!playlist) return;
    if (playlist.isPlaying) playlist.pause();
    else playlist.play();
  }, []);

  const handleWordClick = useCallback((wordId: string) => {
    const playlist = playlistRef.current;
    if (!playlist) return;
    const [, ayahStr] = wordId.split(':');
    const index = timings.ayahs.findIndex(a => a.ayah === Number(ayahStr));
    if (index === -1) return;
    const word = timings.ayahs[index].words.find(w => w.id === wordId);
    playlist.seekToAyah(index, word?.startMs ?? 0);
    setAyahIndex(index);
    engineRef.current?.setWords(timings.ayahs[index].words);
    playlist.play();
    resume();
  }, [timings, resume]);

  const handleAyahPlay = useCallback((ayah: number) => {
    const playlist = playlistRef.current;
    if (!playlist) return;
    const index = timings.ayahs.findIndex(a => a.ayah === ayah);
    if (index === -1) return;
    playlist.seekToAyah(index, 0);
    setAyahIndex(index);
    engineRef.current?.setWords(timings.ayahs[index].words);
    playlist.play();
    resume();
  }, [timings, resume]);

  const handleSeek = useCallback((globalMs: number) => {
    const playlist = playlistRef.current;
    if (!playlist) return;
    const { ayahIndex: index, localMs } = timeline.globalToLocal(globalMs);
    playlist.seekToAyah(index, localMs);
    setAyahIndex(index);
    engineRef.current?.setWords(timings.ayahs[index]?.words ?? []);
    setCurrentMs(globalMs);
  }, [timeline, timings]);

  return (
    <main className="min-h-screen bg-white">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← All surahs
        </Link>
        <ScriptToggle script={script} onChange={changeScript} />
      </header>

      <div className="mx-auto max-w-3xl px-4 text-center">
        <h1 className="text-3xl">{meta.nameArabic}</h1>
        <p className="text-neutral-500">{meta.nameSimple} · {meta.nameEnglish}</p>
        <p className="mt-1 text-xs text-neutral-400">AbdulBaset AbdulSamad · Murattal</p>
      </div>

      {error && (
        <div role="alert" className="mx-auto mt-4 max-w-3xl px-4">
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}{' '}
            <button type="button" className="underline" onClick={togglePlay}>
              Try again
            </button>
          </div>
        </div>
      )}

      <QuranReader
        text={text}
        script={script}
        registry={registry}
        activeAyah={activeAyah}
        onWordClick={handleWordClick}
        onAyahPlay={handleAyahPlay}
      />

      <JumpToAyahPill visible={suspended && isPlaying} onClick={resume} />

      <AudioPlayer
        isPlaying={isPlaying}
        isLoading={isLoading}
        currentMs={currentMs}
        totalMs={totalMs}
        volume={volume}
        ayahLabel={`Ayah ${activeAyah} / ${meta.ayahCount}`}
        onPlayPause={togglePlay}
        onPrev={() => playlistRef.current?.prev()}
        onNext={() => playlistRef.current?.next()}
        onSeek={handleSeek}
        onVolumeChange={setVolume}
      />
    </main>
  );
}
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: success, with `/surah/1` listed among generated routes.

- [ ] **Step 4: Verify in a browser**

Run: `npm run dev` and open `http://localhost:3000/surah/1/`.

Confirm by observation:
- Arabic text renders with tajweed colors
- Pressing play highlights words one at a time, moving with the recitation
- Playback continues past ayah 1 into ayah 2 without stopping
- Ayah 4's three words highlight as a group with the softer tint
- Clicking a word jumps the audio to it
- The IndoPak toggle changes both the text and the font
- Scrolling manually reveals the "Jump to current ayah" pill

- [ ] **Step 5: Commit**

```bash
git add app/surah
git commit -m "feat: wire the surah reader page with continuous playback"
```

---

## Task 14: Home page and error states

**Files:**
- Modify: `app/page.tsx`, `app/layout.tsx`
- Create: `app/not-found.tsx`
- Test: `app/__tests__/home.test.tsx`

**Interfaces:**
- Consumes: `getSurahList` from Task 9
- Produces: the surah index at `/`

- [ ] **Step 1: Write the failing test**

Create `app/__tests__/home.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SurahList } from '../SurahList';
import type { SurahMeta } from '@/lib/data/types';

vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

const surahs: SurahMeta[] = [
  { id: 1, nameArabic: 'الفاتحة', nameSimple: 'Al-Fatihah', nameEnglish: 'The Opener', ayahCount: 7, revelationPlace: 'makkah', available: true },
  { id: 2, nameArabic: 'البقرة', nameSimple: 'Al-Baqarah', nameEnglish: 'The Cow', ayahCount: 286, revelationPlace: 'madinah', available: false },
];

describe('SurahList', () => {
  it('links available surahs', () => {
    render(<SurahList surahs={surahs} />);
    expect(screen.getByRole('link', { name: /Al-Fatihah/ })).toHaveAttribute('href', '/surah/1');
  });

  it('does not link unavailable surahs', () => {
    render(<SurahList surahs={surahs} />);
    expect(screen.queryByRole('link', { name: /Al-Baqarah/ })).toBeNull();
    expect(screen.getByText(/Al-Baqarah/)).toBeInTheDocument();
  });

  it('marks unavailable surahs as coming soon', () => {
    render(<SurahList surahs={surahs} />);
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it('shows ayah counts', () => {
    render(<SurahList surahs={surahs} />);
    expect(screen.getByText('7 ayahs')).toBeInTheDocument();
    expect(screen.getByText('286 ayahs')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/__tests__/home.test.tsx`
Expected: FAIL — cannot resolve `../SurahList`.

- [ ] **Step 3: Implement**

Create `app/SurahList.tsx`:

```tsx
import Link from 'next/link';
import type { SurahMeta } from '@/lib/data/types';

export function SurahList({ surahs }: { surahs: SurahMeta[] }) {
  return (
    <ul className="divide-y divide-neutral-100">
      {surahs.map(surah => {
        const body = (
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-4">
              <span className="w-8 text-sm tabular-nums text-neutral-400">{surah.id}</span>
              <div>
                <div className="font-medium">{surah.nameSimple}</div>
                <div className="text-sm text-neutral-500">{surah.nameEnglish}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg" dir="rtl">{surah.nameArabic}</div>
              <div className="text-xs text-neutral-400">
                {surah.available ? `${surah.ayahCount} ayahs` : `${surah.ayahCount} ayahs · coming soon`}
              </div>
            </div>
          </div>
        );

        return (
          <li key={surah.id} className={surah.available ? '' : 'opacity-40'}>
            {surah.available
              ? <Link href={`/surah/${surah.id}`} className="block hover:bg-neutral-50">{body}</Link>
              : body}
          </li>
        );
      })}
    </ul>
  );
}
```

Replace `app/page.tsx`:

```tsx
import { getSurahList } from '@/lib/data/loaders';
import { SurahList } from './SurahList';

export const metadata = {
  title: 'Quran — listen and follow every word',
  description:
    'Listen to the Quran recited by AbdulBaset AbdulSamad while each word is highlighted in time with the recitation.',
};

export default function HomePage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-10">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-semibold">Quran</h1>
        <p className="mt-1 text-neutral-500">Listen · Read · Follow along</p>
      </header>
      <SurahList surahs={getSurahList()} />
    </main>
  );
}
```

Create `app/not-found.tsx`:

```tsx
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">Surah not available yet</h1>
      <p className="text-neutral-500">
        This surah&apos;s recitation data has not been added yet.
      </p>
      <Link href="/" className="text-neutral-900 underline">Back to all surahs</Link>
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/__tests__/home.test.tsx`
Expected: 4 passing.

- [ ] **Step 5: Run the whole suite and build**

Run: `npm test && npm run build`
Expected: all suites pass; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add app
git commit -m "feat: add surah index and not-found page"
```

---

## Task 15: Offline detection and responsive polish

**Files:**
- Create: `components/OfflineBanner.tsx`
- Modify: `app/layout.tsx`, `app/globals.css`

**Interfaces:**
- Consumes: nothing
- Produces: `<OfflineBanner />`

- [ ] **Step 1: Implement the banner**

Create `components/OfflineBanner.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div role="status" className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
      Connection lost. Please check your internet connection.
    </div>
  );
}
```

- [ ] **Step 2: Mount it in the layout**

Modify `app/layout.tsx` so the `<body>` contains the banner above `{children}`:

```tsx
import { OfflineBanner } from '@/components/OfflineBanner';
```

and inside the body element:

```tsx
<OfflineBanner />
{children}
```

- [ ] **Step 3: Add mobile spacing so the sticky player never covers text**

Append to `app/globals.css`:

```css
@media (max-width: 640px) {
  .quran-text {
    font-size: clamp(1.5rem, 7vw, 2rem);
    line-height: 2.2;
  }
}

/* The fixed player is roughly 96px tall; keep the last ayah reachable. */
main { padding-bottom: 7rem; }
```

- [ ] **Step 4: Verify responsive behaviour**

Run `npm run dev`, open `/surah/1/`, and check at 375px width:
- The last ayah scrolls clear of the player
- Word highlight boxes do not overlap between lines
- Controls are tappable

- [ ] **Step 5: Commit**

```bash
git add components/OfflineBanner.tsx app/layout.tsx app/globals.css
git commit -m "feat: add offline banner and mobile layout adjustments"
```

---

## Task 16: Documentation and push

**Files:**
- Create: `docs/DATA_SOURCES.md`, `README.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: everything
- Produces: a pushed public repository

- [ ] **Step 1: Write `docs/DATA_SOURCES.md`**

```markdown
# Data Sources

Every external dataset used by this project, with its licence and how it is used.

## Quran text

- **Source:** Quran.com API v4 (`api.quran.com/api/v4`)
- **Fields:** `text_uthmani_tajweed`, `text_indopak`
- **Use:** fetched once at build time, committed to `data/text/`
- **Underlying text:** Tanzil / King Fahd Complex Uthmani and IndoPak scripts
- **Runtime dependency:** none

## Word timings

- **Source:** Quran.com API v4, `/recitations/2/by_chapter/{n}?fields=segments`
- **Format:** `[startWordIndex, endWordIndexExclusive, startMs, endMs]`
- **Use:** normalized at build time into one timing per word, committed to
  `data/timings/abdulbasit-murattal/`
- **Runtime dependency:** none

## Audio

- **Reciter:** AbdulBaset AbdulSamad (Murattal)
- **Source:** `verses.quran.com`, downloaded at build time
- **Hosting:** self-hosted from `public/audio/`, copied byte-for-byte
- **Status:** REDISTRIBUTION — self-hosting is not the same as linking. The
  rights position for these recordings must be confirmed before this site is
  made public. If confirmation cannot be obtained, revert to linking the
  files at their origin instead of serving them.

## Fonts

| Font | Use | Licence |
|---|---|---|
| Amiri Quran | Uthmani/tajweed rendering | SIL Open Font License 1.1 |
| Noto Naskh Arabic | IndoPak rendering | SIL Open Font License 1.1 |

Both licences permit embedding and redistribution. Copies of the licences are
included with the font files.

## Attribution

Quran text and timing data are provided by Quran.com. This project is not
affiliated with or endorsed by Quran.com.
```

- [ ] **Step 2: Write `README.md`**

```markdown
# Quran — word-by-word recitation

Listen to the Quran while each word is highlighted in time with the recitation.

Currently covers **Surah Al-Fatihah**, recited by AbdulBaset AbdulSamad (Murattal),
in both Tajweed and IndoPak scripts.

## Running it

```bash
npm install
npm run fetch:fonts          # downloads the two OFL fonts
npm run fetch:data -- --surahs=1
npm run dev
```

## Adding more surahs

```bash
npm run fetch:data -- --surahs=1-114
```

The script is incremental: audio files already on disk are skipped, so it can be
interrupted and re-run. Note the full audio set is roughly 3.35 GB — see the
design spec for how that is intended to be stored.

## Tests

```bash
npm test
```

The most important tests cover `lib/normalize/`, which converts Quran.com's
range-segments into one timing per word. Its fixtures are real API responses,
including the two awkward cases: `1:4`, where one segment covers three words,
and `2:23`, where one word has no segment at all.

## How it works

- All Quran text, timings, and audio are fetched once at build time and
  committed. Nothing contacts a third party at runtime.
- `lib/sync/` is pure TypeScript with no React imports. It reads audio position
  on `requestAnimationFrame` and resolves the active word by binary search.
- Highlighting bypasses React entirely: the surah renders once, and the engine
  toggles a class on two DOM nodes per change.

See `docs/superpowers/specs/` for the full design and `docs/DATA_SOURCES.md` for
licensing.
```

- [ ] **Step 3: Run the full verification before pushing**

Run:

```bash
npm test
npm run build
```

Expected: all tests pass, build succeeds. Do not continue if either fails.

- [ ] **Step 4: Commit the documentation**

```bash
git add README.md docs/DATA_SOURCES.md .gitignore
git commit -m "docs: add README and data source licensing record"
```

- [ ] **Step 5: Create the repository and push**

```bash
gh auth switch --user umairnawaz333
gh repo create quran-word-sync --public --source=. --remote=origin \
  --description "Listen to the Quran with word-by-word highlighting synchronized to the recitation"
git push -u origin master
```

Verify: `gh repo view --web` opens the repository and shows the README.

- [ ] **Step 6: Confirm the pushed repository is complete**

```bash
gh repo view umairnawaz333/quran-word-sync --json name,visibility,diskUsage
git ls-files public/audio | wc -l    # expect 7
```

---

## Self-Review

**Spec coverage.** Each spec section maps to a task:

| Spec section | Task |
|---|---|
| §2.2 range segments | 3 |
| §2.3 reciter choice | 5 |
| §2.4 dual scripts | 5, 10 |
| §2.5 duration estimates | 6 |
| §2.6 self-hosted audio | 5, 8 |
| §3 architecture | 1, and the file structure above |
| §4 data pipeline | 5 |
| §5 normalizer | 3 |
| §6 continuous playback | 8, 13 |
| §7 sync engine | 7 |
| §8 typography, tajweed palette | 4, 9, 10 |
| §9 interaction, auto-scroll | 10, 12, 13 |
| §10 routes | 13, 14 |
| §11 error handling | 13, 14, 15 |
| §12 testing | 2, 3, 6, 7, 8, 10, 11, 12, 14 |
| §13 phasing | 5 |
| §14 repository | 16 |

**Known gap, deliberately deferred:** the spec's cross-script invariant test
(§12) is covered structurally in Task 10 — both scripts render from the same
`words` array, so identical ids are guaranteed by construction — rather than as a
data-wide sweep. A full sweep becomes meaningful in Phase 2, when there is more
than one surah of data to sweep.

**Type consistency check.** `WordTiming` is defined once in
`lib/normalize/types.ts` and re-exported from `lib/data/types.ts`. `AyahTiming`,
`SurahTimings`, `SurahText`, `SurahWord`, and `SurahMeta` are defined once in
`lib/data/types.ts`. `Script` is defined in `components/QuranWord.tsx` and
imported everywhere else. `registry.setActive(id, estimated)` takes the same two
arguments at both its definition (Task 10) and its call site (Task 13).
`timeline.setActualDuration(index, durationMs, playheadIndex)` likewise.
