# `@quran/mobile` — the Android app

An Expo / React Native app (Expo SDK 57, React Native 0.86, New Architecture
enabled) with the same recitation experience as `apps/web`: a surah list, a
reader in both scripts (Tajweed and IndoPak) with tajweed colour-coding,
word-by-word highlighting synced to audio, and background playback with
lock-screen controls. It shares its domain logic with the web app through
`packages/core` and its Quran text through `packages/quran-data` — see the
root [`README.md`](../../README.md) for how the workspace fits together.

The Android build is the one that has actually been run end-to-end on a
device/AVD. The reader has a separate rendering path for iOS (see
`modules/tajweed-text` below) and the project builds an iOS Simulator
target, but iOS has not had the same manual verification as Android.

## Prerequisites

- **Android SDK** and **Java 17** — the toolchain the Android Gradle Plugin
  bundled with Expo SDK 57 / React Native 0.86 requires. `java -version`
  should report `17.x`.
- An **AVD** (Android Virtual Device) created in Android Studio, or a
  physical device with USB debugging enabled and reachable by `adb devices`.
- **Xcode**, only if you also want the iOS Simulator. No Apple Developer
  account is needed to build and run on the Simulator — that is only
  required for a physical iOS device or for distributing a build.

## Running it

From the repository root:

```bash
npm install
npm run android          # first build: compiles native code, boots the AVD, installs the app
```

`npm run android` is `expo run:android` under the hood. The **first** run
(or any run after `android/` has been deleted, or after touching
`app.json`, `modules/tajweed-text`, or any dependency with native code)
compiles the native Android project and can take several minutes. Every run
after that — while only `App.tsx`, `src/`, or another JS/TS file changes —
is a JS-only reload: start Metro on its own and it hot-reloads into the
already-installed app in seconds, no recompiling:

```bash
npm run mobile:start      # expo start — Metro only, against the existing native build
```

For iOS, the equivalent first build is `npm run ios --workspace @quran/mobile`
(there is no root `npm run ios` script yet, only `apps/mobile/package.json`'s
own `ios` script, the same way root `npm run android` delegates to
`apps/mobile`'s `android` script). It boots the Simulator and builds the
native iOS project the same way `expo run:android` does for Android.

### Why not Expo Go

Expo Go cannot run this app. `app.json` configures the `expo-audio` plugin
with `enableBackgroundPlayback: true`, which — per the plugin's installed
source (`node_modules/expo-audio/plugin/src/withAudio.ts`) — adds the
`FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MEDIA_PLAYBACK` permissions and
registers an Android manifest `<service>` (a `MediaSessionService`) that
keeps audio alive once the app is backgrounded. Expo Go ships one fixed,
pre-built native binary and cannot add a manifest entry or a permission that
isn't already baked into it, so background playback — and, per Expo's own
constraints, the app in general once it declares native config Expo Go
doesn't have — needs a real native build (a dev client or the full
`expo run:android`/`expo run:ios` build above), not Expo Go.

### Why `android/` and `ios/` are not committed

Both directories exist on disk once you've built, but neither is in git
(`apps/mobile/.gitignore` excludes `/android` and `/ios`). This project uses
Expo's **Continuous Native Generation (CNG)**: the native projects are fully
derived from `app.json` and the config plugins it lists (`expo-audio`,
`expo-font`), regenerated from scratch by `expo prebuild` (which `expo run:*`
invokes automatically whenever the directory is missing). Committing
generated native projects would mean two sources of truth — hand-edited
native files and the config that's supposed to produce them — that drift out
of sync the first time someone edits one but not the other. Changing native
behaviour here means changing `app.json` or a plugin, then deleting
`android/`/`ios/` and rebuilding, not hand-editing generated files.

The one exception is `modules/tajweed-text`: it is **source**, not
generated, and is committed — CNG only generates the app's own `android/`
and `ios/`, never a local Expo module's own native code.

## Why `modules/tajweed-text` exists

This is a local native Android view, and it is tempting to delete it and
render tajweed text with plain nested `<Text>`, the way the IndoPak script
already does. Do not: on Android, RN's text layer applies a
`MetricAffectingSpan` to every text fragment (`ReactAbsoluteSizeSpan` always,
`CustomStyleSpan` whenever `fontFamily` is set — see
`TextLayoutManager.kt` in the installed `react-native` sources), and a
`MetricAffectingSpan` boundary is a **shaping-run boundary** on Android,
regardless of nesting depth — flattening the nesting was tried and produced
pixel-identical output. Nesting one `<Text>` per tajweed colour therefore
puts a shaping-run boundary at every colour change, and a cursive Arabic
letter that lands on one renders in its isolated form instead of joining the
next letter: words visibly fragment. iOS has no such problem, because it
flattens all nested `Text` into one `NSMutableAttributedString` and CoreText
shapes it in a single pass, with colour as a non-metric attribute.

`TajweedTextView` (in `modules/tajweed-text/android/`) is the Android
equivalent of that `NSAttributedString`: one `AppCompatTextView`, one
typeface, one text size — set once, never per range — with tajweed colour
and the playback highlight applied as `ForegroundColorSpan`/
`BackgroundColorSpan` over character ranges of a single `SpannableString`.
Both are non-metric `CharacterStyle`s, so the whole string shapes as one run.
**Any per-range size, weight, or font span reintroduces the exact bug this
module exists to remove** — see the load-bearing constraint documented on
`TajweedTextView.kt`'s class doc. A canvas-based (Skia) rewrite was also
evaluated and rejected: it shapes correctly, but canvas text is invisible to
TalkBack, unselectable, ignores the system font-size setting, adds ~22 MB of
native libs, and would mean rebuilding scrolling and hit-testing from
scratch. `TajweedLine.tsx` is the one call site that switches between this
native view (Android, tajweed script only) and plain `<Text>` (iOS, and
IndoPak on both platforms, which has no colour runs to fragment on).

## Offline downloads

Unlike `apps/web` (see the root [`README.md`](../../README.md#no-offline-support-web-app)),
this app can download a surah's recitation and play it with no network at
all. The pieces:

- **The size manifest** (`packages/quran-data/audio-sizes.json`) is built
  once, ahead of time, by `npm run build:audio-sizes`
  (`packages/quran-data/scripts/build-audio-sizes.mjs`), which walks the
  locally fetched audio under `apps/web/public/audio/<reciter>/` and records
  each surah's byte count and file count, plus a `totalBytes`/`totalFiles`
  grand total. The app bundles this JSON and reads it to show a size (e.g.
  "Download all (2.7 GB)") *before* a download starts, rather than issuing
  hundreds of HEAD requests to learn what this file already knows. **Re-run
  it** whenever the committed audio under `apps/web/public/audio/` changes —
  a different reciter, a re-encode, or added/removed files — so the sizes
  shown in the app stay honest. It requires the audio to be present locally
  first (`npm run fetch:data -- --surahs=1-114`).
- **On-disk layout**: each downloaded surah lives in its own folder,
  `<Paths.document>/offline/<surahId>/`, holding that surah's ayah audio
  files (`NNNNNN.mp3`, matching the URL's own filename) and a `timings.json`
  — so a downloaded surah is fully self-contained and plays with the network
  off, timings included (`src/offline/offlineStore.ts`). There is no
  separate index of "what's downloaded" kept anywhere: the filesystem is the
  only authority. A surah counts as downloaded only when its folder has
  exactly the expected number of audio files *and* a `timings.json` — an
  index could disagree with reality after a crash or an OS eviction, and the
  failure mode of trusting one would be the app promising a surah it cannot
  actually play offline.
- **Downloads are resumable and crash-safe** (`src/offline/downloadManager.ts`):
  each file downloads to a `<name>.part` sibling first and is renamed to its
  final name only once every byte has arrived, so a partial file can never
  be mistaken for a finished one. `timings.json` is written last, after every
  audio file — the folder only becomes "complete" once nothing more can fail.
  Cancelling a download keeps whatever files already finished; starting that
  surah again skips them and resumes from the first missing file. This is a
  **per-file** resume (each ayah's file is all-or-nothing), not a byte-range
  resume within a single file — a `.part` that didn't finish is deleted and
  re-fetched from the start, not resumed mid-file.
- **Downloads only run while the app is open.** There is no OS-level
  background transfer service, so both a single surah's download and
  "Download all" stop if the app is closed or the process is killed — this
  applies the same way whether you started one surah from its own control or
  every surah from Settings. Leave the app open (foreground or backgrounded
  but still alive) until the download you started finishes.
- **Playback** prefers the offline file over the network
  (`offlinePathFor ?? localPathFor` in `PlayerProvider.tsx`) and reads
  offline timings through `offlineTimingsStore`, so a downloaded surah's
  audio and highlighting both come from disk with no fetch at all.

### Settings

Reached from the home screen's gear icon (`SettingsScreen.tsx`):

- **Offline**: lists every downloaded surah with its on-disk size (summed
  from the actual audio files, not the manifest) and a running total, each
  with a delete action; "Download all" shows the manifest's `totalBytes` and
  asks for confirmation before starting, since it can mean gigabytes over a
  live connection.
- **Appearance**: System / Light / Dark. The preference persists to
  `<Paths.document>/theme.json` (`src/theme/theme.tsx`) and is read back on
  launch; "System" is a *live* choice — it re-resolves against
  `useColorScheme()` on every change, so toggling the device's dark mode
  while the app is open switches it immediately, no restart needed. Every
  screen's colours, including the native tajweed highlight
  (`TajweedTextView`'s `highlightColor` prop), come from this one palette.
- **About**: the app version, read from the native app info via
  `expo-application` (so it reflects `app.json`'s `version` as it was built
  into that binary, not the source tree you happen to have checked out), and
  a fixed credit line, "Umair Nawaz 2026".

## Tests

```bash
npm test          # from the repo root, or `npm test` inside apps/mobile — 150 vitest tests
```

Covers the timing sequencer (`AyahSequencer`), the `expo-audio` player
adapter, the tajweed colour palette, the single-string line builder that
feeds `TajweedTextView`, the offline store and download manager, and the
theme provider. Root `npm test` also runs `packages/core`'s 91 tests
(including the platform-free guard that this app is proof of) and
`apps/web`'s 91.

## Data

Quran text comes from `@quran/data` (`packages/quran-data/`), the same
package `apps/web` reads at build time. `scripts/generate-text-index.mjs`
writes `src/data/textIndex.generated.ts`, a static map of surah id to a
thunk that `require()`s that surah's JSON — so all 114 files are bundled
into the app (no network fetch for text), but each surah's JSON is only
parsed the first time it's opened, not at startup. Re-run
`npm run generate:text --workspace @quran/mobile` (or `npm run generate:text`
from inside `apps/mobile`) after adding or changing files under
`packages/quran-data/text/`.

The two Quran typefaces (Amiri Quran, Noto Naskh Arabic) are bundled as app
assets under `assets/fonts/` and loaded with `expo-font`
(`src/reader/fonts.ts`) rather than fetched at runtime — see
[`docs/DATA_SOURCES.md`](../../docs/DATA_SOURCES.md) for where those files
come from and their licence.
