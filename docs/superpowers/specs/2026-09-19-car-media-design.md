# Car media (Android Auto + Android Automotive OS) — design

**Status:** approved in brainstorming 2026-09-19 (spike green). Implements from the Android
app spec (`2026-09-15-android-app-design.md`) and Stage 2 (`2026-09-18-android-app-stage-2.md`).

## 1. Goal

Recitation playback browsable and controllable from a car screen, on both car platforms
Google ships, with nothing the user has to do on the phone first:

- **Android Auto** (phone projection): plug in / connect the phone, tap **Quran** on the car
  launcher, pick a surah, it plays — even from a rebooted phone with the app swiped away.
- **Android Automotive OS** (Android built into the car, no phone): the same experience,
  installed on the car from its Play Store.

Both platforms render a **templated** media UI (Google's rule for media apps while driving):
a browsable list and a Now Playing screen. Our reader — word-by-word highlighting — cannot
appear on the car display in v1. That is a platform constraint, not a choice; see §10.

## 2. What the driver sees

**List (root):** the 114 surahs in order. Each row: transliterated name as title
(`Al-Baqarah`), Arabic name + `286 ayahs` as subtitle, the Quran logo as icon.
No other sections in v1 (no Continue / Downloaded / Juz).

**Now Playing:** title `Al-Baqarah · البقرة`, subtitle `Ayah 38`, artwork = the Quran logo,
play/pause, previous, next, seek bar (ayah-local position is not meaningful across ayahs, so
the session reports the *surah's* elapsed position — see §5.4).

**Skip semantics:** on a **car controller** next/previous mean **next/previous surah**. On the
phone bar, lock screen and headphones they keep meaning **ayah**, exactly as today. The same
media session serves all of them; §5.3 says how it tells them apart.

**Voice:** "play Al-Kahf in Quran" / "play surah 18 in Quran" → the library search callback
matches by number, transliterated name (diacritics and apostrophes ignored), English name,
or Arabic name, and plays the best match from ayah 1.

**Auto-continue** into the next surah at the end, and **resume** from the last position when
the car sends plain "play" with nothing selected — both are the engine's existing behaviour.

## 3. Architecture

```
┌────────────── car (Auto head unit / AAOS media UI) ──────────────┐
│  browse tree ⇄ media3 MediaLibrarySession ⇄ transport commands   │
└──────────────────────────────┬───────────────────────────────────┘
                               │ (expo-audio AudioControlsService, patched: MediaLibraryService)
               ┌───────────────┴────────────────┐
               │ CarLibraryProvider (Kotlin,    │  browse tree from bundled JSON — no JS needed
               │ modules/car-media)             │  play/skip/search → CarBridge events
               │ boots JS headless if not up    │
               └───────────────┬────────────────┘
                               │ Expo module events / functions
┌──────────────────────────────┴───────────────────────────────────┐
│ PlaybackEngine (JS, module scope, no React)                      │
│  AyahSequencer · surah switching · timings · offline paths ·     │
│  warm cache · bookmark/resume · lock-screen registration         │
│  ← PlayerProvider (thin React binding, unchanged usePlayer())    │
│  ← car handlers (registerCarEngine)                              │
└──────────────────────────────────────────────────────────────────┘
```

One media session, one player, one engine; three drivers (screens, lock screen/headphones,
car). The spike (`modules/car-media` CarProbeService, 2026-09-19) proved the load-bearing
assumption: with the app process dead and no Activity, a foreground service can start the JS
runtime (0.4 s), create an expo-audio player, load an ayah (3.3 s including network) and play,
with the media session reporting real position.

## 4. Playback engine (JS)

`apps/mobile/src/player/PlaybackEngine.ts` — a module-scope singleton, importable from a
headless task with no React tree. It takes over everything in `PlayerProvider.tsx` that is
not rendering:

- the single `AyahSequencer` for the app's life (`switchTo` on surah change), `localAudioFor`
  (offline folder → warm cache → stream), `cacheAyah` prefetch skipping offline surahs,
  `configureTimings`/`configureAudioBase`, bookmark write on switch-over and ayah change,
  `readLastPosition` for resume, `ended → play(surahId + 1)`, lock-screen registration
  (`nowPlaying.ts`) and metadata refresh per ayah, `pendingSurahId`/`isLoading`/`error`
  attribution, the 300 ms loading debounce, the `handlerEpochRef` ownership rule.

API (all synchronous to call; work happens inside):

```ts
export type EngineState = {
  surahId: number | null; ayah: number | null; wordId: string | null;
  isPlaying: boolean; isLoading: boolean; pendingSurahId: number | null;
  error: string | null; offered: { surahId: number; ayah: number } | null;  // INITIAL offer
};
export const engine: {
  getState(): EngineState;                     // reference-stable until something changes
  subscribe(cb: () => void): () => void;
  play(surahId: number, ayah?: number, wordId?: string): void;
  pause(): void; toggle(): void;
  nextAyah(): void; prevAyah(): void;          // today's next()/prev()
  nextSurah(): void; prevSurah(): void;        // new: clamp at 1 and 114
  resume(): void;                              // play the bookmark, or the INITIAL offer
};
```

`PlayerProvider` becomes `useSyncExternalStore(engine.subscribe, engine.getState)` plus the
existing action names — `usePlayer()`'s contract does not change, so **no screen changes**.
The word-tick path (`activeWordStore`) is untouched. The provider test harness re-targets
the engine: the tests move to `__tests__/PlaybackEngine.test.ts`, the React ones that remain
assert only the binding.

`src/car/carEngine.ts` — `registerCarEngine()`: subscribes to `CarMedia` command events and
calls the engine; subscribes to the engine and pushes `setNowPlaying({ title, subtitle,
surahId, ayah, durationMs, positionMs })` on every ayah change and play/pause; on
`playSurah` with a surah that is neither downloaded nor reachable, reports
`setError('No connection — download this surah on your phone')`. It is called from the
normal app entry **and** from the headless task, and is idempotent.

Headless entry: `AppRegistry.registerHeadlessTask('QuranCarEngine', …)` in `index.ts`
initialises the engine, calls `registerCarEngine()`, then `CarMedia.engineReady()` and stays
alive while the engine has a session (returns when the engine is idle for 10 minutes, so
the process can die when the car is unplugged).

## 5. Native side

### 5.1 `modules/car-media` (local Expo module, Kotlin)

Same layout as `modules/tajweed-text`. Contents:

- `CarMediaModule` — Expo module `CarMedia`: functions `engineReady()`,
  `setNowPlaying(record)`, `setError(message)`, `setLibrary(json)` (test/override only);
  events `onCommand` (`{ type: 'playSurah', surahId } | { type: 'nextSurah' } |
  { type: 'prevSurah' } | { type: 'resume' }`).
- `CarLibraryProvider` — implements the library callbacks (§5.2) against
  `assets/car-library.json` (generated: `[{ id, nameSimple, nameArabic, nameEnglish,
  ayahCount }]` for 114 surahs) and the logo drawable; media ids are `surah:<id>`; root id
  `root`; search per §2.
- `EngineBooter` — if no engine is registered when a command arrives: starts the JS runtime
  headless (`HeadlessJsTaskService` subclass `CarEngineService`, foreground with the media
  notification channel, `foregroundServiceType="mediaPlayback"`), queues commands until
  `engineReady()` (timeout 10 s → session error "Open Quran on your phone").
- The spike that proved cold-start (`CarProbeService` + a `CarProbe` headless task) was
  deleted after the measurement; `CarEngineService` is its production form.

### 5.2 expo-audio patch (`patches/expo-audio+57.0.5.patch`, compiled from source)

Minimal, delegating hooks — the point is one session, not a fork:

- `AudioControlsService : MediaSessionService` → `MediaLibraryService`; the session is built
  as `MediaLibrarySession` with a callback that **delegates** `onGetLibraryRoot`,
  `onGetChildren`, `onGetItem`, `onSearch`, `onGetSearchResult`, `onAddMediaItems`,
  `onSetMediaItems` to a registered `CarLibraryProvider` (a static registration point;
  no provider → today's behaviour, and the library callbacks return "not supported").
- `onSetMediaItems` for `surah:<id>` does **not** hand the item to ExoPlayer (the engine
  sequences ayah files itself); it emits `playSurah` and returns an empty list, then the
  engine's own `load/play` drives the player.
- `onPlayerCommandRequest(session, controller, command)`: for `SEEK_TO_NEXT` /
  `SEEK_TO_PREVIOUS` **from a car controller** (package `com.google.android.projection.gearhead`,
  or a controller whose package holds `android.permission.MEDIA_CONTENT_CONTROL` on an
  automotive build) → emit `nextSurah`/`prevSurah` and return `RESULT_INFO_SKIP`; otherwise
  today's ayah behaviour.
- Metadata: `setPlayerMetadata` already exists; `setNowPlaying` maps to it (title, subtitle
  as artist, artwork, and the surah-level duration/position of §5.4).

### 5.3 Controller routing rule

A "car controller" is identified per command from `MediaSession.ControllerInfo`, never by
a global mode flag: a phone user pressing next on the lock screen while Auto is connected
still skips an ayah. Unit-tested on the Kotlin side with fake `ControllerInfo`s.

### 5.4 Position on the seek bar

Cars show a seek bar. Per-ayah position (0–8 s) would jump every few seconds, so the
session reports **surah-level** position: `sum(durationMs of ayahs before current) +
ayah-local position`, with the surah's total duration (`surahDurationMs` from timings).
Concretely: position = `ayah.startOffsetMs + localMs`, duration = `surahDurationMs`, both
straight from the surah's timings (`packages/core`), so no new domain logic. Seeking from the
car maps a surah position back to (ayah, localMs) by the ayahs' `startOffsetMs`.
There is one session for every controller, so **the phone notification's seek bar is
surah-level too** — the same bar, the same numbers, wherever it is shown.

### 5.5 Manifest and builds (`plugins/withCarMedia.js`)

- Adds to expo-audio's `AudioControlsService` declaration the intent filters
  `androidx.media3.session.MediaLibraryService` and `android.media.browse.MediaBrowserService`.
- Adds `<meta-data android:name="com.google.android.gms.car.application"
  android:resource="@xml/automotive_app_desc"/>` and writes
  `res/xml/automotive_app_desc.xml` with `<uses name="media"/>`.
- **Automotive variant:** `app.config.js` reads `QURAN_TARGET`; when `automotive`, adds
  `<uses-feature android:name="android.hardware.type.automotive" android:required="true"/>`,
  marks the touchscreen feature not required, and sets a distinct `versionCode` offset
  (+1 000 000) so Play accepts both AABs under one listing. Phone builds are unchanged.

## 6. Data

`apps/mobile/scripts/build-car-library.mjs` (root `npm run build:car-library`) writes
`modules/car-media/android/src/main/assets/car-library.json` from `@quran/data`'s surah
list. Committed, regenerated when the data changes; a test asserts it matches
`getSurahList()` so it cannot drift.

## 7. Errors

| Situation | Car shows | Source |
| --- | --- | --- |
| Surah not downloaded, no network | "No connection — download this surah on your phone" (session error, playback stopped) | engine `error` → `setError` |
| Engine boot > 10 s | "Open Quran on your phone" | `EngineBooter` timeout |
| Audio load failure mid-surah | today's engine error text | engine `error` |
| Car sends `play` with nothing selected | resumes bookmark, else Al-Fatihah 1:1 | `resume` |

Errors are session state, never a silent stop; clearing happens on the next successful play.

## 8. Testing

- **Unit (vitest):** `PlaybackEngine.test.ts` (ported provider tests + `nextSurah`/`prevSurah`
  clamping + resume); `carEngine.test.ts` with a fake `CarMedia` module (commands in,
  metadata/errors out, idempotent registration, offline-vs-network error); `carLibrary`
  data test (json ≡ `getSurahList()`); search matching (diacritics, apostrophes, numbers).
- **Kotlin unit tests** in the module: browse tree from json, search ranking, controller
  routing (`isCarController`), command queueing/timeout in `EngineBooter`.
- **Device — Android Auto:** Google's **Desktop Head Unit (DHU)** on this Mac with the phone
  over USB (Android Auto app → developer settings → "Start head unit server"). Checklist:
  cold start (force-stop app → tap Quran on DHU → browse → play), surah skip from the car vs
  ayah skip on the phone at the same time, voice search, seek, auto-continue, unplug →
  audio continues on the phone, offline surah in airplane mode, error text for a
  non-downloaded surah offline, the recent/resume entry offers the bookmark (the library
  declines the recent root, so the host falls back to `onPlaybackResumption`).
- **Device — AAOS:** Android Automotive emulator image (Android Studio) with the automotive
  AAB: install, browse, play, cold start after reboot.
- **Car review checklist** (Google "Android for Cars app quality") walked before submission:
  no custom UI, ≤ 4 root browse levels, media session actions correct, works without the
  phone screen, no login/interaction prompts on the car.

## 9. Store

Same Play Console app. Phone AAB: opt in to the **Android Auto** form factor (car review).
Automotive AAB: opt in to **Android Automotive OS**, upload to its track (separate review).
Both listings show the same name, logo and description; screenshots for the car form
factors come from the DHU / emulator.

## 10. Out of scope (v1) and future

- **Reader on the car screen** — not possible on Android Auto (the head unit renders only
  Google's templates); possible on AAOS **only while parked**. → **v2: AAOS parked mode**:
  when the car reports Park, open the real reader (word highlight, centred following) on the
  car display; return to templated Now Playing when driving.
- **Apple CarPlay** — wanted later. CarPlay audio apps are templated too
  (`CPListTemplate`/`CPNowPlayingTemplate`) and need Apple's `com.apple.developer.carplay-audio`
  entitlement (requested per app). The engine (§4) and the browse/now-playing model (§2) are
  platform-neutral so the CarPlay bridge drives the same engine.
- Continue / Downloaded / Juz sections, reciter choice, downloading from the car.

## 11. Delivery

Two implementation plans, executed in order, each shippable on its own:

1. **Stage 3a — engine + Android Auto:** §4 engine extraction (behind the unchanged
   `usePlayer()` contract), `modules/car-media`, the expo-audio patch hooks, `withCarMedia`,
   DHU verification. Ends with the phone AAB carrying Android Auto support.
2. **Stage 3b — Automotive OS:** the `QURAN_TARGET=automotive` variant, emulator
   verification, store form factors and car-review checklist for both.

## 12. Risks

- **Patch surface on expo-audio grows** — mitigated by pure delegation hooks and a test that
  compiles the patched module from source in CI (`buildFromSource` already forced).
- **Controller identification on AAOS** — the media UI package differs per OEM; fallback rule
  (holder of `MEDIA_CONTENT_CONTROL`) covers system media UIs; verified on the emulator.
- **Cold-start latency** — ~2–4 s to first ayah (JS boot + timings + first file); the session
  reports `BUFFERING` meanwhile so the car shows a spinner, not a dead button.
- **Car review** — stricter and slower than phone review; the checklist in §8 is the mitigation.
