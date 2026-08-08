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

- **Reciter:** AbdulBaset AbdulSamad — **Murattal** style (Quran.com recitation
  id 2). The Murattal recording was chosen over this reciter's Mujawwad
  recording because its word-timing segment data is materially cleaner.
- **Source:** `verses.quran.com`, downloaded at build time by
  `scripts/fetch-quran-data.ts`
- **Hosting:** self-hosted from `public/audio/abdulbasit-murattal/`, copied
  byte-for-byte. Nothing is hotlinked; the running app never contacts
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

## Fonts

| Font | Use | Licence |
|---|---|---|
| Amiri Quran | Uthmani/tajweed rendering | SIL Open Font License 1.1 |
| Noto Naskh Arabic | IndoPak rendering | SIL Open Font License 1.1 |

Both files were downloaded from Google Fonts by `scripts/fetch-fonts.ts` and
saved to `public/fonts/`. The licence above was verified directly, not
assumed: each file's embedded `name` table records a License URL
(`nameID` 14) of `https://openfontlicense.org`, the canonical SIL Open Font
License reference, alongside a copyright string naming the Amiri Project
Authors and the Noto Project Authors respectively. The OFL permits embedding
and redistribution as used here.

## Attribution

Quran text and timing data are provided by Quran.com. This project is not
affiliated with or endorsed by Quran.com.
