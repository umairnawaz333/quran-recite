# Monorepo and Shared Core Extraction — Design Spec

**Date:** 2026-09-15
**Status:** Approved for planning
**Builds on:** Phase 1 and Phase 2, both shipped to `main`

---

## 1. Why this exists

The next goal is a React Native app for iOS and Android, with the web app
becoming secondary. Before any mobile code is written, the domain logic that
both platforms need has to live somewhere neither owns.

That logic already exists and is already platform-free — not by accident. The
Phase 1 spec required `lib/sync/` to import nothing from React, and named future
mobile support as the reason. This sub-project collects on that decision.

### What is actually portable

Measured against the current `main`, not estimated:

| Touches no platform API — moves to core | Touches a platform API — stays in web |
|---|---|
| `normalize/segments.ts` (157 loc) | `data/loaders.ts` — `node:fs` |
| `normalize/arabic.ts` (51) | `player/lastPosition.ts` — `localStorage` |
| `normalize/types.ts` (37) | `audio/playlist.ts` — `HTMLAudioElement` |
| `sync/timeline.ts` (80) | `reader/useAutoScroll.ts` — `document`, `window` |
| `sync/engine.ts` (98) | `reader/wordRegistry.ts` — `classList` |
| `data/types.ts` (46) | `data/surahIndex.ts` — imports JSON at build time |
| `data/audioUrl.ts` (45) | |
| `player/timingsLoader.ts` (46) | |

`sync/engine.ts` moves despite using `requestAnimationFrame`, which React Native
provides. It is the highest-value file to share: the rAF loop and binary-search
word lookup behave identically on both platforms.

`normalize/segments.ts` is the single most valuable file in the repository. It
encodes how Quran.com's timing data actually behaves — range segments covering
several words, words covered by no segment, and segments whose `endMs` precedes
their `startMs`. Across the full Quran it absorbs **86 upstream data defects**
(20 malformed segments, 66 uncovered words) and produces zero invalid timings.
It took four review rounds to reach that state. Rewriting it for a second
platform would mean rediscovering all of it.

---

## 2. Structure

```
quran-recite/
├── package.json          workspace root — no application code
├── packages/core/        platform-free domain logic
└── apps/web/             the existing Next.js app, moved wholesale
```

**npm workspaces. No Turborepo.** The repo is already on npm, and with two
packages Turbo's caching saves nothing. Adding it later is one config file, not
a migration.

**`packages/core` has zero runtime dependencies.** This is the property that
makes it consumable by Expo later, and it is enforced by a test rather than
assumed (§5).

### Core ships TypeScript source, not compiled output

`apps/web` consumes it through Next's `transpilePackages: ['@quran/core']`, and
Metro will consume the same source directly when the mobile app arrives.

The alternative — publishing compiled JS plus declaration files — would add a
build step between editing core and seeing the change, and introduces a failure
mode where `dist/` is stale relative to source. Source-only removes both.

`outputFileTracingRoot` is **not** needed: it governs server-bundle file tracing,
and this app is `output: 'export'`, which produces no server bundle.

---

## 3. What deliberately does not move

The six platform-coupled files stay in `apps/web`, and **no adapter interfaces
are invented for them in this sub-project.**

Designing an abstraction with exactly one implementor is guesswork. The seams
that look obvious now are unlikely to survive contact with the mobile versions:

- `wordRegistry` toggles CSS classes on DOM nodes. React Native has no DOM. The
  mobile equivalent is most likely a Reanimated shared value driving per-word
  styles on the UI thread — a different mechanism, not a different backend for
  the same one.
- `playlist` wraps two `HTMLAudioElement`s for gapless ayah transitions.
  `react-native-track-player` has a queue natively, so the double-buffering this
  class exists to provide may be unnecessary rather than reimplemented.

When sub-project B builds those paths, the interfaces can be designed against two
concrete implementations instead of one and a hypothesis.

### The one exception

`lib/player/lastPosition.ts` splits. Its validation — `isValidPosition` and the
`LastPosition` type — moves to core; its `localStorage` read/write stays in web.

This seam is real today, not speculative: both platforms need exactly this
validation, it is pure, and it took a fix round to get right after tests were
found that appeared to check `NaN` rejection but could not, because
`JSON.stringify` turns `NaN` into `null`. Losing that on the mobile side would
be a silent regression.

---

## 4. Deploy configuration — the actual risk

Vercel builds this project from the **repository root** today; the project has no
`rootDirectory` set. Moving the app to `apps/web` breaks that, and the deploy
pipeline only recently started working end to end.

Five coupled changes, any one of which fails as a broken deploy rather than a
failing test:

| Item | Change |
|---|---|
| Vercel project | Set `rootDirectory` to `apps/web` |
| `.vercelignore` | Paths become relative to `apps/web` |
| `.github/workflows/deploy.yml` | Install at root; Vercel steps run in `apps/web` |
| `vitest.config.ts` | One config per package |
| `playwright.config.ts` | `webServer` starts the web workspace |

The plan must re-verify the **live site**, not merely that the build succeeded.
A deploy that returns 200 while serving a broken page is the failure mode the
existing workflow verification was written to catch, and it applies here.

---

## 5. Verification

This extraction changes no behaviour, which makes it unusually verifiable.

**The existing 154 unit tests and 4 Playwright tests must pass unchanged.** If a
test needs editing to accommodate the move, that is evidence the move altered
semantics — a reason to stop, not to patch the test.

Two new permanent checks:

1. **Core stays platform-free.** A test asserting that no file under
   `packages/core` imports `react`, `next`, `node:*`, or references a DOM global.
   Without it, a careless import would pass CI and only fail later, inside a
   Metro bundle, where the cause is much harder to see.
2. **Core has no runtime dependencies.** Asserted against its `package.json`, so
   a dependency added for web convenience cannot silently become a mobile
   problem.

Tests move with the code they cover: `packages/core` runs its own suite,
`apps/web` runs the rest. Both must be runnable from the repo root in one
command, because a suite that is easy to skip gets skipped.

---

## 6. Out of scope

No Expo app. No mobile code. No adapter interfaces beyond `isValidPosition`. No
Turborepo. No ads, in-app purchases, translations, or offline support.

Behaviour is identical before and after. Only file locations change.

---

## 7. Where this sits in the mobile roadmap

| | Sub-project | Depends on |
|---|---|---|
| **A** | **This spec** — monorepo and core extraction | — |
| B | Mobile MVP: surah list, reader, audio, word highlighting | A |
| C | Offline audio on mobile | B |
| D | Translations and Urdu | B |
| E | Monetisation: AdMob and in-app purchases | B |

Decisions already taken for later sub-projects, recorded so they are not
relitigated: **Expo with Continuous Native Generation and EAS Build** (required
regardless, since track-player, AdMob and IAP are native modules), and **no
shared UI** — each platform keeps idiomatic components, because Arabic text
rendering differs enough between the DOM and React Native that a shared layer
would serve neither well.

### Offline works on mobile, unlike on web

Phase 2 dropped offline support because a service worker cannot read a
cross-origin response without CORS headers, and GitHub Releases sends none on
either hop.

**CORS is a browser security model and does not apply to React Native.** Its
`fetch` and `expo-file-system` use NSURLSession and OkHttp, which do not enforce
it. Sub-project C can therefore download from the existing GitHub Releases with
no CDN change and no proxy — the constraint that blocked the web simply is not
present.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Deploy breaks after the move | Five config changes enumerated in §4; the plan re-verifies the live site, not just the build |
| A test needs changing to pass | Treated as a stop signal, not a fix — behaviour must be identical |
| Core silently acquires a platform dependency | Asserted by test, not convention (§5) |
| Import churn across ~30 files | Mechanical `@/lib/*` → `@quran/core`; the type checker catches every miss |
| Speculative abstraction | Adapters deferred to B by design (§3) |

---

## 9. Definition of done

`packages/core` holds the portable domain logic with no runtime dependencies and
no platform imports. `apps/web` consumes it via `transpilePackages` and behaves
exactly as before: 154 unit tests and 4 browser tests passing unchanged, a clean
type check, a successful build, and the live site still serving all 114 surahs
with working audio after redeployment.
