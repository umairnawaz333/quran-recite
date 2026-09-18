# Car Media Stage 3a — Headless Engine + Android Auto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recitation browsable and controllable from an Android Auto head unit — including from a phone whose app process is dead — through one media session shared with the phone UI and lock screen.

**Architecture:** Playback orchestration leaves React for a module-scope `PlaybackEngine` that the screens (via an unchanged `usePlayer()`), the lock screen and the car all drive. expo-audio's Android service (already patched, compiled from source) becomes a media3 `MediaLibraryService` whose library/transport callbacks delegate to a provider registered by a new local Expo module, `modules/car-media`, which serves the browse tree from a bundled JSON asset, boots the JS engine headless when a command arrives with no engine running, and bridges commands/metadata between Kotlin and JS.

**Tech Stack:** Expo SDK 57 / RN 0.86 (New Architecture, headless JS tasks), expo-audio 57.0.5 (patch-package, `buildFromSource`), androidx.media3 1.9.0 (`MediaLibraryService`, `MediaLibrarySession`, `SimpleBasePlayer`), Kotlin + JUnit 4, vitest + react-test-renderer, `@expo/config-plugins`, Android Auto Desktop Head Unit (DHU).

**Spec:** `docs/superpowers/specs/2026-09-19-car-media-design.md` (§4 engine, §5 native, §7 errors, §8 testing). Stage 3b (Automotive OS variant + store) is a separate plan.

## Global Constraints

- **`usePlayer()`'s contract does not change**: `PlayerState & PlayerActions` from `src/player/PlayerProvider.tsx` (fields `surahId, surahName, ayah, isPlaying, isLoading, error, pendingSurahId`; actions `play, toggle, next, prev, attachViewer`) — **no screen file is modified** in this plan.
- **One media session, one player, one engine** (spec §3). Nothing may create a second `MediaSession`, a second `AyahSequencer`, or a second expo-audio player.
- **Skip semantics** (spec §2): car controllers → next/previous **surah**; every other controller → **ayah**. Decided per command from `MediaSession.ControllerInfo`, never by a global mode flag.
- **Car list = the 114 surahs only**; media ids are `surah:<id>`, root id `root`. Now Playing title `"<nameSimple> · <nameArabic>"`, subtitle `"Ayah <n>"`, artwork = the app logo.
- **Error copy, verbatim:** `No connection — download this surah on your phone` and `Open Quran on your phone` (spec §7). Errors are session state, never a silent stop.
- **expo-audio patch stays delegating hooks** — no playback logic in the patch; anything with a decision in it lives in `modules/car-media` or JS. The patch file is regenerated with `npx patch-package expo-audio` from the repo root after every edit under `node_modules/expo-audio`, and the app compiles it from source (`apps/mobile/package.json` → `expo.autolinking.buildFromSource: ["expo-audio"]`, already set).
- **Nothing under `apps/web` changes; `packages/core` gains no dependencies or platform imports.**
- `npm test` from the repo root must not fall below **350** (91 core / 168 mobile / 91 web) and must rise with each task's tests; `npm run typecheck` exits 0.
- Never `git add` anything under `apps/web/public/audio/`, `apps/mobile/android/`, `apps/mobile/ios/`, `.expo/`, `dist/`, `node_modules`.
- Commit as the repository's configured git user; every commit body ends with the two attribution lines given in the dispatch.
- Device work: never launch or restart an emulator/AVD, never run `expo` in the foreground, `adb logcat -d` only, each shell command under ~2 minutes, `npm test` once at the end of a task. The phone is `adb -s R58N80HYTXT`; package `com.umairnawaz.quran`. macOS has no `timeout` — use bounded loops.

---

## File map

| File | Responsibility |
| --- | --- |
| `apps/mobile/src/player/PlaybackEngine.ts` (new) | Module-scope playback orchestration: sequencer, surah switching, timings, offline/warm paths, bookmark, lock-screen metadata, state + subscribe. No React. |
| `apps/mobile/src/player/PlayerProvider.tsx` (rewrite) | Thin React binding over the engine; same exported types and `usePlayer()`. |
| `apps/mobile/src/player/lockScreenMeta.ts` (new) | `lockScreenMeta(meta, ayah)` — the one place the session's title/subtitle strings are built. |
| `apps/mobile/__tests__/PlaybackEngine.test.ts` (new) | Engine-only tests (no React): `nextSurah/prevSurah/resume`, snapshot stability, headless use. |
| `apps/mobile/scripts/build-car-library.mjs` (new), `apps/mobile/modules/car-media/android/src/main/assets/car-library.json` (generated, committed) | The browse tree's data, derived from `@quran/data/surahs.json`. |
| `apps/mobile/__tests__/carLibrary.test.ts` (new) | Asserts the asset equals `getSurahList()` (cannot drift). |
| `node_modules/expo-audio/.../service/CarLibrary.kt` (new, via patch) | `CarLibraryProvider` interface + `CarLibraryRegistry` singleton — the seam between expo-audio and the module. |
| `node_modules/expo-audio/.../service/AudioControlsService.kt` (patched) | `MediaLibraryService`; `MediaLibrarySession` with `CarSessionCallback`; pending player for cold binds; `setPlayer` handoff. |
| `node_modules/expo-audio/.../service/CarSessionCallback.kt` (new, via patch) | Library + transport delegation to the registry; controller-routed skip; resumption. |
| `node_modules/expo-audio/.../service/MetadataInjectingPlayer.kt` (patched) | Surah-level position/duration from the registry; `seekTo` → command. |
| `node_modules/expo-audio/.../service/PendingPlayer.kt` (new, via patch) | `SimpleBasePlayer` stub reporting BUFFERING until the JS player takes over. |
| `patches/expo-audio+57.0.5.patch` (regenerated) | All of the above. |
| `apps/mobile/modules/car-media/**` (new local Expo module) | `CarMediaModule` (functions/events), `CarLibrary` (tree/search from JSON), `CarController` (car-controller detection), `EngineBooter` + `CarEngineService` (headless boot, command queue), `CarMediaInitProvider` (process-start registration), Kotlin unit tests, JS wrapper `src/index.ts`. |
| `apps/mobile/src/car/carEngine.ts` (new), `apps/mobile/__tests__/carEngine.test.ts`, `__tests__/helpers/fakeCarMedia.ts` | JS bridge: commands → engine, engine → position/error, headless registration. (Search is native — Task 5.) |
| `apps/mobile/index.ts` (modified), `apps/mobile/App.tsx` (one line) | Headless task `QuranCarEngine`; `registerCarEngine()` at app start. |
| `apps/mobile/plugins/withCarMedia.js` (new), `apps/mobile/__tests__/withCarMedia.test.ts`, `apps/mobile/app.json` (plugin entry) | Manifest intent filters, car meta-data, `automotive_app_desc.xml`. |
| `apps/mobile/README.md`, `docs/DATA_SOURCES.md` | Car section; the car-library asset. |

---

### Task 1: Extract `PlaybackEngine` from `PlayerProvider` (behaviour unchanged)

**Files:**
- Create: `apps/mobile/src/player/PlaybackEngine.ts`
- Create: `apps/mobile/src/player/lockScreenMeta.ts`
- Modify: `apps/mobile/src/player/PlayerProvider.tsx` (whole file becomes the binding)
- Test: existing `apps/mobile/__tests__/PlayerProvider.test.tsx` must pass **unchanged** (it drives everything through `usePlayer()`); `apps/mobile/__tests__/helpers/renderPlayer.tsx` gains one line (engine reset).

**Interfaces:**
- Consumes: everything `PlayerProvider.tsx` imports today (`AyahSequencer`, `createExpoPlayer`, `setNowPlaying`/`isNowPlaying`, `cacheAyah`/`localPathFor`, `offlinePathFor`/`offlineTimingsStore`, `readLastPosition`/`writeLastPosition`, `activeWordStore`, `getSurahMeta`, core `SyncEngine`/`loadTimings`/`configureTimings`/`configureAudioBase`).
- Produces (used by Tasks 2 and 6):

```ts
// apps/mobile/src/player/PlaybackEngine.ts
export interface EngineState {
  surahId: number | null; surahName: string | null; ayah: number;
  isPlaying: boolean; isLoading: boolean; error: string | null; pendingSurahId: number | null;
}
export interface PlaybackEngine {
  getState(): EngineState;                        // same object until something changes
  subscribe(listener: () => void): () => void;
  /** Idempotent. Reads the bookmark into the offer, subscribes to AppState. */
  start(): void;
  play(surahId: number, ayah?: number, wordId?: string): Promise<void>;
  toggle(): void;
  next(): Promise<void>;                          // ayah; continues into the next surah on the last one
  prev(): Promise<void>;                          // ayah
  attachViewer(surahId: number): () => void;
  /** Index into the live surah's ayahs, or -1 when nothing is live. */
  currentAyahIndex(): number;
  /** The live surah's timings, or null. */
  currentTimings(): SurahTimings | null;
  /** Ayah-local position of the live player in ms (0 when nothing is live). */
  localTimeMs(): number;
  /** Release everything (tests, and the provider's unmount). */
  __resetForTests(): void;
}
export const engine: PlaybackEngine;
```

```ts
// apps/mobile/src/player/lockScreenMeta.ts
import type { AudioMetadata } from 'expo-audio';
import type { SurahMeta } from '@quran/core';
/** "Al-Baqarah · البقرة" / "Ayah 38" / reciter — the one place these strings are built (spec §2). */
export function lockScreenMeta(meta: SurahMeta, ayah: number): AudioMetadata {
  return { title: `${meta.nameSimple} · ${meta.nameArabic}`, artist: `Ayah ${ayah}`, albumTitle: 'AbdulBaset AbdulSamad · Murattal' };
}
```

- [ ] **Step 1: Run the existing provider tests to record the baseline**

Run: `cd apps/mobile && npx vitest run __tests__/PlayerProvider.test.tsx`
Expected: 22 passed. (This is the contract the extraction must keep.)

- [ ] **Step 2: Create `lockScreenMeta.ts`** with the code in Interfaces above.

- [ ] **Step 3: Create `PlaybackEngine.ts`** by moving `PlayerProvider.tsx`'s logic out of React. Mechanical rules, applied to the current file:

  - Every `useRef(x)` becomes a `let` (or class field) in a `createEngine()` closure: `sequencer`, `syncEngine` (the core `SyncEngine`, renamed to avoid clashing with the exported `engine`), `timings`, `playingSurah`, `viewedSurah`, `request`, `ayahIndex`, `detachHandlers`, `handlerEpoch`, `lockScreenPlayer`, `register`, `isPlayingFlag`, `offered`.
  - `useState<PlayerState>` becomes `let state: EngineState = INITIAL` plus `const listeners = new Set<() => void>()`; `patch(next)` does `state = { ...state, ...next }; listeners.forEach(l => l())`. **`patch` must not notify when nothing changed** (`if (Object.keys(next).every(k => state[k] === next[k])) return;`) so `getState()` stays reference-stable.
  - `useCallback` bodies become plain functions; `play`'s body is copied verbatim (comments included) with `patch`/`paint`/refs renamed to the closure variables. `lockScreenMeta(meta)` calls become `lockScreenMeta(meta, currentAyahNumber())` where `currentAyahNumber()` is `timings?.ayahs[ayahIndex]?.ayah ?? 1` — and `registerLockScreen()` is also called from `onAyahChange` as today, so the subtitle follows the ayah.
  - The two mount effects become `start()`: `AppState.addEventListener('change', s => { if (s === 'active') register?.(); })` and the `readLastPosition()` offer; `start()` sets a `started` flag and returns immediately on repeat calls.
  - The unmount effect becomes `__resetForTests()`: `teardown()`, remove the AppState subscription, `started = false`, `state = INITIAL`, `request = 0`, `handlerEpoch = 0`, notify.
  - `INITIAL`, `localAudioFor`, `warmCache`, the two `configure*` module-scope calls and the constants move over unchanged.
  - `currentAyahIndex()`, `currentTimings()`, `localTimeMs()` read `playingSurah === null ? -1 : ayahIndex`, `timings`, `sequencer?.localTimeMs ?? 0`.

  Then `export const engine: PlaybackEngine = createEngine();`

- [ ] **Step 4: Rewrite `PlayerProvider.tsx` as the binding**

```tsx
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { engine } from './PlaybackEngine';
import type { EngineState } from './PlaybackEngine';

export type PlayerState = EngineState;                       // same fields as before
export interface PlayerActions {
  play(surahId: number, ayah?: number, wordId?: string): Promise<void>;
  toggle(): void;
  next(): Promise<void>;
  prev(): Promise<void>;
  attachViewer(surahId: number): () => void;
}
export type PlayerContextValue = PlayerState & PlayerActions;
const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayer(): PlayerContextValue {
  const value = useContext(PlayerContext);
  if (!value) throw new Error('usePlayer must be used inside <PlayerProvider>');
  return value;
}

/**
 * The React face of `PlaybackEngine`. Playback itself lives in the engine
 * (module scope, no React) so the same sequencer serves the screens, the
 * lock screen and — from Stage 3a — a car head unit that may start it with
 * no Activity at all. This component only subscribes and re-exposes the
 * engine's actions under the names the screens already use.
 */
export function PlayerProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => { engine.start(); }, []);
  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
  // Actions are the engine's own functions: stable identities for free, so
  // consumers' effects that depend on them never re-run per ayah.
  const value = useMemo(() => ({
    ...state, play: engine.play, toggle: engine.toggle, next: engine.next, prev: engine.prev, attachViewer: engine.attachViewer,
  }), [state]);
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
```

  Keep the long comment about "the context value is rebuilt on every state tick" from the old file above `useMemo`. The old test "hands out the same action functions across state updates" (PlayerProvider.test.tsx:582) now holds because the engine's functions are module-scope.

- [ ] **Step 5: Reset the engine between tests** — in `__tests__/helpers/renderPlayer.tsx`, `resetPlayerEnvironment()` adds, after `resetReactNative();`:

```ts
  engine.__resetForTests();
```
  with `import { engine } from '../../src/player/PlaybackEngine';`. (The provider used to be torn down by unmount; the engine is a singleton now, so the harness must reset it explicitly.)

- [ ] **Step 6: Run the provider tests**

Run: `cd apps/mobile && npx vitest run __tests__/PlayerProvider.test.tsx`
Expected: 22 passed, no act() warnings. If "the provider never rendered its children" appears, `useSyncExternalStore` is being given a `getState` that allocates — check the reference-stability rule in Step 3.

- [ ] **Step 7: Whole-repo gates**

Run: `npm test` and `npm run typecheck` from the repo root.
Expected: 350 tests, typecheck 0. Also grep that no screen changed: `git status --short apps/mobile/src/screens apps/mobile/src/reader apps/mobile/src/player/PlayerBar.tsx` prints nothing.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/player/PlaybackEngine.ts apps/mobile/src/player/lockScreenMeta.ts apps/mobile/src/player/PlayerProvider.tsx apps/mobile/__tests__/helpers/renderPlayer.tsx
git commit -m "refactor(mobile): playback orchestration moves out of React into PlaybackEngine

usePlayer() is unchanged; the provider is now a useSyncExternalStore binding.
The engine is module scope so a headless entry point (the car) can drive the
same sequencer with no Activity."
```

---

### Task 2: Engine API for the car — `nextSurah`, `prevSurah`, `resume`, `seekToSurahPosition`

**Files:**
- Modify: `apps/mobile/src/player/PlaybackEngine.ts`
- Test: `apps/mobile/__tests__/PlaybackEngine.test.ts` (new)

**Interfaces:**
- Consumes: Task 1's `engine`.
- Produces (added to `PlaybackEngine`):

```ts
  /** Play the next/previous surah from ayah 1; no-op at 114 / 1 when nothing else applies. */
  nextSurah(): Promise<void>;
  prevSurah(): Promise<void>;
  /** Play the bookmark (or the offered position) — what the car's bare "play" means. */
  resume(): Promise<void>;
  /** Seek within the live surah by surah-level position (spec §5.4); ignored when nothing is live. */
  seekToSurahPosition(positionMs: number): Promise<void>;
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/mobile/__tests__/PlaybackEngine.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native', async () => await import('./helpers/reactNativeMock'));
vi.mock('expo-file-system', async () => {
  const fs = await import('./helpers/fakeFileSystem');
  return fs.fakeFileSystemModule;
});
vi.mock('expo-audio', async () => {
  const fake = await import('./helpers/fakeAudio');
  return { setAudioModeAsync: fake.setAudioModeAsync, createAudioPlayer: fake.createAudioPlayer };
});
vi.mock('../src/audio/expoPlayer', async () => {
  const fake = await import('./helpers/fakeAudio');
  return { createExpoPlayer: fake.createExpoPlayer };
});
vi.mock('../src/audio/nowPlaying', async () => {
  const fake = await import('./helpers/fakeAudio');
  return { setNowPlaying: fake.setNowPlaying, isNowPlaying: fake.isNowPlaying };
});
import { engine } from '../src/player/PlaybackEngine';
import { resetPlayerEnvironment } from './helpers/renderPlayer';
import { provideTimings } from './helpers/fakeTimings';
import { audio } from './helpers/fakeAudio';
import { saveLastPosition } from './helpers/fakeFileSystem';

const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

beforeEach(() => {
  resetPlayerEnvironment();
  provideTimings(1, 7);
  provideTimings(2, 5);
  provideTimings(113, 5);
  provideTimings(114, 6);
});

describe('PlaybackEngine — surah skipping for the car', () => {
  it('nextSurah plays the following surah from ayah 1', async () => {
    await engine.play(2, 3); await settle();
    await engine.nextSurah(); await settle();
    expect(engine.getState()).toMatchObject({ surahId: 3, ayah: 1 });
  });
  it('prevSurah plays the preceding surah from ayah 1, and is a no-op at surah 1', async () => {
    await engine.play(2); await settle();
    await engine.prevSurah(); await settle();
    expect(engine.getState().surahId).toBe(1);
    await engine.prevSurah(); await settle();
    expect(engine.getState().surahId).toBe(1);
  });
  it('nextSurah at 114 does nothing', async () => {
    await engine.play(114); await settle();
    await engine.nextSurah(); await settle();
    expect(engine.getState().surahId).toBe(114);
  });
});

describe('PlaybackEngine — resume', () => {
  it('plays the bookmark when nothing is live', async () => {
    saveLastPosition({ surahId: 2, ayah: 4, localMs: 0 });
    engine.start(); await settle();
    await engine.resume(); await settle();
    expect(engine.getState()).toMatchObject({ surahId: 2, ayah: 4, isPlaying: true });
  });
  it('is play() when something is live', async () => {
    await engine.play(1); await settle();
    engine.toggle(); await settle();
    expect(engine.getState().isPlaying).toBe(false);
    await engine.resume(); await settle();
    expect(engine.getState().isPlaying).toBe(true);
  });
});

describe('PlaybackEngine — surah-level seek', () => {
  it('maps a surah position onto (ayah, localMs) by startOffsetMs', async () => {
    await engine.play(1); await settle();
    const t = engine.currentTimings()!;
    const target = t.ayahs[3].startOffsetMs + 250;
    await engine.seekToSurahPosition(target); await settle();
    expect(engine.getState().ayah).toBe(t.ayahs[3].ayah);
    expect(engine.localTimeMs()).toBe(250);
  });
  it('is ignored when nothing is live', async () => {
    await engine.seekToSurahPosition(5000); await settle();
    expect(engine.getState().surahId).toBe(1);   // still the offer, untouched
    expect(audio.players).toHaveLength(0);
  });
});

describe('PlaybackEngine — snapshots', () => {
  it('returns the same state object until something changes', async () => {
    const a = engine.getState(); const b = engine.getState();
    expect(b).toBe(a);
    await engine.play(1); await settle();
    expect(engine.getState()).not.toBe(a);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/mobile && npx vitest run __tests__/PlaybackEngine.test.ts`
Expected: FAIL — `engine.nextSurah is not a function` (and the others).

- [ ] **Step 3: Implement** in `PlaybackEngine.ts`:

```ts
  async function nextSurah() { const s = playingSurah ?? state.surahId; if (s !== null && s < 114) await play(s + 1); }
  async function prevSurah() { const s = playingSurah ?? state.surahId; if (s !== null && s > 1) await play(s - 1); }
  async function resume() {
    if (sequencer && playingSurah !== null) { await sequencer.play(); return; }
    const { surahId, ayah } = offered;           // bookmark if it was read, else the INITIAL offer
    if (surahId !== null) await play(surahId, ayah);
  }
  async function seekToSurahPosition(positionMs: number) {
    if (!sequencer || !timings || playingSurah === null) return;
    // The last ayah whose start is at or before the position (spec §5.4).
    let index = 0;
    for (let i = 0; i < timings.ayahs.length; i++) if (timings.ayahs[i].startOffsetMs <= positionMs) index = i;
    const localMs = Math.max(0, positionMs - timings.ayahs[index].startOffsetMs);
    await sequencer.seekToAyah(index, localMs);
  }
```

  and add them to the returned object and the `PlaybackEngine` interface.

- [ ] **Step 4: Run the new tests and the provider tests**

Run: `cd apps/mobile && npx vitest run __tests__/PlaybackEngine.test.ts __tests__/PlayerProvider.test.tsx`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/player/PlaybackEngine.ts apps/mobile/__tests__/PlaybackEngine.test.ts
git commit -m "feat(mobile): engine gains nextSurah/prevSurah/resume and surah-level seek for the car"
```

---

### Task 3: The browse tree's data — `car-library.json`

**Files:**
- Create: `apps/mobile/scripts/build-car-library.mjs`
- Create (generated, committed): `apps/mobile/modules/car-media/android/src/main/assets/car-library.json`
- Modify: root `package.json` (script `build:car-library`)
- Test: `apps/mobile/__tests__/carLibrary.test.ts`

**Interfaces:**
- Produces: the asset — a JSON array of 114 `{ "id": 1, "nameSimple": "Al-Fatihah", "nameArabic": "الفاتحة", "nameEnglish": "The Opener", "ayahCount": 7 }`, ordered by id. Consumed by Task 5's `CarLibrary.kt`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/__tests__/carLibrary.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getSurahList } from '../src/data/surahs';

const ASSET = new URL('../modules/car-media/android/src/main/assets/car-library.json', import.meta.url);

describe('car-library.json', () => {
  it('is exactly the surah list the app uses, in the shape the car service reads', () => {
    const asset = JSON.parse(readFileSync(ASSET, 'utf8'));
    const expected = getSurahList().map(({ id, nameSimple, nameArabic, nameEnglish, ayahCount }) =>
      ({ id, nameSimple, nameArabic, nameEnglish, ayahCount }));
    expect(asset).toEqual(expected);
    expect(asset).toHaveLength(114);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd apps/mobile && npx vitest run __tests__/carLibrary.test.ts` → FAIL (ENOENT).

- [ ] **Step 3: Write the script**

```js
// apps/mobile/scripts/build-car-library.mjs
// Writes the browse tree the car service serves natively (no JS needed to
// browse) from the same surah list the app uses. Re-run when surahs.json changes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../../packages/quran-data/surahs.json');
const out = resolve(here, '../modules/car-media/android/src/main/assets/car-library.json');
const surahs = JSON.parse(readFileSync(src, 'utf8'));
const library = surahs.map(({ id, nameSimple, nameArabic, nameEnglish, ayahCount }) => ({ id, nameSimple, nameArabic, nameEnglish, ayahCount }));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(library) + '\n');
console.log(`car-library.json: ${library.length} surahs`);
```

  Check the real path of `surahs.json` first (`ls packages/quran-data/`); the mobile app imports it as `@quran/data/surahs.json`.

  Root `package.json` scripts: `"build:car-library": "node apps/mobile/scripts/build-car-library.mjs"`. Run it: `npm run build:car-library`.

- [ ] **Step 4: Run the test** → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/scripts/build-car-library.mjs apps/mobile/modules/car-media/android/src/main/assets/car-library.json package.json apps/mobile/__tests__/carLibrary.test.ts
git commit -m "feat(mobile): car browse tree data generated from the surah list"
```

---

### Task 4: expo-audio patch — library session, pending player, delegating callback, surah-level position

**Files (all under `node_modules/expo-audio/android/src/main/java/expo/modules/audio/service/`, captured into `patches/expo-audio+57.0.5.patch`):**
- Create: `CarLibrary.kt`, `CarSessionCallback.kt`, `PendingPlayer.kt`
- Modify: `AudioControlsService.kt`, `MetadataInjectingPlayer.kt`
- Test: compile only (`cd apps/mobile/android && ./gradlew :expo-audio:compileReleaseKotlin -q`); the behaviour is exercised by Task 5's Kotlin tests and Task 8 on the DHU.

**Interfaces:**
- Produces (the seam Task 5 implements/registers):

```kotlin
// CarLibrary.kt
package expo.modules.audio.service

import android.graphics.Bitmap
import androidx.media3.common.MediaItem
import androidx.media3.session.MediaSession

/** What a car (or any browsing controller) can ask of this app. Implemented outside expo-audio. */
interface CarLibraryProvider {
  fun isCarController(controller: MediaSession.ControllerInfo): Boolean
  fun root(): MediaItem
  /** null = unknown parent id. */
  fun children(parentId: String): List<MediaItem>?
  fun item(mediaId: String): MediaItem?
  fun search(query: String): List<MediaItem>
  /**
   * type ∈ playSurah(arg = surah id) | nextSurah | prevSurah | nextAyah | prevAyah |
   *        resume | seekTo(arg = surah-level position ms). Must return quickly.
   */
  fun onCommand(type: String, arg: Long?)
  /** Artwork for Now Playing and the notification. */
  fun artwork(): Bitmap?
}

/** Process-wide registration point; set before any controller connects (a ContentProvider does it). */
object CarLibraryRegistry {
  @Volatile var provider: CarLibraryProvider? = null
  /** Surah-level position = offset + the player's own position (spec §5.4). Set from JS per ayah. */
  @Volatile var positionOffsetMs: Long = 0
  /** Surah duration to report instead of the ayah file's; C.TIME_UNSET = pass through. */
  @Volatile var durationOverrideMs: Long = androidx.media3.common.C.TIME_UNSET
  /** Set by the service when it exists, so a provider can push an error into the session. */
  @Volatile var errorSink: ((String) -> Unit)? = null
}
```

- [ ] **Step 1: Read the current patch and the two files to be edited** — `patches/expo-audio+57.0.5.patch`, `AudioControlsService.kt` (all 600 lines), `MetadataInjectingPlayer.kt`, `AudioMediaSessionCallback.kt`. Note where `MediaSession.Builder(context, sessionPlayer)` is built (twice, ~lines 387 and 468) and `onGetSession`.

- [ ] **Step 2: Add `CarLibrary.kt`** (code above).

- [ ] **Step 3: Add `PendingPlayer.kt`** — the player a cold-bound car sees until the JS player exists:

```kotlin
package expo.modules.audio.service

import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import androidx.media3.common.util.UnstableApi
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * Stands in for the real player while the JS engine boots after a cold bind
 * from the car: reports BUFFERING with playWhenReady so the head unit shows
 * a spinner, accepts (and ignores) transport calls, and is swapped out with
 * `MediaSession.setPlayer` the moment expo-audio's real player is activated.
 */
@OptIn(UnstableApi::class)
class PendingPlayer(looper: Looper) : SimpleBasePlayer(looper) {
  private var playWhenReady = false
  override fun getState(): State = State.Builder()
    .setAvailableCommands(Player.Commands.Builder().addAll(
      Player.COMMAND_PLAY_PAUSE, Player.COMMAND_PREPARE, Player.COMMAND_STOP,
      Player.COMMAND_SET_MEDIA_ITEM, Player.COMMAND_CHANGE_MEDIA_ITEMS,
      Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_PREVIOUS,
      Player.COMMAND_GET_CURRENT_MEDIA_ITEM, Player.COMMAND_GET_TIMELINE).build())
    .setPlaybackState(if (playWhenReady) Player.STATE_BUFFERING else Player.STATE_IDLE)
    .setPlayWhenReady(playWhenReady, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
    .build()
  override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> { this.playWhenReady = playWhenReady; return Futures.immediateVoidFuture() }
  override fun handlePrepare(): ListenableFuture<*> = Futures.immediateVoidFuture()
  override fun handleStop(): ListenableFuture<*> { playWhenReady = false; return Futures.immediateVoidFuture() }
  override fun handleSetMediaItems(mediaItems: MutableList<MediaItem>, startIndex: Int, startPositionMs: Long): ListenableFuture<*> = Futures.immediateVoidFuture()
  override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> = Futures.immediateVoidFuture()
}
```

- [ ] **Step 4: Add `CarSessionCallback.kt`** — extends today's `AudioMediaSessionCallback` behaviour with library + routing:

```kotlin
package expo.modules.audio.service

import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService.LibraryParams
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * One callback for every controller — phone notification, headphones, car.
 * Library calls and surah-level commands delegate to `CarLibraryRegistry.provider`;
 * with no provider registered the session behaves exactly as before this patch.
 */
@OptIn(UnstableApi::class)
class CarSessionCallback : MediaLibrarySession.Callback {
  private val base = AudioMediaSessionCallback()
  private val provider get() = CarLibraryRegistry.provider

  override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
    val accepted = base.onConnect(session, controller)
    if (provider == null) return accepted
    // Next/previous exist again (the base removes them): a car needs them, and JS decides what they mean.
    val playerCommands = accepted.availablePlayerCommands.buildUpon()
      .add(Player.COMMAND_SEEK_TO_NEXT).add(Player.COMMAND_SEEK_TO_PREVIOUS)
      .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM).add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
      .add(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM).build()
    return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
      .setAvailablePlayerCommands(playerCommands)
      .setAvailableSessionCommands(accepted.availableSessionCommands)
      .build()
  }

  override fun onCustomCommand(session: MediaSession, controller: MediaSession.ControllerInfo, command: SessionCommand, args: Bundle): ListenableFuture<SessionResult> =
    base.onCustomCommand(session, controller, command, args)

  /** Skip = surah for a car controller, ayah for everyone else (spec §2/§5.3). The player itself never skips. */
  override fun onPlayerCommandRequest(session: MediaSession, controller: MediaSession.ControllerInfo, playerCommand: Int): Int {
    val p = provider ?: return super.onPlayerCommandRequest(session, controller, playerCommand)
    val car = p.isCarController(controller)
    return when (playerCommand) {
      Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> { p.onCommand(if (car) "nextSurah" else "nextAyah", null); SessionResult.RESULT_INFO_SKIPPED }
      Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> { p.onCommand(if (car) "prevSurah" else "prevAyah", null); SessionResult.RESULT_INFO_SKIPPED }
      else -> super.onPlayerCommandRequest(session, controller, playerCommand)
    }
  }

  // ---- library -----------------------------------------------------------
  private fun <T> unsupported(): ListenableFuture<LibraryResult<T>> = Futures.immediateFuture(LibraryResult.ofError(SessionError.ERROR_NOT_SUPPORTED))

  override fun onGetLibraryRoot(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, params: LibraryParams?): ListenableFuture<LibraryResult<MediaItem>> {
    val p = provider ?: return unsupported()
    return Futures.immediateFuture(LibraryResult.ofItem(p.root(), params))
  }
  override fun onGetChildren(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, parentId: String, page: Int, pageSize: Int, params: LibraryParams?): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
    val children = provider?.children(parentId) ?: return Futures.immediateFuture(LibraryResult.ofError(SessionError.ERROR_BAD_VALUE))
    return Futures.immediateFuture(LibraryResult.ofItemList(ImmutableList.copyOf(children), params))
  }
  override fun onGetItem(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, mediaId: String): ListenableFuture<LibraryResult<MediaItem>> {
    val item = provider?.item(mediaId) ?: return Futures.immediateFuture(LibraryResult.ofError(SessionError.ERROR_BAD_VALUE))
    return Futures.immediateFuture(LibraryResult.ofItem(item, null))
  }
  override fun onSearch(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, query: String, params: LibraryParams?): ListenableFuture<LibraryResult<Void>> {
    val p = provider ?: return unsupported()
    session.notifySearchResultChanged(browser, query, p.search(query).size, params)
    return Futures.immediateFuture(LibraryResult.ofVoid())
  }
  override fun onGetSearchResult(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, query: String, page: Int, pageSize: Int, params: LibraryParams?): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
    val p = provider ?: return unsupported()
    return Futures.immediateFuture(LibraryResult.ofItemList(ImmutableList.copyOf(p.search(query)), params))
  }

  // ---- play requests -------------------------------------------------------
  // The JS engine sequences ayah files itself, so a request to play `surah:<id>` is
  // forwarded as a command and the player's own queue is left EMPTY on purpose: an
  // empty result never hands ExoPlayer a URI it would fight the engine over.
  private fun nothingToQueue() = Futures.immediateFuture(MediaSession.MediaItemsWithStartPosition(emptyList(), C.INDEX_UNSET, C.TIME_UNSET))

  override fun onSetMediaItems(mediaSession: MediaSession, controller: MediaSession.ControllerInfo, mediaItems: MutableList<MediaItem>, startIndex: Int, startPositionMs: Long): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
    val id = mediaItems.firstOrNull()?.mediaId ?: return nothingToQueue()
    val surah = id.removePrefix("surah:").toLongOrNull()
    if (surah != null) provider?.onCommand("playSurah", surah)
    return nothingToQueue()
  }
  override fun onAddMediaItems(mediaSession: MediaSession, controller: MediaSession.ControllerInfo, mediaItems: MutableList<MediaItem>): ListenableFuture<MutableList<MediaItem>> {
    mediaItems.firstOrNull()?.mediaId?.removePrefix("surah:")?.toLongOrNull()?.let { provider?.onCommand("playSurah", it) }
    return Futures.immediateFuture(mutableListOf())
  }
  /** A bare "play" from the car with nothing selected: resume the bookmark (spec §7). */
  override fun onPlaybackResumption(mediaSession: MediaSession, controller: MediaSession.ControllerInfo): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
    provider?.onCommand("resume", null)
    return nothingToQueue()
  }
}
```

  If media3 1.9.0's signatures differ (e.g. `onPlaybackResumption` gains an `isForPlayback: Boolean` parameter), match the installed `.class` signatures — check with `unzip -p ~/.gradle/caches/**/media3-session-1.9.0*.aar classes.jar | javap`-style inspection or by compiling and reading the error; do not guess.

- [ ] **Step 5: Patch `AudioControlsService.kt`:**
  1. `class AudioControlsService : MediaSessionService()` → `: MediaLibraryService()`; imports `androidx.media3.session.MediaLibraryService` and `MediaLibraryService.MediaLibrarySession`.
  2. `private var mediaSession: MediaSession? = null` → `private var mediaSession: MediaLibrarySession? = null`, plus `private var pendingPlayer: PendingPlayer? = null`.
  3. Both `MediaSession.Builder(context, sessionPlayer).setCallback(AudioMediaSessionCallback()).build()` sites: if `mediaSession != null && pendingPlayer != null` (a car bound cold) → `mediaSession!!.setPlayer(sessionPlayer); pendingPlayer = null; val session = mediaSession!!` and **skip** `addSession`; otherwise `MediaLibrarySession.Builder(this, sessionPlayer, CarSessionCallback()).setId("quran").build()` as today (`addSession` etc. unchanged). Set `CarLibraryRegistry.errorSink = { msg -> mediaSession?.let { s -> (s.player as? MetadataInjectingPlayer)?.reportError(msg) } }`.
  4. `onGetSession(controllerInfo)`: `mediaSession ?: createPendingSession()` where

```kotlin
  private fun createPendingSession(): MediaLibrarySession {
    val pending = PendingPlayer(mainLooper)
    pendingPlayer = pending
    val session = MediaLibrarySession.Builder(this, pending, CarSessionCallback()).setId("quran").build()
    addSession(session)
    mediaSession = session
    return session
  }
```
  5. `clearSessionInternal()`: also `pendingPlayer = null`.
  6. `onUpdateNotification`: guard `if (session.player is PendingPlayer) return` (no notification for the stub).

- [ ] **Step 6: Patch `MetadataInjectingPlayer.kt`** (a `ForwardingPlayer`): add

```kotlin
  private var errorMessage: String? = null
  fun reportError(message: String) { errorMessage = message; /* listeners re-read getPlayerError via onEvents */ }
  override fun getPlayerError(): PlaybackException? =
    errorMessage?.let { PlaybackException(it, null, PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED) } ?: super.getPlayerError()
  override fun getCurrentPosition(): Long = CarLibraryRegistry.positionOffsetMs + super.getCurrentPosition()
  override fun getContentPosition(): Long = CarLibraryRegistry.positionOffsetMs + super.getContentPosition()
  override fun getBufferedPosition(): Long = CarLibraryRegistry.positionOffsetMs + super.getBufferedPosition()
  override fun getDuration(): Long = CarLibraryRegistry.durationOverrideMs.takeIf { it != C.TIME_UNSET } ?: super.getDuration()
  override fun getContentDuration(): Long = getDuration()
  override fun seekTo(positionMs: Long) {
    val p = CarLibraryRegistry.provider
    if (p != null && CarLibraryRegistry.durationOverrideMs != C.TIME_UNSET) p.onCommand("seekTo", positionMs) else super.seekTo(positionMs)
  }
  override fun seekTo(mediaItemIndex: Int, positionMs: Long) = seekTo(positionMs)
```

  and clear `errorMessage` in `updateMetadata` (a new ayah's metadata means playback recovered). Artwork: in `getMediaMetadata()`, if the injected metadata has no artwork and `CarLibraryRegistry.provider?.artwork()` is non-null, `setArtworkData(pngBytes, MediaMetadata.PICTURE_TYPE_FRONT_COVER)` (compress once, cache the bytes in a field).

- [ ] **Step 7: Compile**

Run: `cd apps/mobile/android && ./gradlew :expo-audio:compileReleaseKotlin -q 2>&1 | grep -E "^e: |error:" | head`
Expected: no lines. (If the project is not named `:expo-audio`, `./gradlew projects | grep -i audio` shows the name.)

- [ ] **Step 8: Regenerate the patch and prove it applies**

Run (repo root): `npx patch-package expo-audio && git diff --stat patches/ && rm -rf node_modules/expo-audio && npm install --no-audit --no-fund 2>&1 | tail -2 && grep -c "CarSessionCallback" node_modules/expo-audio/android/src/main/java/expo/modules/audio/service/AudioControlsService.kt`
Expected: the patch grew; after reinstall `postinstall` re-applied it (count ≥ 1).

- [ ] **Step 9: Commit**

```bash
git add patches/expo-audio+57.0.5.patch
git commit -m "feat(mobile): expo-audio serves a media library session — browse, controller-routed skip, surah-level position

Delegating hooks only: with no CarLibraryProvider registered the session
behaves as before. A cold bind gets a buffering stand-in player that is
swapped for the real one with setPlayer when JS activates it."
```

---

### Task 5: `modules/car-media` — the native module

**Files:**
- Create: `apps/mobile/modules/car-media/expo-module.config.json`, `android/build.gradle`, `android/src/main/AndroidManifest.xml`, `android/src/main/res/drawable-nodpi/car_artwork.png` (copy of `apps/mobile/assets/logo.png`), and under `android/src/main/java/expo/modules/carmedia/`: `CarMediaModule.kt`, `CarLibrary.kt`, `CarController.kt`, `EngineBooter.kt`, `CarEngineService.kt`, `CarMediaInitProvider.kt`, `CarMediaProvider.kt`
- Create: `apps/mobile/modules/car-media/src/index.ts`
- Test: `apps/mobile/modules/car-media/android/src/test/java/expo/modules/carmedia/{CarLibraryTest,CarControllerTest,EngineBooterTest}.kt` (JUnit 4)

**Interfaces:**
- Consumes: Task 3's asset; Task 4's `CarLibraryProvider`/`CarLibraryRegistry` (dependency `implementation project(':expo-audio')`).
- Produces (JS, `modules/car-media/src/index.ts`):

```ts
export type CarCommand =
  | { type: 'playSurah'; surahId: number } | { type: 'nextSurah' } | { type: 'prevSurah' }
  | { type: 'nextAyah' } | { type: 'prevAyah' } | { type: 'resume' } | { type: 'seekTo'; positionMs: number };
export interface NowPlayingPosition { positionOffsetMs: number; durationMs: number }
export const CarMedia: {
  /** JS engine is up and listening; the native side flushes queued commands. */
  engineReady(): void;
  /** Surah-level position mapping for the seek bar (spec §5.4). */
  setPosition(p: NowPlayingPosition): void;
  /** Push an error into the session (spec §7). */
  setError(message: string): void;
  addCommandListener(cb: (c: CarCommand) => void): { remove(): void };
};
```

- [ ] **Step 1: Scaffold the module** — `expo-module.config.json`:

```json
{ "platforms": ["android"], "android": { "modules": ["expo.modules.carmedia.CarMediaModule"] } }
```

  `android/build.gradle` (copy `modules/tajweed-text/android/build.gradle`, namespace/group `expo.modules.carmedia`, dependencies):

```groovy
dependencies {
  implementation 'com.facebook.react:react-android'          // HeadlessJsTaskService
  implementation project(':expo-audio')                       // CarLibraryProvider / CarLibraryRegistry (Task 4)
  implementation "androidx.media3:media3-session:1.9.0"
  testImplementation 'junit:junit:4.13.2'
}
```

  Confirm the expo-audio Gradle project name with `cd apps/mobile/android && ./gradlew projects | grep -i audio` after a prebuild; use what it prints.

  `AndroidManifest.xml`:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application>
    <!-- Registers the CarLibraryProvider at process start, before any controller can bind. -->
    <provider android:name="expo.modules.carmedia.CarMediaInitProvider"
      android:authorities="${applicationId}.carmedia-init" android:exported="false" android:initOrder="50" />
    <!-- Boots the JS engine with no Activity when the car asks to play (spec §5.1). -->
    <service android:name="expo.modules.carmedia.CarEngineService"
      android:exported="false" android:foregroundServiceType="mediaPlayback" />
  </application>
</manifest>
```

- [ ] **Step 2: Write the failing Kotlin tests**

```kotlin
// android/src/test/java/expo/modules/carmedia/CarLibraryTest.kt
package expo.modules.carmedia
import org.junit.Assert.*
import org.junit.Test

class CarLibraryTest {
  private val json = """[{"id":1,"nameSimple":"Al-Fatihah","nameArabic":"الفاتحة","nameEnglish":"The Opener","ayahCount":7},
    {"id":18,"nameSimple":"Al-Kahf","nameArabic":"الكهف","nameEnglish":"The Cave","ayahCount":110},
    {"id":36,"nameSimple":"Ya-Sin","nameArabic":"يس","nameEnglish":"Ya Sin","ayahCount":83}]"""
  private val lib = CarLibrary.parse(json)

  @Test fun rootListsEverySurahInOrder() {
    val ids = lib.children("root")!!.map { it.mediaId }
    assertEquals(listOf("surah:1", "surah:18", "surah:36"), ids)
  }
  @Test fun surahRowCarriesNamesAndCount() {
    val kahf = lib.item("surah:18")!!
    assertEquals("Al-Kahf", kahf.mediaMetadata.title)
    assertEquals("الكهف · 110 ayahs", kahf.mediaMetadata.subtitle)
    assertEquals(true, kahf.mediaMetadata.isPlayable)
    assertEquals(false, kahf.mediaMetadata.isBrowsable)
  }
  @Test fun unknownParentIsNull() { assertNull(lib.children("nope")) }
  @Test fun searchMatchesNumberNameAndLooseSpelling() {
    assertEquals("surah:18", lib.search("18").first().mediaId)
    assertEquals("surah:18", lib.search("al kahf").first().mediaId)
    assertEquals("surah:18", lib.search("the cave").first().mediaId)
    assertEquals("surah:36", lib.search("yasin").first().mediaId)       // hyphen ignored
    assertEquals("surah:1", lib.search("الفاتحة").first().mediaId)
    assertTrue(lib.search("zzz").isEmpty())
  }
}
```

```kotlin
// CarControllerTest.kt
package expo.modules.carmedia
import org.junit.Assert.*
import org.junit.Test

class CarControllerTest {
  @Test fun androidAutoIsACar() { assertTrue(CarController.isCarPackage("com.google.android.projection.gearhead", hasMediaContentControl = false)) }
  @Test fun aSystemMediaUiWithMediaContentControlIsACar() { assertTrue(CarController.isCarPackage("com.android.car.media", hasMediaContentControl = true)) }
  @Test fun ourOwnNotificationIsNot() { assertFalse(CarController.isCarPackage("com.umairnawaz.quran", hasMediaContentControl = false)) }
  @Test fun aHeadsetOrOtherAppIsNot() { assertFalse(CarController.isCarPackage("com.android.bluetooth", hasMediaContentControl = false)) }
}
```

```kotlin
// EngineBooterTest.kt
package expo.modules.carmedia
import org.junit.Assert.*
import org.junit.Test

class EngineBooterTest {
  private val delivered = mutableListOf<Pair<String, Long?>>()
  private var boots = 0
  private var errors = mutableListOf<String>()
  private var now = 0L
  private val booter = EngineBooter(
    boot = { boots++ }, deliver = { t, a -> delivered += t to a }, error = { errors += it }, clock = { now })

  @Test fun deliversDirectlyWhenTheEngineIsUp() {
    booter.engineReady()
    booter.command("playSurah", 5)
    assertEquals(listOf("playSurah" to 5L), delivered); assertEquals(0, boots)
  }
  @Test fun bootsOnceAndQueuesUntilReady() {
    booter.command("playSurah", 5); booter.command("nextSurah", null)
    assertEquals(1, boots); assertTrue(delivered.isEmpty())
    booter.engineReady()
    assertEquals(listOf("playSurah" to 5L, "nextSurah" to null), delivered)
  }
  @Test fun onlyTheLatestPlayRequestSurvivesTheQueue() {
    booter.command("playSurah", 5); booter.command("playSurah", 7)
    booter.engineReady()
    assertEquals(listOf("playSurah" to 7L), delivered)
  }
  @Test fun timesOutWithTheOpenQuranMessage() {
    booter.command("playSurah", 5)
    now = 10_001; booter.tick()
    assertEquals(listOf("Open Quran on your phone"), errors); assertTrue(delivered.isEmpty())
    booter.engineReady()                                  // late ready: nothing stale is delivered
    assertTrue(delivered.isEmpty())
  }
  @Test fun engineGoingAwayRequiresANewBoot() {
    booter.engineReady(); booter.engineGone()
    booter.command("resume", null)
    assertEquals(1, boots)
  }
}
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd apps/mobile && CI=1 npx expo prebuild --platform android --no-install >/dev/null && cd android && ./gradlew projects | grep -i car` → note the project name (expected `:car-media`), then `./gradlew :car-media:testDebugUnitTest -q 2>&1 | tail -5`
Expected: compilation errors (classes missing).

- [ ] **Step 4: Implement `CarLibrary.kt`**

```kotlin
package expo.modules.carmedia

import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import org.json.JSONArray
import java.text.Normalizer

/** The browse tree: `root` → 114 playable surah rows. Pure data + matching; the service adapts it. */
class CarLibrary(private val surahs: List<Surah>, private val artworkUri: Uri? = null) {
  data class Surah(val id: Int, val nameSimple: String, val nameArabic: String, val nameEnglish: String, val ayahCount: Int)

  fun root(): MediaItem = MediaItem.Builder().setMediaId("root")
    .setMediaMetadata(MediaMetadata.Builder().setTitle("Quran").setIsBrowsable(true).setIsPlayable(false)
      .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED).build()).build()

  fun children(parentId: String): List<MediaItem>? = if (parentId == "root") surahs.map(::row) else null
  fun item(mediaId: String): MediaItem? = surahs.firstOrNull { "surah:${it.id}" == mediaId }?.let(::row)

  fun search(query: String): List<MediaItem> {
    val q = fold(query)
    if (q.isBlank()) return emptyList()
    q.toIntOrNull()?.let { n -> surahs.firstOrNull { it.id == n }?.let { return listOf(row(it)) } }
    val scored = surahs.mapNotNull { s ->
      val names = listOf(fold(s.nameSimple), fold(s.nameEnglish), s.nameArabic)
      val score = when {
        names.any { it == q } -> 3
        names.any { it.startsWith(q) } -> 2
        names.any { it.contains(q) } -> 1
        else -> 0
      }
      if (score > 0) s to score else null
    }
    return scored.sortedWith(compareByDescending<Pair<Surah, Int>> { it.second }.thenBy { it.first.id }).map { row(it.first) }
  }

  private fun row(s: Surah): MediaItem = MediaItem.Builder().setMediaId("surah:${s.id}")
    .setMediaMetadata(MediaMetadata.Builder()
      .setTitle(s.nameSimple).setSubtitle("${s.nameArabic} · ${s.ayahCount} ayahs")
      .setArtworkUri(artworkUri).setIsBrowsable(false).setIsPlayable(true)
      .setMediaType(MediaMetadata.MEDIA_TYPE_AUDIO_BOOK_CHAPTER).build()).build()

  companion object {
    /** Lower-case, diacritics/apostrophes/hyphens/spaces/"al " removed — so "al kahf", "Al-Kahf", "alkahf" all match. */
    fun fold(s: String): String = Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD)
      .replace(Regex("\\p{M}+"), "").replace(Regex("^(al|an|as|ash|ar|at|ad|az)[ -]"), "")
      .replace(Regex("[^\\p{L}\\p{N}]"), "")
    fun parse(json: String, artworkUri: Uri? = null): CarLibrary {
      val arr = JSONArray(json)
      return CarLibrary((0 until arr.length()).map { i -> arr.getJSONObject(i).let {
        Surah(it.getInt("id"), it.getString("nameSimple"), it.getString("nameArabic"), it.getString("nameEnglish"), it.getInt("ayahCount")) } }, artworkUri)
    }
  }
}
```

  Note the test expects `search("al kahf")` → after `fold`, both query and `nameSimple` lose the `al` article; `search("yasin")` matches `fold("Ya-Sin") == "yasin"`. Unit tests run on the JVM: `MediaItem`/`MediaMetadata` are plain classes (no Android runtime) — if the test task complains about `android.net.Uri` stubs, add `testOptions { unitTests.returnDefaultValues = true }` to `build.gradle`.

- [ ] **Step 5: Implement `CarController.kt`**

```kotlin
package expo.modules.carmedia

import android.content.Context
import android.content.pm.PackageManager
import androidx.media3.session.MediaSession

/** Spec §5.3: who pressed decides what "next" means. Pure function + one Android adapter. */
object CarController {
  const val ANDROID_AUTO = "com.google.android.projection.gearhead"
  fun isCarPackage(packageName: String, hasMediaContentControl: Boolean): Boolean =
    packageName == ANDROID_AUTO || (hasMediaContentControl && packageName != "android" && !packageName.startsWith("com.android.bluetooth"))
  fun isCar(context: Context, controller: MediaSession.ControllerInfo): Boolean {
    val pkg = controller.packageName
    if (pkg == context.packageName) return false
    val granted = context.packageManager.checkPermission("android.permission.MEDIA_CONTENT_CONTROL", pkg) == PackageManager.PERMISSION_GRANTED
    return isCarPackage(pkg, granted)
  }
}
```

- [ ] **Step 6: Implement `EngineBooter.kt`** (pure, injectable — the test's constructor):

```kotlin
package expo.modules.carmedia

/**
 * Commands arrive from the session on whatever thread; the JS engine may not
 * exist yet (cold start from the car). Boot it once, queue until `engineReady`,
 * keep only the newest play request, and give up with the spec §7 message.
 */
class EngineBooter(
  private val boot: () -> Unit,
  private val deliver: (type: String, arg: Long?) -> Unit,
  private val error: (String) -> Unit,
  private val clock: () -> Long = { System.currentTimeMillis() },
  private val timeoutMs: Long = 10_000,
) {
  private var ready = false
  private var booting = false
  private var bootStartedAt = 0L
  private val queue = ArrayDeque<Pair<String, Long?>>()

  @Synchronized fun command(type: String, arg: Long?) {
    if (ready) { deliver(type, arg); return }
    if (type == "playSurah") queue.removeAll { it.first == "playSurah" }
    queue.addLast(type to arg)
    if (!booting) { booting = true; bootStartedAt = clock(); boot() }
  }
  @Synchronized fun engineReady() {
    ready = true; booting = false
    val pending = queue.toList(); queue.clear()
    pending.forEach { deliver(it.first, it.second) }
  }
  @Synchronized fun engineGone() { ready = false; booting = false; queue.clear() }
  /** Called periodically (the service posts it every second while booting). */
  @Synchronized fun tick() {
    if (booting && clock() - bootStartedAt > timeoutMs) { booting = false; queue.clear(); error("Open Quran on your phone") }
  }
}
```

- [ ] **Step 7: Implement `CarEngineService.kt`, `CarMediaProvider.kt`, `CarMediaInitProvider.kt`, `CarMediaModule.kt`**

```kotlin
// CarEngineService.kt — the spike's service, kept: foreground first, then the headless task.
package expo.modules.carmedia
import android.app.*; import android.content.Intent; import android.content.pm.ServiceInfo; import android.os.Build
import com.facebook.react.HeadlessJsTaskService; import com.facebook.react.bridge.Arguments; import com.facebook.react.jstasks.HeadlessJsTaskConfig

class CarEngineService : HeadlessJsTaskService() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val channelId = "expo_audio_channel"   // expo-audio's channel: one notification slot, no duplicate channel in Settings
    val nm = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(channelId) == null)
      nm.createNotificationChannel(NotificationChannel(channelId, channelId, NotificationManager.IMPORTANCE_LOW))
    val n = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, channelId) else @Suppress("DEPRECATION") Notification.Builder(this))
      .setSmallIcon(resources.getIdentifier("notification_icon", "drawable", packageName).takeIf { it != 0 } ?: android.R.drawable.ic_media_play)
      .setContentTitle("Quran").setContentText("Starting…").build()
    if (Build.VERSION.SDK_INT >= 29) startForeground(4243, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK) else startForeground(4243, n)
    return super.onStartCommand(intent, flags, startId)
  }
  override fun getTaskConfig(intent: Intent?) = HeadlessJsTaskConfig("QuranCarEngine", Arguments.createMap(), 0 /* no timeout: lives while the engine does */, true)
}
```

```kotlin
// CarMediaProvider.kt — the CarLibraryProvider expo-audio calls; owns the library and the booter.
package expo.modules.carmedia
import android.content.Context; import android.content.Intent; import android.graphics.Bitmap; import android.graphics.BitmapFactory
import android.net.Uri; import android.os.Handler; import android.os.Looper
import androidx.media3.common.MediaItem; import androidx.media3.session.MediaSession
import expo.modules.audio.service.CarLibraryProvider; import expo.modules.audio.service.CarLibraryRegistry

class CarMediaProvider(private val context: Context) : CarLibraryProvider {
  private val library = CarLibrary.parse(context.assets.open("car-library.json").bufferedReader().readText(),
    Uri.parse("android.resource://${context.packageName}/drawable/car_artwork"))
  private val handler = Handler(Looper.getMainLooper())
  /** Set by CarMediaModule while JS is up; null when the JS runtime is gone. */
  @Volatile var jsSink: ((String, Long?) -> Unit)? = null
  val booter = EngineBooter(
    boot = { context.startForegroundService(Intent(context, CarEngineService::class.java)); scheduleTick() },
    deliver = { t, a -> jsSink?.invoke(t, a) },
    error = { msg -> CarLibraryRegistry.errorSink?.invoke(msg) })
  private fun scheduleTick() { handler.postDelayed({ booter.tick(); if (jsSink == null) scheduleTick() }, 1000) }

  override fun isCarController(controller: MediaSession.ControllerInfo) = CarController.isCar(context, controller)
  override fun root() = library.root()
  override fun children(parentId: String) = library.children(parentId)
  override fun item(mediaId: String) = library.item(mediaId)
  override fun search(query: String) = library.search(query)
  override fun onCommand(type: String, arg: Long?) = booter.command(type, arg)
  override fun artwork(): Bitmap? = BitmapFactory.decodeResource(context.resources, R.drawable.car_artwork)

  companion object { @Volatile var instance: CarMediaProvider? = null }
}
```

```kotlin
// CarMediaInitProvider.kt — runs at process start, before any controller can bind.
package expo.modules.carmedia
import android.content.ContentProvider; import android.content.ContentValues; import android.database.Cursor; import android.net.Uri
import expo.modules.audio.service.CarLibraryRegistry

class CarMediaInitProvider : ContentProvider() {
  override fun onCreate(): Boolean {
    val ctx = context ?: return false
    val provider = CarMediaProvider(ctx.applicationContext)
    CarMediaProvider.instance = provider
    CarLibraryRegistry.provider = provider
    return true
  }
  override fun query(u: Uri, p: Array<String>?, s: String?, a: Array<String>?, o: String?): Cursor? = null
  override fun getType(u: Uri): String? = null
  override fun insert(u: Uri, v: ContentValues?): Uri? = null
  override fun delete(u: Uri, s: String?, a: Array<String>?) = 0
  override fun update(u: Uri, v: ContentValues?, s: String?, a: Array<String>?) = 0
}
```

```kotlin
// CarMediaModule.kt — the JS face.
package expo.modules.carmedia
import androidx.media3.common.C
import expo.modules.audio.service.CarLibraryRegistry
import expo.modules.kotlin.modules.Module; import expo.modules.kotlin.modules.ModuleDefinition

class CarMediaModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CarMedia")
    Events("onCommand")
    OnCreate {
      CarMediaProvider.instance?.jsSink = { type, arg -> sendEvent("onCommand", mapOf("type" to type, "arg" to arg)) }
    }
    OnDestroy {
      CarMediaProvider.instance?.let { it.jsSink = null; it.booter.engineGone() }
      CarLibraryRegistry.positionOffsetMs = 0; CarLibraryRegistry.durationOverrideMs = C.TIME_UNSET
    }
    Function("engineReady") { CarMediaProvider.instance?.booter?.engineReady() }
    Function("setPosition") { offsetMs: Double, durationMs: Double ->
      CarLibraryRegistry.positionOffsetMs = offsetMs.toLong(); CarLibraryRegistry.durationOverrideMs = durationMs.toLong() }
    Function("clearPosition") { CarLibraryRegistry.positionOffsetMs = 0; CarLibraryRegistry.durationOverrideMs = C.TIME_UNSET }
    Function("setError") { message: String -> CarLibraryRegistry.errorSink?.invoke(message) }
  }
}
```

  JS wrapper `modules/car-media/src/index.ts`:

```ts
import { requireNativeModule, type EventSubscription } from 'expo-modules-core';
export type CarCommand =
  | { type: 'playSurah'; surahId: number } | { type: 'nextSurah' } | { type: 'prevSurah' }
  | { type: 'nextAyah' } | { type: 'prevAyah' } | { type: 'resume' } | { type: 'seekTo'; positionMs: number };
type Native = {
  engineReady(): void; setPosition(offsetMs: number, durationMs: number): void; clearPosition(): void; setError(message: string): void;
  addListener(event: 'onCommand', cb: (e: { type: string; arg: number | null }) => void): EventSubscription;
};
const native = requireNativeModule<Native>('CarMedia');
export const CarMedia = {
  engineReady: () => native.engineReady(),
  setPosition: (p: { positionOffsetMs: number; durationMs: number }) => native.setPosition(p.positionOffsetMs, p.durationMs),
  clearPosition: () => native.clearPosition(),
  setError: (message: string) => native.setError(message),
  addCommandListener(cb: (c: CarCommand) => void): EventSubscription {
    return native.addListener('onCommand', e => {
      switch (e.type) {
        case 'playSurah': if (e.arg !== null) cb({ type: 'playSurah', surahId: e.arg }); break;
        case 'seekTo': if (e.arg !== null) cb({ type: 'seekTo', positionMs: e.arg }); break;
        case 'nextSurah': case 'prevSurah': case 'nextAyah': case 'prevAyah': case 'resume': cb({ type: e.type }); break;
      }
    });
  },
};
```

- [ ] **Step 8: Run the Kotlin tests and compile the app**

Run: `cd apps/mobile/android && ./gradlew :car-media:testDebugUnitTest -q 2>&1 | tail -5 && ./gradlew :app:compileReleaseKotlin -q 2>&1 | grep -E "^e: |error:" | head`
Expected: tests pass (12), no compile errors.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/modules/car-media
git commit -m "feat(mobile): car-media module — browse tree, controller routing, headless engine boot, JS bridge"
```

---

### Task 6: JS car engine — commands in, now-playing/position/errors out, headless task

**Files:**
- Create: `apps/mobile/src/car/carEngine.ts`
- Modify: `apps/mobile/index.ts` (headless task + `registerCarEngine()`), `apps/mobile/App.tsx` (call `registerCarEngine()` once at module scope, next to `setAudioModeAsync`)
- Test: `apps/mobile/__tests__/carEngine.test.ts`, `apps/mobile/__tests__/helpers/fakeCarMedia.ts`

**Interfaces:**
- Consumes: Task 2's engine API; Task 5's `CarMedia` wrapper (`../../modules/car-media/src`).
- Produces: `registerCarEngine(): () => void` (idempotent; returns an unregister for tests).

- [ ] **Step 1: The fake native module**

```ts
// apps/mobile/__tests__/helpers/fakeCarMedia.ts
import { vi } from 'vitest';
type Listener = (e: { type: string; arg: number | null }) => void;
let listeners: Listener[] = [];
export const calls = { engineReady: 0, position: [] as { offsetMs: number; durationMs: number }[], cleared: 0, errors: [] as string[] };
export const fakeNative = {
  engineReady: vi.fn(() => { calls.engineReady++; }),
  setPosition: vi.fn((offsetMs: number, durationMs: number) => { calls.position.push({ offsetMs, durationMs }); }),
  clearPosition: vi.fn(() => { calls.cleared++; }),
  setError: vi.fn((m: string) => { calls.errors.push(m); }),
  addListener: vi.fn((_: string, cb: Listener) => { listeners.push(cb); return { remove: () => { listeners = listeners.filter(l => l !== cb); } }; }),
};
export function emitCommand(type: string, arg: number | null = null) { listeners.forEach(l => l({ type, arg })); }
export function resetCarMedia() { listeners = []; calls.engineReady = 0; calls.position = []; calls.cleared = 0; calls.errors = []; }
export const fakeExpoModulesCore = { requireNativeModule: () => fakeNative };
```

- [ ] **Step 2: Write the failing tests**

```ts
// apps/mobile/__tests__/carEngine.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native', async () => await import('./helpers/reactNativeMock'));
vi.mock('expo-file-system', async () => (await import('./helpers/fakeFileSystem')).fakeFileSystemModule);
vi.mock('expo-audio', async () => { const f = await import('./helpers/fakeAudio'); return { setAudioModeAsync: f.setAudioModeAsync, createAudioPlayer: f.createAudioPlayer }; });
vi.mock('../src/audio/expoPlayer', async () => { const f = await import('./helpers/fakeAudio'); return { createExpoPlayer: f.createExpoPlayer }; });
vi.mock('../src/audio/nowPlaying', async () => { const f = await import('./helpers/fakeAudio'); return { setNowPlaying: f.setNowPlaying, isNowPlaying: f.isNowPlaying }; });
vi.mock('expo-modules-core', async () => (await import('./helpers/fakeCarMedia')).fakeExpoModulesCore);
import { engine } from '../src/player/PlaybackEngine';
import { registerCarEngine } from '../src/car/carEngine';
import { resetPlayerEnvironment } from './helpers/renderPlayer';
import { provideTimings, failTimings } from './helpers/fakeTimings';
import { calls, emitCommand, resetCarMedia } from './helpers/fakeCarMedia';

const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
let unregister: () => void;
beforeEach(() => { resetPlayerEnvironment(); resetCarMedia(); provideTimings(1, 7); provideTimings(2, 5); provideTimings(3, 4); unregister = registerCarEngine(); });

describe('carEngine — commands drive the engine', () => {
  it('playSurah plays that surah from ayah 1', async () => {
    emitCommand('playSurah', 2); await settle();
    expect(engine.getState()).toMatchObject({ surahId: 2, ayah: 1, isPlaying: true });
  });
  it('nextSurah/prevSurah change surah; nextAyah/prevAyah change ayah', async () => {
    emitCommand('playSurah', 2); await settle();
    emitCommand('nextSurah'); await settle(); expect(engine.getState().surahId).toBe(3);
    emitCommand('nextAyah'); await settle(); expect(engine.getState()).toMatchObject({ surahId: 3, ayah: 2 });
    emitCommand('prevAyah'); await settle(); expect(engine.getState()).toMatchObject({ surahId: 3, ayah: 1 });
    emitCommand('prevSurah'); await settle(); expect(engine.getState().surahId).toBe(2);
  });
  it('resume plays the offer when nothing is live', async () => {
    emitCommand('resume'); await settle();
    expect(engine.getState()).toMatchObject({ surahId: 1, isPlaying: true });
  });
  it('seekTo maps a surah position to an ayah', async () => {
    emitCommand('playSurah', 1); await settle();
    const t = engine.currentTimings()!;
    emitCommand('seekTo', t.ayahs[4].startOffsetMs + 100); await settle();
    expect(engine.getState().ayah).toBe(t.ayahs[4].ayah);
  });
});

describe('carEngine — what it tells the car', () => {
  it('announces the engine once, on registration', () => { expect(calls.engineReady).toBe(1); });
  it('publishes the surah-level position offset and duration on every ayah', async () => {
    emitCommand('playSurah', 1); await settle();
    const t = engine.currentTimings()!;
    expect(calls.position.at(-1)).toEqual({ offsetMs: t.ayahs[0].startOffsetMs, durationMs: t.surahDurationMs });
    emitCommand('nextAyah'); await settle();
    expect(calls.position.at(-1)).toEqual({ offsetMs: t.ayahs[1].startOffsetMs, durationMs: t.surahDurationMs });
  });
  it('reports a surah that cannot be loaded with the spec\'s connection message', async () => {
    failTimings(3);
    emitCommand('playSurah', 3); await settle();
    expect(calls.errors).toEqual(['No connection — download this surah on your phone']);
  });
  it('registers once: a second call is a no-op and the first unregister undoes it', async () => {
    const again = registerCarEngine(); expect(calls.engineReady).toBe(1);
    again(); unregister();
    emitCommand('playSurah', 2); await settle();
    expect(engine.getState().surahId).toBe(1);
  });
});
```

- [ ] **Step 3: Run to verify they fail** — `cd apps/mobile && npx vitest run __tests__/carEngine.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement `src/car/carEngine.ts`**

```ts
import { engine } from '../player/PlaybackEngine';
import { CarMedia } from '../../modules/car-media/src';

/**
 * The car's view of the engine (spec §4): commands from the head unit become
 * engine calls; the engine's state becomes the seek bar's surah-level position
 * and, when a surah cannot start, the session error the car shows. Metadata
 * (title/subtitle/artwork) already flows through the lock-screen path — the
 * session is one and the same — so nothing is duplicated here.
 */
let active: (() => void) | null = null;

export function registerCarEngine(): () => void {
  if (active) return active;
  engine.start();
  const commands = CarMedia.addCommandListener(c => {
    switch (c.type) {
      case 'playSurah': void engine.play(c.surahId); break;
      case 'nextSurah': void engine.nextSurah(); break;
      case 'prevSurah': void engine.prevSurah(); break;
      case 'nextAyah': void engine.next(); break;
      case 'prevAyah': void engine.prev(); break;
      case 'resume': void engine.resume(); break;
      case 'seekTo': void engine.seekToSurahPosition(c.positionMs); break;
    }
  });
  let lastKey = '';
  let lastError: string | null = null;
  const unsubscribe = engine.subscribe(() => {
    const s = engine.getState();
    const t = engine.currentTimings();
    const index = engine.currentAyahIndex();
    if (t && index >= 0) {
      const key = `${s.surahId}:${index}`;
      if (key !== lastKey) { lastKey = key; CarMedia.setPosition({ positionOffsetMs: t.ayahs[index].startOffsetMs, durationMs: t.surahDurationMs }); }
    } else if (lastKey) { lastKey = ''; CarMedia.clearPosition(); }
    if (s.error && s.error !== lastError) CarMedia.setError('No connection — download this surah on your phone');
    lastError = s.error;
  });
  CarMedia.engineReady();
  active = () => { commands.remove(); unsubscribe(); CarMedia.clearPosition(); active = null; };
  return active;
}
```

- [ ] **Step 5: Wire the entry points**

  `apps/mobile/index.ts` — append:

```ts
import { AppRegistry } from 'react-native';
import { registerCarEngine } from './src/car/carEngine';
import { engine } from './src/player/PlaybackEngine';

// Started by CarEngineService when the car asks to play and no JS runtime
// exists (spec §4). Registers the car bridge and then lives as long as the
// engine has a surah; when it has been idle for ten minutes the task returns
// and Android may reclaim the process.
AppRegistry.registerHeadlessTask('QuranCarEngine', () => async () => {
  registerCarEngine();
  let idleSince = Date.now();
  for (;;) {
    await new Promise(r => setTimeout(r, 30_000));
    const s = engine.getState();
    if (s.isPlaying || s.isLoading) idleSince = Date.now();
    else if (Date.now() - idleSince > 10 * 60_000) return;
  }
});
```

  `apps/mobile/App.tsx` — next to `void setAudioModeAsync(...)` at module scope: `registerCarEngine();` (import from `./src/car/carEngine`). With the app open, commands from the car reach the same engine the screens use.

  Tests that render `App` (`__tests__/App.test.tsx`) need `vi.mock('../src/car/carEngine', () => ({ registerCarEngine: () => () => {} }))` — add it.

- [ ] **Step 6: Run the new tests, then the whole suite and typecheck**

Run: `cd apps/mobile && npx vitest run __tests__/carEngine.test.ts` → PASS. Then from the root `npm test` (≥ 350 + new) and `npm run typecheck` → 0.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/car/carEngine.ts apps/mobile/__tests__/carEngine.test.ts apps/mobile/__tests__/helpers/fakeCarMedia.ts apps/mobile/index.ts apps/mobile/App.tsx apps/mobile/__tests__/App.test.tsx
git commit -m "feat(mobile): the car drives PlaybackEngine — commands in, surah position and errors out, headless entry"
```

---

### Task 7: Manifest — `withCarMedia` config plugin

**Files:**
- Create: `apps/mobile/plugins/withCarMedia.js`
- Modify: `apps/mobile/app.json` (add `"./plugins/withCarMedia"` to `plugins`)
- Test: `apps/mobile/__tests__/withCarMedia.test.ts`

**Interfaces:**
- Produces: the merged manifest carries, on `expo.modules.audio.service.AudioControlsService`, intent filters for `androidx.media3.session.MediaLibraryService` and `android.media.browse.MediaBrowserService`; the `<application>` carries `<meta-data android:name="com.google.android.gms.car.application" android:resource="@xml/automotive_app_desc"/>`; `res/xml/automotive_app_desc.xml` exists with `<uses name="media"/>`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/__tests__/withCarMedia.test.ts
import { describe, expect, it } from 'vitest';
import { addCarMediaToManifest, AUTOMOTIVE_APP_DESC } from '../plugins/withCarMedia';

const manifest = () => ({ manifest: { application: [{ $: { 'android:name': '.MainApplication' },
  service: [{ $: { 'android:name': 'expo.modules.audio.service.AudioControlsService', 'android:exported': 'true' } }] }] } });

describe('withCarMedia', () => {
  it('adds the two browser intent filters to expo-audio\'s service, once', () => {
    const m = addCarMediaToManifest(addCarMediaToManifest(manifest()));
    const svc = m.manifest.application[0].service[0];
    const actions = svc['intent-filter'].flatMap((f: { action: { $: Record<string, string> }[] }) => f.action.map(a => a.$['android:name']));
    expect(actions).toEqual(['androidx.media3.session.MediaLibraryService', 'android.media.browse.MediaBrowserService']);
  });
  it('declares the car application descriptor once', () => {
    const m = addCarMediaToManifest(addCarMediaToManifest(manifest()));
    const meta = m.manifest.application[0]['meta-data'].filter((x: { $: Record<string, string> }) => x.$['android:name'] === 'com.google.android.gms.car.application');
    expect(meta).toHaveLength(1);
    expect(meta[0].$['android:resource']).toBe('@xml/automotive_app_desc');
  });
  it('the descriptor declares a media app', () => { expect(AUTOMOTIVE_APP_DESC).toContain('<uses name="media"/>'); });
  it('declares expo-audio\'s service itself when the app manifest has none (the library manifest is merged later by Gradle)', () => {
    const m = addCarMediaToManifest({ manifest: { application: [{ $: {}, service: [] }] } });
    const svc = m.manifest.application[0].service.find((x: { $: Record<string, string> }) => x.$['android:name'] === 'expo.modules.audio.service.AudioControlsService');
    expect(svc.$['android:exported']).toBe('true');
    expect(svc.$['android:foregroundServiceType']).toBe('mediaPlayback');
    expect(svc['intent-filter']).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → module not found.

- [ ] **Step 3: Implement the plugin**

```js
// apps/mobile/plugins/withCarMedia.js
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

const SERVICE = 'expo.modules.audio.service.AudioControlsService';
const ACTIONS = ['androidx.media3.session.MediaLibraryService', 'android.media.browse.MediaBrowserService'];
const AUTOMOTIVE_APP_DESC = `<?xml version="1.0" encoding="utf-8"?>
<automotiveApp>
  <uses name="media"/>
</automotiveApp>
`;

/**
 * Android Auto (and Automotive OS) find a media app by binding to a service
 * that answers the media-browser intents and by the car application
 * descriptor. The service is expo-audio's — patched into a
 * MediaLibraryService — so its declaration is edited here rather than owned
 * by a module. Idempotent: prebuild may run it over an already-modified tree.
 */
function addCarMediaToManifest(androidManifest) {
  const app = androidManifest.manifest.application[0];
  app.service = app.service ?? [];
  // expo-audio declares this service in ITS library manifest, which Gradle
  // merges later; declaring it here too (same name) lets the app add intent
  // filters — the merger unions the two declarations.
  let service = app.service.find(s => s.$['android:name'] === SERVICE);
  if (!service) {
    service = { $: { 'android:name': SERVICE, 'android:exported': 'true', 'android:foregroundServiceType': 'mediaPlayback' } };
    app.service.push(service);
  }
  service['intent-filter'] = service['intent-filter'] ?? [];
  for (const name of ACTIONS) {
    const present = service['intent-filter'].some(f => f.action?.some(a => a.$['android:name'] === name));
    if (!present) service['intent-filter'].push({ action: [{ $: { 'android:name': name } }] });
  }
  app['meta-data'] = app['meta-data'] ?? [];
  if (!app['meta-data'].some(m => m.$['android:name'] === 'com.google.android.gms.car.application')) {
    app['meta-data'].push({ $: { 'android:name': 'com.google.android.gms.car.application', 'android:resource': '@xml/automotive_app_desc' } });
  }
  return androidManifest;
}

function withCarMedia(config) {
  config = withAndroidManifest(config, c => { c.modResults = addCarMediaToManifest(c.modResults); return c; });
  return withDangerousMod(config, ['android', async c => {
    const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'automotive_app_desc.xml'), AUTOMOTIVE_APP_DESC);
    return c;
  }]);
}

module.exports = withCarMedia;
module.exports.addCarMediaToManifest = addCarMediaToManifest;
module.exports.AUTOMOTIVE_APP_DESC = AUTOMOTIVE_APP_DESC;
```

  Register in `app.json`: append `"./plugins/withCarMedia"` to `expo.plugins`.

- [ ] **Step 4: Run the tests** → PASS. Then `cd apps/mobile && CI=1 npx expo prebuild --platform android --no-install >/dev/null && grep -c "MediaBrowserService\|automotive_app_desc" android/app/src/main/AndroidManifest.xml && cat android/app/src/main/res/xml/automotive_app_desc.xml` → 2 hits and the descriptor.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/plugins/withCarMedia.js apps/mobile/__tests__/withCarMedia.test.ts apps/mobile/app.json
git commit -m "feat(mobile): manifest declares the media browser service and car descriptor (withCarMedia)"
```

---

### Task 8: Desktop Head Unit verification, release build, docs

**Files:**
- Modify: `apps/mobile/README.md` (new "Android Auto" section: how it works, DHU steps, the skip-semantics rule), `docs/DATA_SOURCES.md` (car-library asset), root `README.md` test counts.
- No product code changes in this task; failures are reported to the controller with logs.

- [ ] **Step 1: Install the DHU** (once): `sdkmanager --install "extras;google;auto"` (or Android Studio → SDK Manager → SDK Tools → Android Auto Desktop Head Unit Emulator). Binary: `$ANDROID_HOME/extras/google/auto/desktop-head-unit`.

- [ ] **Step 2: Phone side** — Android Auto app → Settings → tap "Version" 10× → Developer settings → "Start head unit server"; enable "Unknown sources" (needed for a sideloaded media app). Then `adb -s R58N80HYTXT forward tcp:5277 tcp:5277`.

- [ ] **Step 3: Build and install the release APK** — `cd apps/mobile && CI=1 npx expo prebuild --platform android --no-install && cd android && ./gradlew assembleRelease -q && adb -s R58N80HYTXT install -r app/build/outputs/apk/release/app-release.apk`.

- [ ] **Step 4: Run the DHU** — `$ANDROID_HOME/extras/google/auto/desktop-head-unit` (its window is the car screen). Checklist, each recorded PASS/FAIL with a screenshot (`Cmd+Shift+4` on the DHU window, saved to the scratchpad) and, for failures, `adb -s R58N80HYTXT logcat -d | grep -E "CarMedia|CarEngine|QuranCarEngine|AudioControlsService|FATAL"`:
  1. **Cold start:** `adb shell am force-stop com.umairnawaz.quran` → on the DHU open Quran → the 114-surah list appears (browse needs no JS) → tap Al-Fatihah → spinner ≤ 4 s → plays; Now Playing shows `Al-Fatihah · الفاتحة` / `Ayah 1` / logo.
  2. **Skip semantics:** DHU next → surah 2 ayah 1; simultaneously on the phone's bar, next → ayah 2 of surah 2 (the car's Now Playing subtitle follows).
  3. **Seek bar:** drag to ~50 % → lands mid-surah on the matching ayah; the bar's total is the surah's duration.
  4. **Voice:** "play Al-Kahf in Quran" (DHU mic button, type the phrase in the voice dialog) → surah 18.
  5. **Auto-continue:** play surah 113 to its end → 114 starts, Now Playing updates.
  6. **Resume:** with nothing live (force-stop, then only press play on the DHU's Now Playing/"resume" chip) → the bookmark resumes.
  7. **Offline:** airplane mode on the phone, a downloaded surah plays; a non-downloaded one shows `No connection — download this surah on your phone`.
  8. **Unplug:** stop the head unit server → audio continues on the phone; the lock screen still controls it.
  9. **Nothing regressed on the phone:** lock-screen card, status-bar icon, word highlight in the reader, Settings all as before.

- [ ] **Step 5: Docs** — `apps/mobile/README.md` gains an "Android Auto" section: the engine/headless design in three sentences, the DHU steps above, the skip rule, `npm run build:car-library`; `docs/DATA_SOURCES.md` documents `car-library.json`; root `README.md` test counts to the live numbers (`npm test`).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/README.md docs/DATA_SOURCES.md README.md
git commit -m "docs: Android Auto — how the car drives the engine, DHU verification steps"
```
