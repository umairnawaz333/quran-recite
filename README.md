# Quran — word-by-word recitation

Listen to the Quran while each word is highlighted in time with the recitation.

The reciter is AbdulBaset AbdulSamad, **Murattal** style (Quran.com recitation
id 2) — chosen over his Mujawwad recording because its word-timing segment
data is materially cleaner. Every surah can be rendered in either of two
scripts:

- **Tajweed** — Uthmani text with colour-coded tajweed rules, set in Amiri Quran
- **IndoPak** — set in Noto Naskh Arabic

Both fonts are SIL Open Font License and self-hosted; see
[`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md).

**Data status:** only **Surah 1 (Al-Fatihah)** has text, timings, and audio
committed so far. The other 113 surahs are listed in the surah picker but are
marked unavailable until their data is fetched — see "Adding more surahs"
below.

## Running it

```bash
npm install
npm run fetch:fonts          # downloads the two OFL fonts
npm run fetch:data -- --surahs=1
npm run dev
```

## Adding more surahs

```bash
npm run fetch:data -- --surahs=1,2,3    # a comma-separated list
npm run fetch:data -- --surahs=1-114    # a range
npm run fetch:data                      # no --surahs: defaults to surah 1
```

`scripts/fetch-quran-data.ts` is incremental and resumable: audio files
already on disk are skipped rather than re-downloaded, and `data/surahs.json`
/ `data/validation-report.json` are rewritten after every surah, not just at
the end of the run — so an interrupted multi-surah fetch can simply be re-run
and it picks up where it left off.

Be aware that the full audio set for all 114 surahs is roughly **3.35 GB**.
That is why only surah 1's audio is committed to this repository today, and
how the remaining surahs' audio should be stored (committed to the repo,
external object storage, on-demand fetch, etc.) is still an open decision, not
one this codebase has made yet.

## Tests

```bash
npm test
```

The most important tests cover `lib/normalize/`, which converts Quran.com's
range-segments (one segment can span several words, or a word can have no
segment at all) into exactly one timing per word. Its fixtures are real API
responses, including two awkward real cases: `1:4`, where a single segment
covers all three words of the ayah, and `2:23`, where one word in the ayah has
no segment at all and must be absorbed into a neighbouring segment's span.

## How it works

- All Quran text, timings, and audio are fetched once at build time by
  `scripts/fetch-quran-data.ts` and committed. The running app contacts no
  third party at runtime — audio is served from `public/audio/`, not
  hotlinked.
- `lib/sync/engine.ts` is pure TypeScript with no React imports. It reads
  audio position on `requestAnimationFrame` (rather than the coarser
  `timeupdate` event) and resolves the active word by binary search over its
  `[startMs, endMs)` timings.
- Highlighting bypasses React's render cycle entirely: the surah renders once,
  and `lib/reader/wordRegistry.ts` toggles a class directly on two DOM nodes
  (the previously active word and the newly active one) per change.

See [`docs/superpowers/specs/`](docs/superpowers/specs/) for the full design
and [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md) for licensing, including the
unresolved audio-redistribution question.
