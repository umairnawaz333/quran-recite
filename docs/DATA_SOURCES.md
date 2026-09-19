# Data Sources

Every external dataset used by this project, with its licence and how it is used.

## Quran text

- **Source:** Quran.com API v4 (`api.quran.com/api/v4`)
- **Fields:** `text_uthmani_tajweed`, `text_indopak`
- **Use:** fetched once at build time, committed to `packages/quran-data/text/`
- **Underlying text:** Tanzil / King Fahd Complex Uthmani and IndoPak scripts
- **Runtime dependency:** none

## Word timings

- **Source:** Quran.com API v4, `/recitations/2/by_chapter/{n}?fields=segments`
- **Format:** `[startWordIndex, endWordIndexExclusive, startMs, endMs]`
- **Use:** normalized at build time into one timing per word, committed to
  `apps/web/public/timings/abdulbasit-murattal/` (moved out of
  `apps/web/data/` because the client fetches these files at runtime — the
  persistent player must be able to advance through, and highlight, a surah
  whose page is not currently mounted, which a build-time-only `data/` file
  cannot serve)
- **Runtime dependency:** fetched by the browser from `/timings/<reciter>/<surah>.json`

## Audio

- **Reciter:** AbdulBaset AbdulSamad — **Murattal** style (Quran.com recitation
  id 2). The Murattal recording was chosen over this reciter's Mujawwad
  recording because its word-timing segment data is materially cleaner.
- **Source:** `verses.quran.com`, downloaded at build time by
  `apps/web/scripts/fetch-quran-data.ts`
- **Hosting:** self-hosted from `apps/web/public/audio/abdulbasit-murattal/`,
  copied byte-for-byte. Nothing is hotlinked; the running app never contacts
  `quran.com` or any other third party.
- **Status: freely available recitation, redistributed for non-commercial use.**
  These recordings are distributed openly through Quran.com's public API and
  CDN and are treated by this project as free to use and redistribute for the
  non-commercial purpose of listening to and studying the Quran. They are
  served here as local copies rather than hotlinked, so that the application
  has no runtime dependency on any third party.

  No specific licence identifier is asserted, because none was independently
  verified. Anyone reusing this repository — in particular for commercial
  purposes, which are outside this project's scope — should confirm the rights
  position for themselves.

## Audio size manifest (mobile offline downloads)

- **Source:** derived, not fetched — `packages/quran-data/scripts/build-audio-sizes.mjs`
  walks the audio already fetched locally under
  `apps/web/public/audio/<reciter>/` and measures each file with `statSync`.
- **Generate it:** `npm run build:audio-sizes` from the repo root (requires
  the audio to be present locally first: `npm run fetch:data -- --surahs=1-114`).
  Re-run it whenever that committed-locally-but-gitignored audio set changes
  — a different reciter, a re-encode, or added/removed files — so the sizes
  the mobile app shows stay accurate.
- **Output:** `packages/quran-data/audio-sizes.json`, committed to the repo.
  Shape: `{ reciterId, generatedAt, totalBytes, totalFiles, surahs: { "<id>":
  { bytes, files } } }`, one entry per surah plus a grand total.
- **Use:** bundled into `apps/mobile` and read by its Settings screen and
  per-surah download controls to show a size — e.g. "Download all (2.7 GB)"
  — *before* a download starts. `totalBytes` specifically is what drives the
  confirmation prompt shown before "Download all" begins, since starting it
  can mean pulling several gigabytes over the user's connection.
- **Runtime dependency:** none — it is a static JSON file bundled with the
  app, not fetched.

## Car media browse tree (Android Auto)

- **Source:** derived, not fetched — `apps/mobile/scripts/build-car-library.mjs`
  reads `@quran/data`'s surah list (`packages/quran-data/surahs.json`), the
  same list `apps/mobile`'s own surah screen uses.
- **Generate it:** `npm run build:car-library` from the repo root. Re-run it
  whenever the surah list changes (a new field, a corrected name/ayah count)
  — a vitest test (`carLibrary` data test, see the design spec's §8) asserts
  the committed JSON still matches `getSurahList()`, so a stale file fails
  the test suite rather than silently drifting from the app it's supposed to
  mirror.
- **Output:** `modules/car-media/android/src/main/assets/car-library.json`,
  committed to the repo. Shape: `[{ id, nameSimple, nameArabic, nameEnglish,
  ayahCount }]`, one entry per surah, 114 total.
- **Use:** bundled into the Android app and read natively by
  `CarLibraryProvider` (`modules/car-media`) to answer a car head unit's
  browse/search requests for the root list of surahs — this is why browsing
  the car's Now Playing UI needs no JS runtime running at all, only the JS
  engine for actually starting playback.
- **Tested by:** the data-parity vitest test above, plus the Kotlin unit
  tests in `modules/car-media` that build the browse tree from this file and
  check search ranking against it; end-to-end via Google's Desktop Head Unit
  (see [`apps/mobile/README.md`](../apps/mobile/README.md#android-auto)).
- **Runtime dependency:** none — it is a static JSON asset bundled with the
  app, not fetched.

## Fonts

| Font | Use | Licence |
|---|---|---|
| Amiri Quran | Uthmani/tajweed rendering | SIL Open Font License 1.1 |
| Noto Naskh Arabic | IndoPak rendering | SIL Open Font License 1.1 |

Both files were downloaded from Google Fonts by
`apps/web/scripts/fetch-fonts.ts` and saved to `apps/web/public/fonts/`. The
licence above was verified directly, not assumed: each file's embedded
`name` table records a License URL
(`nameID` 14) of `https://openfontlicense.org`, the canonical SIL Open Font
License reference, alongside a copyright string naming the Amiri Project
Authors and the Noto Project Authors respectively. The OFL permits embedding
and redistribution as used here.

The same script also fetches a TTF variant of each font (Google Fonts serves
woff2 to a browser-like user agent and TTF to an older one — same families,
same licence) and saves them to `apps/mobile/assets/fonts/` as
`amiri-quran.ttf` and `noto-naskh-arabic.ttf`. React Native cannot load
woff2, so the mobile app bundles these TTFs as app assets via `expo-font`
(`apps/mobile/src/reader/fonts.ts`) rather than fetching them at runtime —
this app is built for offline use.

## Attribution

Quran text and timing data are provided by Quran.com. This project is not
affiliated with or endorsed by Quran.com.
