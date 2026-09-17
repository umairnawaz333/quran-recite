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

**Data status:** all **114 surahs** have text and word timings committed
(`packages/quran-data/surahs.json` marks every surah `available`;
`apps/web/public/timings/` tracks 114 timing files) and the build emits 117
static pages. Audio is the one piece that is *not* committed — see "Running
it" below for what that means for a fresh clone.

There are two apps here: `apps/web`, the shipped Next.js site, and
`apps/mobile`, an Expo/React Native Android app (see
[`apps/mobile/README.md`](apps/mobile/README.md) for how to build and run
it). Both consume the same domain logic and Quran text through
`packages/core` and `packages/quran-data`.

## Workspace layout

This is an npm-workspaces monorepo, not a single Next.js package:

- **`packages/core`** (`@quran/core`) — the platform-free domain logic: the
  timing normalizer (`normalize/`), the rAF sync engine and timeline
  (`sync/`), shared data types, audio URL resolution (`data/audioUrl.ts`),
  the timings loader (`player/timingsLoader.ts`), and the saved-position
  validator (`player/lastPosition.ts`'s `isValidPosition`), plus the tajweed
  markup parser (`normalize/tajweed.ts`'s `parseTajweed`) and the audio
  source resolver (`data/audioSource.ts`'s `resolveAyahSource`). It imports
  nothing from React, Next, node built-ins, or the DOM — enforced by
  `packages/core/__tests__/platform-free.test.ts` rather than left to
  convention — which is exactly what let `apps/mobile` (a real React Native
  app, not a hypothetical one) consume it unchanged. It has zero runtime
  dependencies and ships TypeScript source rather than compiled output, so
  there is no build step for it; each app consumes it directly from source —
  `apps/web` through Next's `transpilePackages`, `apps/mobile` through a
  Metro `watchFolders` config.
- **`packages/quran-data`** (`@quran/data`) — the Quran text and surah index
  as data, with no code: `surahs.json` and `text/*.json` (114 files, one per
  surah). Consumed by both apps — `apps/web`'s `lib/data/surahIndex.ts` and
  `lib/data/loaders.ts`, and `apps/mobile`'s `src/data/surahs.ts` and its
  generated `textIndex.generated.ts`. This used to live under
  `apps/web/data/`; it moved here once a second app needed the same text.
- **`apps/web`** (`@quran/web`) — the Next.js app itself: `app/`,
  `components/`, `lib/`, `scripts/`, `public/`, `data/`, and `e2e/`. Six
  files stay here rather than in core because each is platform-coupled and
  none has a second implementation yet to design an adapter against:
  `lib/data/loaders.ts` (`node:fs`), `lib/data/surahIndex.ts` (build-time
  JSON import), `lib/player/lastPosition.ts` (`localStorage` read/write),
  `lib/audio/playlist.ts` (`HTMLAudioElement`), `lib/reader/useAutoScroll.ts`
  (`document`/`window`), and `lib/reader/wordRegistry.ts` (`classList`).
- **`apps/mobile`** (`@quran/mobile`) — the Expo/React Native Android app:
  `App.tsx`, `src/` (screens, reader, player, audio), and `modules/`
  (`modules/tajweed-text`, a local native Expo module — see
  [`apps/mobile/README.md`](apps/mobile/README.md) for why it exists and why
  it must not be replaced with plain `<Text>` nesting). See that README for
  prerequisites, how to build and run it, and why `android/` and `ios/` are
  not committed.

Run everything from the repository root:

```bash
npm run dev          # starts the Next.js dev server (apps/web)
npm test             # runs every workspace's unit tests (core, mobile, web)
npm run build        # production build (apps/web)
npm run test:e2e     # Playwright, against a real dev server (apps/web)
npm run typecheck    # tsc --noEmit across core, mobile, and web
npm run android      # first-build/rebuild the Android app (apps/mobile)
npm run mobile:start # start Metro for JS-only reloads (apps/mobile)
npm run fetch:data   # downloads Quran text/timings/audio (apps/web)
npm run fetch:fonts  # downloads the two OFL fonts (apps/web and apps/mobile)
```

## Running it

```bash
npm install
npm run fetch:fonts          # downloads the two OFL fonts
npm run dev
```

Text and timings for all 114 surahs are already committed, so no `fetch:data`
run is required to browse the app. Audio, however, is gitignored
(`apps/web/public/audio/`) and is not fetched by the steps above, so a fresh
clone has no audio at all until you do one of:

- `npm run fetch:data -- --surahs=1-114` to download audio locally into
  `apps/web/public/audio/` (see "Adding more surahs" below; the full set is
  ~3.35 GB), or
- set `NEXT_PUBLIC_AUDIO_BASE_URL` to point at the audio's GitHub Releases
  host (see "How it works" below) so audio is fetched from there instead.

## Adding more surahs

Text and timings for all 114 surahs are already committed — this section only
matters if you want **audio** on disk locally instead of via
`NEXT_PUBLIC_AUDIO_BASE_URL`:

```bash
npm run fetch:data -- --surahs=1,2,3    # a comma-separated list
npm run fetch:data -- --surahs=1-114    # a range
npm run fetch:data                      # no --surahs: defaults to surah 1
```

`apps/web/scripts/fetch-quran-data.ts` is incremental and resumable: audio
files already on disk are skipped rather than re-downloaded, and
`packages/quran-data/surahs.json` / `apps/web/data/validation-report.json`
are rewritten after every surah, not just at the end of the run — so an
interrupted multi-surah fetch can simply be re-run and it picks up where it
left off.

Be aware that the full audio set for all 114 surahs is roughly **3.35 GB** —
that is why audio is not committed to this repository. `.gitignore` excludes
`apps/web/public/audio/`, and `git ls-files apps/web/public/audio` returns
nothing: this is not a decision still to be made, it has already been made.
Audio lives in per-surah GitHub Releases instead (115 shards uploaded via
`apps/web/scripts/upload-audio.sh`), resolved at runtime by
`packages/core/src/data/audioUrl.ts` through `NEXT_PUBLIC_AUDIO_BASE_URL`.
Fetching it locally with the commands above is an alternative to that,
useful for offline development.

## Tests

```bash
npm test          # 207 unit tests (vitest): 90 in packages/core, 34 in apps/mobile, 83 in apps/web
npm run test:e2e  # 4 Playwright tests, driving a real browser (apps/web only)
```

The most important unit tests cover `packages/core/src/normalize/`, which
converts Quran.com's range-segments (one segment can span several words, or a
word can have no segment at all) into exactly one timing per word. Its
fixtures are real API responses, including two awkward real cases: `1:4`,
where a single segment covers all three words of the ayah, and `2:23`, where
one word in the ayah has no segment at all and must be absorbed into a
neighbouring segment's span.

The unit suite exercises `PlayerProvider` directly, calling its actions and
asserting on its state — it never renders a surah page. That is exactly why it
cannot catch a page-level wiring bug: an earlier version of this code once
dropped the `WordRegistry` attach call from the surah page, so no word ever
highlighted during real playback, and every unit test still passed. The four
`apps/web/e2e/player.spec.ts` tests exist for that class of bug: they drive an
actual browser against a real dev server and assert on `.word--active` in the
DOM, covering playback surviving client-side navigation, a second surah page
staying unhighlighted while another surah plays, the loading-state ordering
(see below), and the saved position being offered after a reload.

## How it works

- Playback is owned by `PlayerProvider`
  (`apps/web/components/player/PlayerProvider.tsx`), mounted once in the root
  layout (`apps/web/app/layout.tsx`). The App Router keeps the layout mounted
  across client-side navigation, so recitation continues uninterrupted while
  the user browses to other pages — there is no per-page `<audio>` element.
- A player bar (`apps/web/components/player/PlayerBar.tsx`) is rendered on
  every page from that same root layout. It doubles as the resume affordance:
  if nothing is currently playing but a position was saved from a previous
  visit, the bar offers that position instead of showing nothing — which is
  why there is no separate "continue where you left off" card anywhere else
  in the UI. The last position is persisted to `localStorage` by
  `apps/web/lib/player/lastPosition.ts`, which validates what it reads back
  with `isValidPosition` from `@quran/core`.
- Word timings live under `apps/web/public/timings/`, not
  `apps/web/data/timings/`, so that the client can `fetch()` them at runtime
  (see `packages/core/src/player/timingsLoader.ts`). This is required because
  the provider must be able to advance through — and highlight — a surah
  whose page is not currently mounted, e.g. while the user is looking at the
  home page and a different surah keeps playing underneath.
- Each surah page owns its own `WordRegistry`
  (`apps/web/lib/reader/wordRegistry.ts`) and hands it to the provider with
  `attachRegistry(surahId, registry)`
  (`apps/web/app/surah/[id]/SurahClient.tsx`). The provider paints highlights
  into that registry only while that page's surah is the one actually
  playing, so a second, unrelated surah page mounted at the same time is
  never touched.
- The player bar holds a loading state (spinner, `aria-label="Loading"`) from
  the moment `playSurah` is called until the audio element actually starts
  producing sound, rather than flipping to "Pause" the instant playback is
  requested. This fixed a real, measured defect from Phase 1: 717–1431 ms
  where the control claimed to be playing while the file was still being
  fetched and nothing was audible or highlighted, which read as broken
  highlighting rather than a loading state.
- `packages/core/src/sync/engine.ts` is pure TypeScript with no React
  imports. It reads audio position on `requestAnimationFrame` (rather than
  the coarser `timeupdate` event) and resolves the active word by binary
  search over its `[startMs, endMs)` timings.
- Highlighting bypasses React's render cycle entirely:
  `apps/web/lib/reader/wordRegistry.ts` toggles a class directly on two DOM
  nodes (the previously active word and the newly active one) per change, at
  frame rate. The word tree itself does re-render on the 250ms progress-bar
  tick because that state (`currentMs`) lives in `PlayerProvider`, but
  `QuranReader` is wrapped in `React.memo` with referentially-stable props,
  so React bails out before reconciling `AyahBlock`/`QuranWord` — the tree is
  not walked 4×/sec.
- All Quran text, timings, and audio are fetched once at build time by
  `apps/web/scripts/fetch-quran-data.ts`. Text and timings are committed;
  audio is not (`apps/web/public/audio/` is gitignored). Audio is served
  either from a local `apps/web/public/audio/` fetched with `fetch:data`, or
  — resolved by `packages/core/src/data/audioUrl.ts` — from a per-surah
  GitHub Release when `NEXT_PUBLIC_AUDIO_BASE_URL` is configured; see "No
  offline support" below for why that indirection exists.

### No offline support

There is no service worker and no offline download feature. This was
considered and dropped: a service worker can only read a cross-origin
response if that origin sends CORS headers. When `NEXT_PUBLIC_AUDIO_BASE_URL`
is configured, `packages/core/src/data/audioUrl.ts` resolves audio to a
per-surah GitHub Release (sharded one release per surah because a release
caps at 1000 assets and the recitation has 6,236 files) — and neither the
`github.com/.../releases/download/...` URL nor the
`release-assets.githubusercontent.com` URL it redirects to sends any CORS
headers. A Vercel rewrite was tried as a workaround; it passes the redirect
straight through rather than following it, so the browser still receives an
opaque response (`status: 0`, unreadable body), indistinguishable from a
network failure. Making offline support work would mean either moving the
audio to a CORS-enabled CDN or proxying every audio byte through a Vercel
Function — both out of scope here, so offline support was dropped instead.

See [`docs/superpowers/specs/`](docs/superpowers/specs/) for the full design
and [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md) for the source and licence
of every external dataset.

## License

The source code in this repository is licensed under the [MIT License](LICENSE).

That covers the code only. The Quran text, word-timing data, audio, and fonts
are each third-party content with their own terms, not MIT — see
[`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md) for the licence and status of
each.
