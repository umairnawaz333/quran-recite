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
- **Status: UNCONFIRMED / REDISTRIBUTION.** Self-hosting a copy of these
  recordings is redistribution, not linking, and redistribution carries
  different licensing obligations than simply pointing at the origin. The
  rights position for these recordings has **not** been verified as part of
  this work and no licence is asserted here. This must be confirmed — or the
  audio switched back to linking the files at their origin instead of serving
  local copies — before this site is made public.

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
