# Quran Recitation & Word-by-Word Highlighting — Design Spec

**Date:** 2026-08-09
**Status:** Approved for planning
**Source PRD:** [`docs/PRD.md`](../../PRD.md)

---

## 1. Scope

Build the core listening experience: open a surah, press play, watch the currently
recited word highlight in real time, in either Tajweed or IndoPak script.

**Destination:** public, free, non-commercial site.

### In scope

- 114 surahs (data fetched incrementally — see §13 Phasing)
- One reciter: AbdulBaset AbdulSamad, Murattal
- Two scripts: Tajweed (Uthmani, color-coded) and IndoPak, user-togglable
- Word-level highlighting synchronized to audio
- Continuous playback through the entire surah, ayah to ayah, without user action
- Whole-surah progress bar with seeking
- Play/pause, previous/next ayah, volume
- Start playback from any ayah; start playback from any word
- Auto-scroll to the active ayah, with manual-scroll override
- Responsive desktop/tablet/mobile
- Basic error handling

### Out of scope this round

Playback speed control, surah search, settings panel, dark mode, font-size
controls, repeat modes, translations, transliteration, bookmarks, analytics,
dedicated SEO work, additional reciters.

The data schema and provider interfaces accommodate all of these; they are simply
not built now.

---

## 2. Decisions and evidence

Every decision below was validated against the live Quran.com API v4 before being
written down.

### 2.1 Word timings exist and are usable

`GET /api/v4/verses/by_chapter/{n}?words=true&audio={reciterId}` returns words and
their audio segments in a single response, so word identity and timing come from
one source. This eliminates PRD Risk 2 (mismatched word segmentation across
providers).

### 2.2 The segment format is a word *range*, not one entry per word

This is the single most important technical finding, and the PRD's §11 algorithm
is wrong about it.

Each segment is `[startWordIndex, endWordIndexExclusive, startMs, endMs]`:

```
1:1 → [[0,1,600,970], [1,2,980,1560], [2,3,1570,2520], [3,4,2530,3920]]
      four segments, one word each — the common case

1:4 → [[0,3,0,4573]]
      ONE segment covering all THREE words مَـٰلِكِ يَوْمِ ٱلدِّينِ

2:23 → [..., [9,10,10920,13960], [11,12,13970,14850], ...]
      index 10 (position 11, مِّن) has NO segment at all
```

Naively assuming one segment per word mis-highlights both cases. The normalizer
(§5) exists specifically to resolve this.

### 2.3 Reciter choice: AbdulBaset **Murattal** (id 2), not Mujawwad (id 1)

Measured segment-count vs. word-count mismatches:

| Surah | Mujawwad (id 1) | Murattal (id 2) |
|---|---|---|
| 1 Al-Fatihah | 1 / 7 | 1 / 7 |
| 2 Al-Baqarah | 35 / 286 | **1 / 286** |
| 18 Al-Kahf | 6 / 110 | **0 / 110** |
| 55 Ar-Rahman | 2 / 78 | **0 / 78** |
| 114 An-Nas | 0 / 6 | 0 / 6 |

Murattal's timing data is materially cleaner, and its steadier pace suits
follow-along reading.

### 2.4 Both scripts come from one call, with identical word positions

```
pos 4  indopak: رَيۡبٍ    tajweed: رَيۡ<rule class=idgham_ghunnah>بٍ</rule>
pos 5  indopak: مِّمَّا    tajweed: <rule class=idgham_ghunnah>م</rule>ِّ<rule class=ghunnah>مّ</rule>َا
```

Same word count, same positions, same IDs. **The script toggle is a pure
render-layer swap.** Sync engine, timings, and word IDs are untouched by it.

Tajweed markup is Uthmani-only; there is no IndoPak tajweed variant. IndoPak mode
therefore renders without rule colors.

### 2.5 Durations come from the API, refined at runtime

The API's `duration` field is integer seconds (`"duration": 4`), so a build-time
offset table carries up to ±0.5 s of error per ayah. That is accepted: the
progress bar is a navigation aid, and downloading every MP3 to measure exact
durations would mean 6,236 file reads in Phase 2 for a cosmetic gain.

Instead, each ayah's true duration becomes known the moment its audio loads
(`loadedmetadata`), and the offset table is corrected then — see §6.

Uninterrupted playback through the whole surah is the actual priority, not
progress-bar precision.

### 2.6 Audio is downloaded and self-hosted

The application must not depend on any third party at runtime. Per-ayah MP3s are
downloaded once by the build script and served from the project itself. Quran.com
is a build-time source only; nothing calls out to it when a user loads the page.

Measured size, from 640 sampled ayahs across eight surahs:

| Metric | Value |
|---|---|
| Bitrate | 194 kbps |
| Per ayah | 0.54 MB |
| Al-Baqarah alone | 232 MB |
| **Full Quran (6,236 ayahs)** | **~3.35 GB** |

Phase 1 (Al-Fatihah, 7 files, 1.0 MB) is committed directly with no complications.

Phase 2's 3.35 GB exceeds what a normal Git repository should carry, so the
storage mechanism for the full set is decided before Phase 2 begins — see §14.

Files are downloaded byte-for-byte unmodified. Re-encoding is avoided by default
because codec encoder delay shifts playback by tens of milliseconds, which is
significant against the 50–100 ms sync accuracy target.

**Licensing note (PRD §42):** hotlinking and self-hosting carry different
obligations. Self-hosting AbdulBaset AbdulSamad's recordings is a redistribution,
and the rights position must be recorded in `DATA_SOURCES.md` before the site goes
public.

---

## 3. Architecture

Single Next.js application with static export. No monorepo, no `packages/`
workspace, no backend — the PRD's structure is more machinery than this scope
needs.

```
quran-caption-highlighted/
├── app/
│   ├── page.tsx                    # surah list
│   └── surah/[id]/page.tsx         # reader
├── components/
│   ├── QuranReader.tsx
│   ├── AyahBlock.tsx
│   ├── QuranWord.tsx
│   ├── AudioPlayer.tsx
│   ├── ProgressBar.tsx
│   └── ScriptToggle.tsx
├── lib/
│   ├── sync/                       # pure TS, zero React imports
│   │   ├── engine.ts
│   │   ├── timeline.ts
│   │   └── types.ts
│   ├── audio/
│   │   └── playlist.ts             # double-buffered element pair
│   └── data/
│       └── loaders.ts
├── scripts/
│   ├── fetch-quran-data.ts
│   └── normalize-segments.ts
├── data/                           # committed build output
├── public/fonts/
└── docs/
    └── DATA_SOURCES.md
```

`lib/sync/` importing nothing from React is what satisfies PRD §45's isolation
requirement — the engine is testable standalone and reusable by a future mobile
client, without workspace tooling.

---

## 4. Data pipeline

`scripts/fetch-quran-data.ts` runs at build time and is **parameterized by surah
list**, so the same script serves both the initial single-surah build and the
later full fetch.

```bash
pnpm fetch:data --surahs 1          # phase 1
pnpm fetch:data --surahs 1-114      # phase 2, no code changes
```

Steps per surah:

1. `GET /verses/by_chapter/{n}?words=true&audio=2&word_fields=text_uthmani_tajweed,text_indopak`
2. Filter to `char_type_name === "word"` (drops the `end` ayah-number glyph)
3. Run the normalizer (§5) over the segments
4. Read each ayah's `duration` (integer seconds) from
   `/recitations/2/by_chapter/{n}?fields=segments,duration`
5. Compute the cumulative offset table from those durations
6. **Download each ayah MP3** into `public/audio/abdulbasit-murattal/`, skipping
   files already present so re-runs are incremental and resumable
7. Write JSON; append anomalies to the validation report

Downloads are concurrency-limited and retried on failure. The script is
idempotent: interrupting and re-running it resumes rather than restarting.

### Output files

```
data/
├── surahs.json
├── reciters.json
├── text/{surah}.json
├── timings/abdulbasit-murattal/{surah}.json
└── validation-report.json
```

**`text/{surah}.json`**

```json
{
  "surah": 1,
  "ayahs": [
    {
      "ayah": 1,
      "words": [
        {
          "id": "1:1:1",
          "position": 1,
          "tajweed": "بِسۡمِ",
          "indopak": "بِسۡمِ"
        }
      ]
    }
  ]
}
```

**`timings/abdulbasit-murattal/{surah}.json`**

```json
{
  "surah": 1,
  "reciterId": "abdulbasit-murattal",
  "surahDurationMs": 96000,
  "ayahs": [
    {
      "ayah": 1,
      "audioUrl": "/audio/abdulbasit-murattal/001001.mp3",
      "startOffsetMs": 0,
      "durationMs": 4000,
      "words": [
        { "id": "1:1:1", "startMs": 600, "endMs": 970, "estimated": false }
      ]
    }
  ]
}
```

Word timings are **local to their own ayah's audio file** (each file starts at 0).
`startOffsetMs` maps an ayah into the global surah timeline.

**`validation-report.json`** records, per surah: ayahs processed, merged groups
found, words with interpolated timings, words with no source segment, and any
ayah where normalization failed. This is reviewed before UI work begins.

---

## 5. The segment normalizer

The heart of the project. Converts range-segments into exactly one timing entry
per word. Lives in `scripts/normalize-segments.ts`, pure and independently
testable.

**Input:** word list (positions `1..n`) + raw segments `[a, b, startMs, endMs]`
**Output:** one `{ id, startMs, endMs, estimated }` per word, no gaps, sorted

### Case A — one segment, one word

`b - a === 1`. Direct assignment. `estimated: false`.

### Case B — one segment, multiple words (merged group)

`b - a > 1`, e.g. `1:4 → [0, 3, 0, 4573]`.

Sub-word timing does not exist in the source, so the split is an interpolation and
is labelled as such. Duration is divided proportionally by **base-letter count**,
with Arabic diacritics stripped before counting, since diacritics do not consume
recitation time:

```
strip U+064B–U+0652, U+0670, U+06D6–U+06ED, U+0640 (tatweel)
weight_i = baseLetterCount(word_i) / Σ baseLetterCount
```

Each resulting word gets `estimated: true` and shares a `groupId`.

### Case C — word with no covering segment

e.g. `2:23` position 11. The word is absorbed into the **preceding** segment's
group, which is then re-split by Case B's rule. If the gap is at the very start of
an ayah, it absorbs into the following segment instead. No word is ever left
without a timing.

### Post-conditions (asserted, and failure aborts the build)

- Exactly one entry per word, in ascending position order
- `startMs < endMs` for every entry
- No overlaps; no gaps larger than 1 ms between consecutive entries

Note: word timings are **not** validated against `durationMs`, because that value
is a rounded API estimate (§2.5) and a final `endMs` may legitimately exceed it.
Segment timings are authoritative; durations are not.

---

## 6. Audio playback

### Continuous surah playback — a primary requirement

Pressing play once must recite the surah from the current position through to its
final ayah with no further user action and no audible stall at ayah boundaries.
Playback stops only at the end of the surah, or when the user pauses.

Word timings only exist for per-ayah files, so playback is a playlist rather than
one continuous file. Two `<audio>` elements alternate: while ayah N plays, N+1
preloads into the idle element. On `ended`, the buffers swap and playback starts
immediately.

Boundary handling:

- If ayah N+1 has not finished buffering when N ends, show a brief loading state
  and start it as soon as it is ready — never silently stop
- If an ayah fails to load mid-surah, surface the error and offer retry rather
  than skipping it silently
- On reaching the last ayah, stop and reset to the surah's start

### Global timeline

`lib/sync/timeline.ts` owns the mapping in both directions:

```ts
globalToLocal(globalMs): { ayahIndex: number; localMs: number }  // binary search offsets
localToGlobal(ayahIndex, localMs): number                         // offset + local
```

Offsets are seeded from the API's integer-second durations, then **corrected at
runtime**: when an ayah's audio fires `loadedmetadata`, its true duration replaces
the estimate and subsequent offsets are recomputed.

Corrections apply only to offsets **ahead of the playhead**, so the progress bar
never jumps backward under the user. Because ayahs preload one ahead of playback,
the table converges on exact values as the surah plays.

The progress bar displays whole-surah elapsed/total time. Dragging updates the
displayed position only; the actual seek and any audio-element swap commit on
`pointerup`, so scrubbing across ayahs doesn't thrash network requests.

---

## 7. Sync engine

`lib/sync/engine.ts`. Pure TypeScript, no React.

- Driven by **`requestAnimationFrame`**, not the `timeupdate` event. `timeupdate`
  fires roughly 4 times per second (~250 ms), which cannot meet the PRD §54
  accuracy target of 50–100 ms.
- Resolves the active word by **binary search** over the current ayah's sorted
  `startMs` array — O(log n), comfortable even for Al-Baqarah's ~6,100 words.
- Emits `activeWordId` **only on change**. A 60 fps loop therefore produces two to
  three updates per second, not sixty.

```ts
interface SyncEngine {
  attach(audio: HTMLAudioElement, ayahTimings: WordTiming[]): void;
  onActiveWordChange(cb: (wordId: string | null) => void): Unsubscribe;
  detach(): void;
}
```

---

## 8. Rendering and typography

### Word elements

Every word renders as `<span data-word-id="1:1:1">`. In Tajweed mode the span's
inner HTML is the API's rule markup; in IndoPak mode it is a plain string.

### Highlight bypasses React

Per PRD §30, the surah renders once and does **not** re-render during playback.
The sync engine's callback toggles a CSS class on exactly two DOM nodes — the
outgoing word and the incoming one — via a ref map keyed by word ID.

### Highlight is a background, never a foreground color

Tajweed rules own the text color. Recoloring the active word would destroy the
tajweed information, so the highlight is a rounded background box with a smooth
transition. IndoPak mode uses the identical treatment for consistency.

Words with `estimated: true` get a visually softer highlight, so the UI never
claims precision the data does not have.

### Fonts

Both SIL Open Font License, self-hosted in `public/fonts/`, **loaded on demand** —
a user only downloads the script they are actually viewing.

| Mode | Text field | Font |
|---|---|---|
| Tajweed | `text_uthmani_tajweed` | Amiri Quran |
| IndoPak | `text_indopak` | Noto Naskh Arabic |

Noto Naskh Arabic is chosen over Noto Nastaliq Urdu because printed IndoPak
mushafs are naskh, the file is far smaller, and Nastaliq's cascading baseline
makes per-word highlight boxes overlap awkwardly.

Container styling: `direction: rtl`, generous line-height, font size well above
body text, scaling with viewport.

### Tajweed palette

Rule classes to style: `ham_wasl`, `slnt`, `laam_shamsiyah`, `madda_normal`,
`madda_permissible`, `madda_necessary`, `madda_obligatory`, `ikhafa`,
`ikhafa_shafawi`, `idgham_ghunnah`, `idgham_wo_ghunnah`, `idgham_shafawi`,
`idgham_mutajanisayn`, `idgham_mutaqaribayn`, `iqlab`, `qalqalah`, `ghunnah`.

Starting palette (conventional mushaf colors):

| Class | Color |
|---|---|
| `madda_necessary` | `#E13B3B` |
| `madda_obligatory`, `madda_permissible` | `#FF7E1E` |
| `madda_normal` | `#537FFF` |
| `qalqalah` | `#DD0008` |
| `ikhafa`, `ikhafa_shafawi` | `#9400A8` |
| `idgham_ghunnah`, `ghunnah` | `#169200` |
| `iqlab` | `#26BFFD` |
| `ham_wasl`, `slnt`, `laam_shamsiyah`, remaining idgham variants | `#A1A1A1` |

**Constraint:** every one of these must remain legible against the active-word
highlight background. The highlight color is chosen *after* the palette and
contrast-checked against all of them, not the reverse.

---

## 9. Interaction

| Action | Behavior |
|---|---|
| Click a word | Look up its `startMs`, load that ayah's audio, seek, play, highlight it |
| Click an ayah's play button | Start at that ayah's first word |
| Previous / next ayah | Jump to the adjacent ayah's start |
| Drag progress bar | Preview position while dragging; seek on release |
| Script toggle | Swap rendered text and font; playback and highlight position unaffected |

Script choice persists to `localStorage`.

### Auto-scroll

The active ayah is scrolled into view with
`scrollIntoView({ behavior: 'smooth', block: 'center' })`. A manual scroll
(detected via a wheel/touch listener, distinguished from programmatic scrolling by
a suppression flag) suspends auto-scroll and reveals a "Jump to current ayah"
pill. Tapping it resumes auto-scroll.

---

## 10. Routes

Static export (`output: 'export'`), all pages pre-rendered.

| Route | Content |
|---|---|
| `/` | List of surahs (number, Arabic name, English name, ayah count) |
| `/surah/[id]` | Reader; `?ayah=N` deep-links and starts scrolled to that ayah |

No search box this round.

---

## 11. Error handling

| Condition | Behavior |
|---|---|
| Ayah audio fails to load | Inline notice: "Unable to load this recitation." Retry button. Playback stops; text stays readable. |
| Timing data missing for a surah | Audio still plays; word highlighting silently disabled. **No incorrect highlighting under any circumstance** (PRD §34). |
| Network offline | Banner: "Connection lost. Please check your internet connection." Already-loaded text remains usable. |
| Surah data file absent (not yet fetched) | Surah list marks it unavailable rather than linking to a broken page. |

That last row matters during Phase 1, when only Surah 1 has data.

---

## 12. Testing

### Unit — the normalizer (highest value)

Fixtures captured verbatim from the live API, committed as JSON:

- `1:1` — four one-word segments (the happy path)
- `1:4` — `[[0,3,0,4573]]`, one segment covering three words (Case B)
- `2:23` — missing segment at index 10 (Case C)

Plus property tests asserting the §5 post-conditions hold for every ayah in the
fetched dataset.

### Unit — sync engine

Binary search correctness at boundaries: exact `startMs`, exact `endMs`, before
the first word, after the last word, and empty timing arrays.

### Unit — timeline

`globalToLocal` / `localToGlobal` round-trip for arbitrary positions, including
exact ayah boundaries.

### Cross-script invariant

For every ayah, the Tajweed and IndoPak renderings must produce identical word-ID
sets. This is the permanent regression guard on PRD Risk 2.

### Component

Highlight advances correctly against a simulated timeline; seeking updates the
highlighted word; clicking a word seeks to the right position.

### Manual (PRD §52)

Short and long surahs, seeking mid-ayah, ayah-boundary transitions, browser
refresh, iOS Safari and Android Chrome, throttled network. Particular attention to
synchronization immediately after a seek.

---

## 13. Phasing

**Phase 1 — Surah 1 only.** Run the fetch script for Al-Fatihah, review the
validation report, and build the complete application against that single surah.
Al-Fatihah is a strong test case because `1:4` exercises the merged-group path.
The `2:23` gap case is covered by committed fixtures without needing Surah 2's
data.

**Phase 2 — after Phase 1 is verified.** Re-run `pnpm fetch:data --surahs 1-114`.
No application code changes; only `data/` grows and more surah-list entries become
available.

---

## 14. Repository and hosting

The whole project — application code, `data/`, audio, fonts, and docs — lives in a
new public GitHub repository under the personal account **`umairnawaz333`**.

Committing `data/` and the audio is the deliberate mechanism for runtime
independence: once fetched, nothing external is contacted when a user loads a
page.

### Phase 1 — no complications

Al-Fatihah's text and timing JSON (a few KB) plus 7 MP3s (1.0 MB) commit
directly.

### Phase 2 — the full set needs a storage decision

| Content | Size |
|---|---|
| Text + timings, all 114 surahs | ~20 MB |
| **Audio, all 6,236 ayahs** | **~3.35 GB** |

The JSON is trivial. The audio is not: 3.35 GB exceeds GitHub's ~1 GB recommended
repository size, makes `git clone` slow, and needs a paid Git LFS plan (free tier
is 1 GB storage and 1 GB/month bandwidth).

Candidate approaches, to be decided before Phase 2 starts:

| Approach | Repo size | Runtime dependency | Cost |
|---|---|---|---|
| Commit originals via Git LFS | 3.35 GB | None | ~$5/mo |
| Re-encode to 64 kbps MP3, commit | ~1.1 GB | None | Free; small constant sync offset to calibrate |
| Self-host on own object storage (e.g. Cloudflare R2) | ~20 MB | Own infrastructure only | Free tier covers it |
| Commit popular surahs, stream rest from own storage | ~300 MB | Own infrastructure only | Free tier covers it |

All four keep the project independent of Quran.com, which is the actual
requirement. Phase 1 proceeds identically under every option.

**Current leaning (deferred, revisit before Phase 2):** a hybrid — commit the
smaller surahs' audio to GitHub, and keep the large ones (Al-Baqarah at 232 MB
being the obvious case) out of the repository. Nothing in Phase 1 depends on this
resolving one way or the other.

To keep that option open at no cost, the audio path is resolved through a single
helper (`lib/data/audioUrl.ts`) rather than being hard-coded into components. If
some surahs later move to external storage, only that helper changes.

`.gitignore` covers `node_modules/`, `.next/`, `out/`, and local env files.

Static export means hosting is a static file drop — GitHub Pages, Vercel, or
Netlify all work at no cost, though a 3.35 GB deployment would exceed several free
hosting tiers.

---

## 15. Risks

| Risk | Status | Mitigation |
|---|---|---|
| Word timing availability | **Resolved** — verified for all 114 surahs of Murattal | — |
| Mismatched word segmentation across sources | **Resolved** — text and timings come from one API call | Cross-script invariant test |
| Merged / missing segments | **Known and handled** | Normalizer §5, validation report, `estimated` flag |
| Third-party runtime dependency | **Eliminated** — audio and data are both self-hosted | — |
| Full audio set is 3.35 GB | Open, decided before Phase 2 | Four storage options costed in §14 |
| Audio redistribution rights | Open | Rights position recorded in `DATA_SOURCES.md` before the site goes public |
| API shape changes | Low — data is fetched once and committed | Committed JSON means runtime never touches the API |
| Font licensing | Resolved — both fonts are SIL OFL | Recorded in `DATA_SOURCES.md` |

`docs/DATA_SOURCES.md` documents source, license, and attribution for the Quran
text, the audio, the timing data, and both fonts. It is written in Phase 1, not
retrofitted.

---

## 16. Definition of done (Phase 1)

A user can open the site, open Al-Fatihah, choose Tajweed or IndoPak, press play
once and hear AbdulBaset recite the surah straight through to its final ayah,
watch the correct word highlight and advance word-by-word, follow the ayah
automatically as it scrolls, pause and resume, seek anywhere in the surah via the
progress bar, start from any ayah, start from any word, and do all of this
comfortably on both desktop and mobile.

The project is pushed to `github.com/umairnawaz333/<repo>` with `data/` committed.
