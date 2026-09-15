# Android App — Design Spec

**Date:** 2026-09-15
**Status:** Approved for planning
**Builds on:** Sub-project A (monorepo and core extraction), merged to `main` as `0b797b5`

---

## 1. Why this exists

The web app is done and secondary. This is the first native app: an Android
client that plays the recitation with word-by-word highlighting and works
without a network once a surah has been downloaded.

Offline is the reason a native app exists at all. On the web it was proven
impossible without moving the audio or proxying every byte: a service worker
cannot read a cross-origin response without CORS headers, and neither GitHub
Releases hop sends any. **CORS is a browser security model and does not apply
to React Native** — its `fetch` and `expo-file-system` use NSURLSession and
OkHttp, which do not enforce it. So the same audio, on the same GitHub
Releases, downloads fine here with no CDN change and no proxy.

This spec merges what the sub-project A roadmap listed separately as B
(mobile MVP) and C (offline audio). The user asked for them together.

### iOS is deferred, not designed out

There is no Apple developer account, so iOS cannot be tested and is out of
scope. Nothing here may be Android-only by *construction*, though: the app is
an Expo project, and the platform-specific surface is limited to the audio
service and the filesystem paths. Adding iOS later should be a build target
and a test pass, not a rewrite.

---

## 2. Scope

**In:** surah list; reader in both scripts with full tajweed colouring; audio
playback with background and lock-screen controls; word-by-word highlighting;
per-surah offline download; a settings page with offline management, a
light/dark/system theme, the app version, and the author credit.

**Out:** ads, in-app purchases, translations, Urdu, multiple reciters, search,
playback speed, iOS. Multiple reciters are out of scope but the data model
below is chosen so adding one is a download, not a migration.

---

## 3. Two stages

One plan, built in two stages, because one unknown sits underneath everything
else (§7).

**Stage 1 — prove the loop.** Surah list, reader, streaming playback, word
highlighting, both scripts. Audio streams from GitHub Releases. No offline, no
settings. Done when a word highlights in time with the recitation on the
emulator.

**Stage 2 — build on it.** Offline downloads, settings, theme, version and
credit.

If Stage 1's position-sync approach fails, it fails before a download manager
has been built on top of it. That ordering is the only reason to have stages
at all; the scope is identical either way.

---

## 4. Structure

```
quran-recite/
├── packages/core/        platform-free domain logic (exists)
├── apps/web/             the Next.js app (exists)
└── apps/mobile/          the Expo app (new)
```

**Expo with Continuous Native Generation**, built locally with
`expo run:android` onto the existing `Pixel_10_Pro` AVD. The machine already
has the Android SDK, Java 17, Android Studio and `eas-cli`, so no cloud build
is needed to iterate. EAS Build remains how a distributable artifact gets
produced later; it is not needed for development and is not part of this spec.

**Expo Go cannot be used.** Background audio needs a native module, which
means a development build. This is a consequence of §6's audio decision, not a
preference.

**Metro must see the workspace.** `apps/mobile/metro.config.js` extends
`expo/metro-config` with the repository root in `watchFolders` and the root
`node_modules` in `nodeModulesPaths`, so `@quran/core` resolves from TypeScript
source. This is the Metro equivalent of the web app's
`transpilePackages: ['@quran/core']`, and it is why core ships source rather
than a build output.

**No shared UI.** Each platform keeps idiomatic components. Arabic text
rendering differs enough between the DOM and React Native that a shared layer
would serve neither — the web uses `dangerouslySetInnerHTML` for tajweed and
CSS class toggling for highlighting, and neither exists here. What is shared is
`packages/core`: the normalizer, the sync engine, the timeline, and the new
pieces in §11.

---

## 5. Data

Three kinds of data, split by what they belong to rather than by size:

| | Where it lives | Why |
|---|---|---|
| Surah text, **both scripts**, 114 surahs (9.2 MB) | Bundled in the app | The text is identical for every reciter, so it is not recitation data. Bundling it means the list and the reader work with no network at all, and it sidesteps §11's relative-URL problem for the largest of the three. |
| Word timings (6.6 MB for this reciter) | Downloaded, cached on device | Timings are a property of a *recitation*, not of the Quran — they are keyed by reciter today (`abdulbasit-murattal`) and a second reciter brings its own. Bundling them would make adding a reciter an app release. |
| Audio (2.5 GB) | Streamed, or local once downloaded | Far too large to bundle; §9 covers the offline case. |

This split is what makes multiple reciters additive later: adding one is a
download of timings plus audio, with no change to the bundled text and no data
migration.

**Timings are fetched per surah, on demand, and cached permanently** — 504 KB
the first time a surah is opened. There is deliberately **no blocking
first-run download**: fetching all 114 files up front would put a progress
screen in front of a user who wants one surah, and it scales badly at five
reciters. Downloading a surah for offline use stores its timings alongside its
audio (§9), so an offline surah needs no network for either.

---

## 6. Audio

**`react-native-track-player`.** Background playback, lock-screen and
notification controls, and a native queue. For a recitation app this is not a
nice-to-have: people listen with the screen locked. It is a native module, so
it requires the development build named in §4.

Its native queue may make the web app's double-buffered `AyahPlaylist`
unnecessary rather than something to reimplement — one ayah per track, queued,
with the library handling gapless advance. Whether that holds is for the plan
to determine against the real library; the spec does not assume it either way.

Exact package versions are pinned during implementation, after reading the
installed documentation. This spec names libraries, not versions.

---

## 7. The real risk: position at frame rate

`SyncEngine.attach(getTimeMs, words)` calls `getTimeMs()` on every animation
frame. That is the whole reason word highlighting is accurate — the web app
deliberately rejected the `timeupdate` event as too coarse at roughly 4 Hz.

`react-native-track-player` reports position through an **asynchronous** call
on a periodic interval, by default around 250 ms. Passed straight into
`SyncEngine`, that reproduces exactly the defect the web app avoided.

**The approach:** sample the track player's reported position periodically, and
between samples extrapolate using wall-clock time while playback is running.
`getTimeMs()` then returns `lastSample + (now - lastSampleAt)` while playing,
and the last sample verbatim while paused. Each new sample corrects accumulated
drift.

This is the one component with genuine unknowns — how far it drifts, how it
behaves across an ayah boundary, and whether a seek invalidates the
extrapolation before the next sample lands. It must be built and proven on the
emulator first, and it must be unit-testable independently of the audio
library: the extrapolator takes samples in and produces a time, so it can be
tested with injected samples and a fake clock, with no device involved.

If extrapolation proves unworkable, the fallback is to raise the library's
update interval and accept coarser highlighting — a visible quality loss, and a
decision to bring back to the user rather than make silently.

---

## 8. Highlighting

No DOM, so the web's `WordRegistry` (which toggles CSS classes on nodes) has no
equivalent. Two constraints shape the design:

- **Al-Baqarah is 6,116 words.** Mounting every word at once is not viable, so
  the reader is a virtualised list of ayahs.
- **A word change must not re-render the list.** At frame rate, re-rendering a
  tree of thousands of nodes on each change would be as bad as no
  virtualisation.

**The design:** a small active-word store holding the currently active word id,
fed by `SyncEngine.onChange`. Each rendered word subscribes to it through
`useSyncExternalStore` with a selector that returns whether *this* word is
active. A change therefore re-renders exactly two word components — the one
losing the highlight and the one gaining it — which is the same property class
toggling gives the web. Virtualisation bounds the number of live subscriptions
to what is on screen.

---

## 9. Offline

### What the numbers force

Measured against the actual audio, not estimated:

| | |
|---|---|
| All 114 surahs | **2.5 GB**, 6,236 files |
| Al-Baqarah | **222 MB**, 286 files |
| Al-Kahf | 53 MB, 110 files |
| Al-Fatihah | 0.9 MB, 7 files |
| Al-Ikhlas | 0.3 MB, 4 files |

Per-surah offline is therefore a download manager with progress, cancellation
and storage accounting — not a checkbox. "Download everything" is a 2.5 GB
commitment and the UI must say so before it starts.

### A build-time size manifest

A script walks the local audio and emits a committed JSON manifest mapping each
surah to its total bytes and file count.

Without it the UI cannot show "222 MB" before the user commits, and the only
alternative is issuing 286 HEAD requests to learn what a build-time script
already knows. The manifest is generated from the same local audio that
`fetch:data` produces, so it cannot drift from the files being served without
someone noticing.

### Storage

`expo-file-system`'s app-private document directory, one folder per surah,
holding that surah's ayah mp3 files **and** its timings JSON. A downloaded
surah is therefore self-contained: it plays with the network off, including its
word timings. App-private storage also means uninstalling the app reclaims
everything, and "manage storage" means managing this app's own footprint.

### Download behaviour

Resumable and cancellable, one surah at a time, with progress reported per
surah. Partial downloads must not be presentable as complete.

**The filesystem is the source of truth** for what is downloaded. An index kept
only in a key-value store can disagree with reality after a crash, a failed
write, or an OS eviction, and the failure mode is the app claiming a surah is
available and then failing to play it. State is derived from what is actually on
disk; any cached index is a performance detail that must be verifiable against
the filesystem.

### In the reader and the list

A per-surah download control with three visible states: not downloaded,
downloading with progress, downloaded. Tapping a downloaded surah's control
offers deletion.

---

## 10. Settings

Reached from the home screen. Three sections:

**Offline** — the list of downloaded surahs with each one's size and the total
used; delete a surah; delete everything; and download all, behind an explicit
2.5 GB confirmation.

**Appearance** — theme with three states: system, light, dark. System is the
default, and "system" is a real state rather than a snapshot of the current
system value, so the app follows the device when the device changes.

**About** — the app version, read from the native application version rather
than hardcoded so it cannot drift from what was built, and the credit
`Umair Nawaz 2026`.

---

## 11. Changes to `packages/core`

Sub-project A deliberately deferred every adapter to here, on the grounds that
designing an abstraction with one implementor is guesswork. There are now two
implementors, so these seams can be designed against reality.

### The two known gaps, both currently blocking

Recorded in A's final review and commented in the source:

- **`resolveAudioUrl`** reads `process.env.NEXT_PUBLIC_AUDIO_BASE_URL` at
  module scope. On React Native the variable is not substituted and `process`
  exists, so `BASE` is `undefined` and the function silently falls back to a
  root-relative path that means nothing on a native client. It gets an explicit
  configuration seam: the base is supplied by the host, with the current
  `process.env` read kept as the web's default so web behaviour does not
  change. Reading it at call time rather than module scope also removes the
  `vi.resetModules()` tax the existing tests pay.
- **`loadTimings`** fetches the root-relative `/timings/<reciter>/<id>.json`,
  which React Native's `fetch` rejects outright — there is no document origin to
  resolve against. It takes a base URL. Its module-level `Map` cache is
  memory-only and reciter-blind (`RECITER` is a hardcoded constant); mobile
  additionally needs a persistent, per-reciter cache, so the storage backing
  becomes injectable rather than assumed.

### Two additions, both platform-free

- **A tajweed parser.** Tajweed text is markup —
  `<rule class=ham_wasl>ٱ</rule>للَّهِ` — which the web renders with
  `dangerouslySetInnerHTML`. React Native has no innerHTML, so it must be
  parsed into a token list of text runs with optional rule names, which the app
  maps to coloured `Text` nodes. It is pure string work, it is testable without
  either platform, and it lets the web drop `dangerouslySetInnerHTML` too. This
  is the clearest case in the project of a thing worth building once.
- **An audio source resolver.** The player asks where a given ayah's audio is
  and receives either a local file path or a remote URL, depending on whether
  that surah is downloaded. Keeping this in core means offline is invisible to
  the playback code: nothing in the player branches on it. The resolver is pure
  — it is told what is available and where things live, and returns a location.

### The constraint that does not move

`packages/core` keeps **zero runtime dependencies**, imports nothing from
React, Next, `node:*` or the DOM, and references no DOM or browser-storage
global. `packages/core/__tests__/platform-free.test.ts` enforces this, and
`packages/core/tsconfig.json` omits `dom` from `lib` so a stray reference fails
to compile. Every addition above is pure logic; anything needing a filesystem,
a network or a device stays in `apps/mobile`.

---

## 12. Testing

**Unit, in `packages/core`:** the tajweed parser against real markup from the
committed text data, including a word with no rule and a word with several; the
audio source resolver for both the downloaded and not-downloaded cases; the
URL seam for web-default and explicit-base configuration. The existing suite
must keep passing — the seams are additive, and web behaviour is unchanged.

**Unit, in `apps/mobile`:** the position extrapolator, driven by injected
samples and a fake clock, covering playing, paused, a seek arriving before the
next sample, and drift correction when a sample disagrees with the
extrapolation. This is the risk from §7 and it is the one piece that must be
tested without a device.

**Manual, on the emulator:** playback, highlighting accuracy, background and
lock-screen controls, download with progress, cancellation mid-download,
deletion, playing a downloaded surah with the network disabled, and the theme
across all three states.

An automated React Native end-to-end suite is **out of scope**. Saying so
explicitly matters, because the web app's four Playwright tests exist precisely
because unit tests once passed over a page-level wiring bug that left no word
highlighted. The mobile equivalent of that risk is carried by manual emulator
testing in this project, and that is a known gap rather than an oversight.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Position sampling too coarse for word sync | §7 — extrapolate against wall-clock, prove it on the emulator in Stage 1, before anything is built on it |
| `track-player`'s queue does not advance gaplessly between ayahs | Determined against the real library in Stage 1; the web's double-buffering is the known-working fallback design |
| 6,116 words in one surah | Virtualised list plus per-word subscription (§8), so a highlight change touches two components |
| A 222 MB download interrupted mid-way | Resumable downloads, and state derived from the filesystem so a partial download can never present as complete |
| "Download all" surprising the user with 2.5 GB | Size shown from the build-time manifest, behind an explicit confirmation |
| Core silently acquiring a platform dependency | Already asserted by test, and every addition here is pure logic |
| iOS diverging while untestable | Platform-specific code confined to the audio service and filesystem paths |

---

## 14. Definition of done

An Android app, installed on the emulator from a local development build, that
lists all 114 surahs, renders any of them in either script with tajweed
colouring, plays the recitation with correct word-by-word highlighting, keeps
playing with the screen locked and offers lock-screen controls, downloads a
surah with visible progress and plays it with the network disabled, and has a
settings page that manages downloaded surahs and their storage, switches
between system, light and dark themes, and shows the app version above
`Umair Nawaz 2026`.

`packages/core` still has no runtime dependencies and no platform imports, and
the web app's behaviour is unchanged.
