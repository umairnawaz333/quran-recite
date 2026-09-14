# Monorepo and Shared Core Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the platform-free domain logic into `packages/core` and the Next.js app into `apps/web`, so a future React Native app and the existing web app share one implementation of the normalizer, sync engine and timeline.

**Architecture:** npm workspaces with two packages. `packages/core` ships TypeScript source with zero runtime dependencies; `apps/web` consumes it through Next's `transpilePackages`. Behaviour is identical before and after — only file locations change, which is what makes the existing 154 unit tests and 4 Playwright tests the correctness check for the whole plan.

**Tech Stack:** npm workspaces, TypeScript 5.9.3, Next.js 16.3.0 (`output: 'export'`), Vitest 4.1.10, Playwright 1.62, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-15-monorepo-core-extraction-design.md`

## Global Constraints

- **No behaviour changes.** If a test needs editing to pass, stop and report — that is evidence the move altered semantics.
- **`packages/core` has zero runtime dependencies** and imports nothing from `react`, `next`, `node:*`, or any DOM global (`document`, `window`, `localStorage`, `HTMLElement`, `Audio`).
- **Core ships TypeScript source**, not compiled output. No `dist/`, no build step for core.
- `apps/web` must set `transpilePackages: ['@quran/core']` — required for a workspace package shipping TS source.
- **Do NOT set `outputFileTracingRoot`.** It governs server-bundle tracing; this app is `output: 'export'` and has no server bundle.
- **Never `git add` anything under `public/audio/`** — 6,236 gitignored MP3s live there, served from GitHub Releases.
- Node 20+, npm. Package manager stays npm; **no Turborepo**.
- Existing baseline that must hold at every commit: **154 unit tests, 4 Playwright tests, `tsc --noEmit` clean, `npm run build` succeeds.**
- Per `AGENTS.md`: this Next.js version may differ from training data. Read the relevant guide under `node_modules/next/dist/docs/` before changing Next configuration.

### Current configuration, for reference

Root `package.json` is a single package named `quran-word-sync`, `"type": "module"`, with `next` 16.3.0, `react` 19.2.8, `react-dom` 19.2.8 as its only dependencies. `tsconfig.json` maps `"@/*"` to `["./*"]`. `vitest.config.ts` uses the jsdom environment with `environmentOptions.jsdom.url = 'http://localhost'` (required — jsdom exposes no `localStorage` without it), `globals: true`, `setupFiles: ['./vitest.setup.ts']`, and excludes `e2e/**`. Vercel builds from the **repository root**; the project has no `rootDirectory` set.

---

## File Structure

| Path | Responsibility |
|---|---|
| `package.json` (root) | Workspace definitions and delegating scripts. No app code. |
| `packages/core/package.json` | Name `@quran/core`, no `dependencies` field at all |
| `packages/core/src/normalize/` | `segments.ts`, `arabic.ts`, `types.ts` |
| `packages/core/src/sync/` | `engine.ts`, `timeline.ts` |
| `packages/core/src/data/` | `types.ts`, `audioUrl.ts` |
| `packages/core/src/player/` | `timingsLoader.ts`, `lastPosition.ts` (validation only) |
| `packages/core/src/index.ts` | Public surface — the only path web imports from |
| `packages/core/__tests__/platform-free.test.ts` | Guard: no platform imports, no dependencies |
| `apps/web/` | The current app, moved wholesale |
| `apps/web/lib/` | The six platform-coupled files that stay |

---

## Task 1: Workspace skeleton

Create the workspace without moving anything, so the move itself is isolated in Task 2.

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`
- Modify: `package.json` (root)

**Interfaces:**
- Consumes: nothing
- Produces: a resolvable `@quran/core` workspace package

- [ ] **Step 1: Add workspaces to the root package.json**

Add this key to the existing root `package.json`, keeping everything else as-is for now:

```json
"workspaces": ["packages/*", "apps/*"]
```

- [ ] **Step 2: Create the core package manifest**

Create `packages/core/package.json`. Note there is deliberately **no `dependencies` key** — a guard test in Task 5 asserts its absence:

```json
{
  "name": "@quran/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "5.9.3",
    "vitest": "4.1.10"
  }
}
```

- [ ] **Step 3: Create the core tsconfig**

Create `packages/core/tsconfig.json`. `lib` deliberately omits `dom` — that is the type-level half of "core is platform-free", so a stray `document` reference fails to compile:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*.ts", "__tests__/**/*.ts"]
}
```

- [ ] **Step 4: Create a placeholder entry point**

Create `packages/core/src/index.ts`:

```ts
// Public surface of @quran/core. Task 2 fills this in as modules move here.
export {};
```

- [ ] **Step 5: Install and confirm the workspace resolves**

Run: `npm install`
Run: `ls -d node_modules/@quran/core`
Expected: the path exists as a symlink into `packages/core`.

Run: `npm test`
Expected: still 154 passing — nothing has moved yet.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json packages/
git commit -m "chore: add npm workspaces and an empty @quran/core package"
```

---

## Task 2: Move the portable modules into core

**Files:**
- Move: eight source files plus their tests from `lib/` into `packages/core/src/`
- Modify: `packages/core/src/index.ts`, `lib/player/lastPosition.ts`

**Interfaces:**
- Consumes: the `@quran/core` package from Task 1
- Produces: `@quran/core` exporting —
  - `normalizeAyah(input: NormalizeInput): NormalizeResult`
  - `countBaseLetters(text: string): number`, `countRecitationWeight(text: string): number`, `stripPrivateUse(text: string): string`
  - `class Timeline`, `class SyncEngine`, `findActiveWordIndex(words, localMs): number`
  - `resolveAudioUrl(rawUrl: string): string`
  - `loadTimings(surahId): Promise<SurahTimings>`, `primeTimings(surahId, timings)`, `resetTimingsCache()`
  - `isValidPosition(value: unknown): value is LastPosition`
  - types: `RawSegment`, `NormalizeWord`, `WordTiming`, `NormalizeInput`, `NormalizeResult`, `SurahMeta`, `SurahWord`, `SurahText`, `AyahTiming`, `SurahTimings`, `LastPosition`

- [ ] **Step 1: Move the eight portable modules with git**

```bash
mkdir -p packages/core/src/{normalize,sync,data,player}
git mv lib/normalize/segments.ts      packages/core/src/normalize/segments.ts
git mv lib/normalize/arabic.ts        packages/core/src/normalize/arabic.ts
git mv lib/normalize/types.ts         packages/core/src/normalize/types.ts
git mv lib/sync/timeline.ts           packages/core/src/sync/timeline.ts
git mv lib/sync/engine.ts             packages/core/src/sync/engine.ts
git mv lib/data/types.ts              packages/core/src/data/types.ts
git mv lib/data/audioUrl.ts           packages/core/src/data/audioUrl.ts
git mv lib/player/timingsLoader.ts    packages/core/src/player/timingsLoader.ts
```

Use `git mv` so history follows the files — `git log --follow` must still reach the four review rounds that shaped `segments.ts`.

- [ ] **Step 2: Move their tests alongside**

```bash
mkdir -p packages/core/__tests__
git mv lib/normalize/__tests__/segments.test.ts   packages/core/__tests__/segments.test.ts
git mv lib/normalize/__tests__/arabic.test.ts     packages/core/__tests__/arabic.test.ts
git mv lib/sync/__tests__/timeline.test.ts        packages/core/__tests__/timeline.test.ts
git mv lib/sync/__tests__/engine.test.ts          packages/core/__tests__/engine.test.ts
git mv lib/data/__tests__/audioUrl.test.ts        packages/core/__tests__/audioUrl.test.ts
git mv lib/player/__tests__/timingsLoader.test.ts packages/core/__tests__/timingsLoader.test.ts
```

- [ ] **Step 3: Split the validation out of lastPosition**

Create `packages/core/src/player/lastPosition.ts` containing **only** the portable half — the type and its validator. Copy the existing `LastPosition` interface and `isValidPosition` function verbatim from `lib/player/lastPosition.ts`, including their comments. Keep the exact validation semantics: `surahId` and `ayah` must be integers (1–114, and ≥ 1 respectively), `localMs` finite and ≥ 0, `updatedAt` finite.

That integrality check exists because an earlier version accepted `ayah: 1.5`, which resolves to no ayah at all. The finiteness checks exist because three tests appeared to cover `NaN` rejection but could not — `JSON.stringify` turns `NaN` into `null`, so they never reached the guard. Do not relax either.

Then edit `lib/player/lastPosition.ts` to import them rather than redeclare:

```ts
import { isValidPosition, type LastPosition } from '@quran/core';

export type { LastPosition };
```

and delete its local copies of the interface and validator, keeping `readLastPosition`, `writeLastPosition` and `clearLastPosition` — they use `localStorage` and stay in web.

- [ ] **Step 4: Move the validation tests, leave the storage tests**

`lib/player/__tests__/lastPosition.test.ts` covers both halves. Split it:

- Move the `describe('isValidPosition', ...)` block — the direct-call tests using real `NaN` and `Infinity` — into `packages/core/__tests__/lastPosition.test.ts`, importing from `../src/player/lastPosition`.
- Leave every test that touches `localStorage` (round-trip, malformed JSON, storage throwing, the storage probe) in `apps/web`.

Both halves must keep passing. Do not drop a test in the split — the total count across both packages must be unchanged.

- [ ] **Step 5: Write the public surface**

Replace `packages/core/src/index.ts`:

```ts
/**
 * Public surface of @quran/core.
 *
 * Everything here is platform-free: no React, no Next, no node built-ins, no
 * DOM. That constraint is what lets a React Native app consume this package
 * unchanged, and it is enforced by __tests__/platform-free.test.ts rather than
 * by convention.
 */
export { normalizeAyah } from './normalize/segments';
export { countBaseLetters, countRecitationWeight, stripPrivateUse } from './normalize/arabic';
export type {
  RawSegment, NormalizeWord, WordTiming, NormalizeInput, NormalizeResult,
} from './normalize/types';

export { Timeline } from './sync/timeline';
export type { TimelinePosition } from './sync/timeline';
export { SyncEngine, findActiveWordIndex } from './sync/engine';
export type { ActiveWordListener, Unsubscribe } from './sync/engine';

export { resolveAudioUrl } from './data/audioUrl';
export type {
  SurahMeta, SurahWord, SurahText, AyahTiming, SurahTimings,
} from './data/types';

export { loadTimings, primeTimings, resetTimingsCache } from './player/timingsLoader';
export { isValidPosition } from './player/lastPosition';
export type { LastPosition } from './player/lastPosition';
```

If any named export above does not exist under that exact name, **do not invent it** — check the source file and report the discrepancy.

- [ ] **Step 6: Fix imports inside the moved files**

The moved files import each other by relative path, which still works, and some imported `@/lib/data/types`. Replace any `@/lib/...` import inside `packages/core/src/` with a relative path. Core must not depend on the web app's path alias.

Run: `npx tsc --noEmit -p packages/core/tsconfig.json`
Expected: clean. Any `document`/`window` error here means a non-portable file was moved by mistake — report rather than adding `dom` to `lib`.

- [ ] **Step 7: Point the web app at the package**

Across `app/`, `components/`, `lib/` and `scripts/`, replace imports of the moved modules with `@quran/core`. The current import sites are:

```
from '@/lib/data/types'        → from '@quran/core'   (12 occurrences)
from '@/lib/audio/playlist'    → unchanged (stays in web)
from '@/lib/sync/timeline'     → from '@quran/core'
from '@/lib/sync/engine'       → from '@quran/core'
from '@/lib/data/loaders'      → unchanged (stays in web)
```

Also update `scripts/fetch-quran-data.ts`, which imports `../lib/normalize/segments`, `../lib/normalize/types`, `../lib/normalize/arabic` and `../lib/data/types`.

Find every remaining reference:

```bash
grep -rn "lib/normalize\|lib/sync\|lib/data/types\|lib/data/audioUrl\|lib/player/timingsLoader" \
  app components lib scripts e2e --include=*.ts --include=*.tsx
```

Expected after the edit: no matches.

- [ ] **Step 8: Teach the root vitest config about core**

Core's tests now live outside the web app's tree. Add an alias so both suites resolve `@quran/core`, in `vitest.config.ts`:

```ts
resolve: {
  alias: {
    '@': path.resolve(import.meta.dirname, '.'),
    '@quran/core': path.resolve(import.meta.dirname, 'packages/core/src/index.ts'),
  },
},
```

and widen `include` so core's tests run:

```ts
include: ['**/__tests__/**/*.{test,spec}.{ts,tsx}', '**/*.{test,spec}.{ts,tsx}'],
```

- [ ] **Step 9: Verify nothing changed but locations**

Run: `npm test`
Expected: **154 passing**, exactly as before. A different number means a test was lost or duplicated in the move — find it before continuing.

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run build`
Expected: success, 117 static pages.

- [ ] **Step 10: Commit**

```bash
git add -A packages lib app components scripts vitest.config.ts
git commit -m "refactor: move platform-free domain logic into @quran/core"
```

---

## Task 3: Move the web app into apps/web

The riskiest task. Do it in one commit so a revert is clean.

**Files:**
- Move: `app/`, `components/`, `lib/`, `scripts/`, `public/`, `data/`, `e2e/`, and the app's config files into `apps/web/`
- Modify: root `package.json`, `apps/web/package.json`, `apps/web/next.config.ts`

**Interfaces:**
- Consumes: `@quran/core` from Task 2
- Produces: `apps/web` as a workspace package named `@quran/web`

- [ ] **Step 1: Move directories and config with git**

```bash
mkdir -p apps/web
for p in app components lib scripts public data e2e \
         next.config.ts tsconfig.json vitest.config.ts vitest.setup.ts \
         playwright.config.ts postcss.config.mjs next-env.d.ts .vercelignore; do
  git mv "$p" "apps/web/$p"
done
```

`docs/`, `.github/`, `.gitignore`, `LICENSE` and `README.md` stay at the repository root.

- [ ] **Step 2: Create the web package manifest**

Create `apps/web/package.json` by moving the app-specific parts out of the root manifest:

```json
{
  "name": "@quran/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "fetch:data": "tsx scripts/fetch-quran-data.ts",
    "fetch:fonts": "tsx scripts/fetch-fonts.ts"
  },
  "dependencies": {
    "@quran/core": "*",
    "next": "16.3.0",
    "react": "19.2.8",
    "react-dom": "19.2.8"
  },
  "devDependencies": {
    "@playwright/test": "^1.62.1",
    "@tailwindcss/postcss": "4.3.3",
    "@testing-library/dom": "10.4.1",
    "@testing-library/jest-dom": "7.0.0",
    "@testing-library/react": "16.3.2",
    "@testing-library/user-event": "14.6.3",
    "@types/node": "26.2.0",
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.4",
    "@vitejs/plugin-react": "6.0.5",
    "jsdom": "30.0.1",
    "playwright": "^1.62.1",
    "tailwindcss": "4.3.3",
    "tsx": "4.23.11",
    "typescript": "5.9.3",
    "vitest": "4.1.10"
  }
}
```

- [ ] **Step 3: Reduce the root manifest to a workspace root**

Replace the root `package.json` entirely:

```json
{
  "name": "quran-recite",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "dev": "npm run dev --workspace @quran/web",
    "build": "npm run build --workspace @quran/web",
    "test": "npm run test --workspaces --if-present",
    "test:e2e": "npm run test:e2e --workspace @quran/web",
    "fetch:data": "npm run fetch:data --workspace @quran/web",
    "fetch:fonts": "npm run fetch:fonts --workspace @quran/web"
  },
  "devDependencies": {
    "typescript": "5.9.3"
  }
}
```

`npm test` at the root now runs both packages' suites. That matters: a suite that is awkward to run from the root is a suite that gets skipped.

- [ ] **Step 4: Add transpilePackages to the web app**

A workspace package shipping TypeScript source must be transpiled by Next. In `apps/web/next.config.ts`:

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  // @quran/core ships TypeScript source rather than compiled output, so Next
  // has to compile it. Without this the build fails on the package's syntax.
  transpilePackages: ['@quran/core'],
};

export default nextConfig;
```

Do **not** add `outputFileTracingRoot`: it governs server-bundle file tracing, and `output: 'export'` produces no server bundle.

- [ ] **Step 5: Fix the vitest alias for the new depth**

`apps/web/vitest.config.ts` is now two levels below the repo root. Update the core alias:

```ts
'@quran/core': path.resolve(import.meta.dirname, '../../packages/core/src/index.ts'),
```

Leave the `'@'` alias pointing at `import.meta.dirname` — it still means the web app root.

Also narrow `include` back to the web app's own tests, since core now runs its own suite:

```ts
exclude: ['node_modules/**', '.next/**', 'out/**', 'e2e/**'],
```

- [ ] **Step 6: Give core its own vitest config**

Create `packages/core/vitest.config.ts`. Core needs no jsdom and no React plugin — it is platform-free, and using the node environment proves it:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/**/*.test.ts'],
  },
});
```

If a moved test fails under `node` because it expects a browser global, that test belonged to the web half — move it back rather than switching core to jsdom.

- [ ] **Step 7: Reinstall and verify everything**

```bash
rm -rf node_modules package-lock.json
npm install
```

Run each and confirm:

- `npm test` → **154 passing** across both workspaces
- `npx tsc --noEmit -p apps/web/tsconfig.json` → clean
- `npx tsc --noEmit -p packages/core/tsconfig.json` → clean
- `npm run build` → success, 117 static pages
- `npm run test:e2e` → 4 passing

If the build cannot find `@quran/core`, check `transpilePackages` (Step 4) before changing anything else.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: move the Next.js app into apps/web"
```

---

## Task 4: Repair the deploy pipeline

The build now lives two directories down. Vercel and the workflow both assume the repository root.

**Files:**
- Modify: `.github/workflows/deploy.yml`, `apps/web/.vercelignore`
- Change: the Vercel project's `rootDirectory` setting

**Interfaces:**
- Consumes: the `apps/web` layout from Task 3
- Produces: a working production deploy

- [ ] **Step 1: Point the Vercel project at apps/web**

The project currently has no `rootDirectory`, so it builds from the repository root. Set it:

```bash
curl -s -X PATCH \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rootDirectory":"apps/web"}' \
  "https://api.vercel.com/v9/projects/prj_NKgJCOYlNQ5dqLwQX7iJc4NKCMfp?teamId=team_lppTKjjSnSGn6jZhN0Rlnqr7" \
  | python3 -c "import json,sys;print('rootDirectory:',json.load(sys.stdin).get('rootDirectory'))"
```

Expected output: `rootDirectory: apps/web`

Ask the controller for `VERCEL_TOKEN` rather than searching for it; do not print it.

- [ ] **Step 2: Fix the ignore file's paths**

`apps/web/.vercelignore` is now interpreted relative to `apps/web`, so its entries need adjusting. Replace its contents:

Keep the existing explanatory comment verbatim and delete only the trailing block:

```
# Never part of a deployment.
.superpowers
docs
```

`.superpowers` and `docs` live at the repository root, which is now outside `apps/web`, so Vercel no longer sees them and the entries do nothing. `public/audio` still resolves correctly — it is `apps/web/public/audio` relative to the new root — so that line and its comment stay exactly as they are.

- [ ] **Step 3: Update the workflow to run the Vercel steps in apps/web**

In `.github/workflows/deploy.yml`, install and tests stay at the root — `npm ci` installs the whole workspace and `npm test` now runs both suites, which is what we want gating a deploy. The Vercel CLI steps must run where the project link lives.

Add this to **four** steps — `Link the Vercel project`, `Pull Vercel environment`, `Deploy`, and `Roll back a failed production deploy`:

```yaml
        working-directory: apps/web
```

The rollback step is easy to miss and matters most: `vercel rollback` needs the same `.vercel/project.json` the other steps use, and it only ever runs when a production deploy has already failed verification — precisely when a second failure is most costly.

The verification step stays at the root but reads `.vercel/.env.production.local`, which `vercel pull` now writes inside `apps/web`. Change that one line in its script:

```bash
env_file=apps/web/.vercel/.env.production.local
```

- [ ] **Step 4: Confirm the workflow file is still valid**

```bash
node -e "
const s=require('fs').readFileSync('.github/workflows/deploy.yml','utf8');
console.log('steps:', (s.match(/^      - name: /gm)||[]).length);
console.log('working-directory entries:', (s.match(/working-directory: apps\/web/g)||[]).length);
console.log('env_file line:', s.split('\n').find(l=>l.includes('env_file=')).trim());
"
```

Expected: 12 steps, 4 `working-directory` entries, and the `env_file` line pointing inside `apps/web`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy.yml apps/web/.vercelignore
git commit -m "ci: build from apps/web after the monorepo move"
```

- [ ] **Step 6: Deploy and verify the live site, not just the build**

```bash
git push origin HEAD:main
gh workflow run deploy.yml --repo umairnawaz333/quran-recite -f target=production
```

Wait for the run, then confirm against production:

```bash
SITE="https://quran-recite-eta.vercel.app"
curl -s -o /dev/null -w "home: %{http_code}\n" "$SITE/"
curl -s "$SITE/" | grep -o 'href="/surah/' | wc -l          # expect 114
curl -s "$SITE/surah/1/" | grep -o 'data-word-id' | wc -l   # expect 29
curl -s "$SITE/surah/2/" | grep -o 'data-ayah=' | wc -l     # expect 286
curl -sL -o /dev/null -w "audio: %{http_code}\n" \
  "https://github.com/umairnawaz333/quran-recite/releases/download/audio-001/001001.mp3"
```

Every number must match. A 200 on the home page alone is not sufficient evidence — a deploy that serves an empty shell also returns 200.

If the deploy fails, the workflow rolls back automatically. Report the failure with the log rather than pushing a fix blindly.

---

## Task 5: Guard tests keeping core portable

Without these, the constraint survives only as convention, and the failure surfaces much later inside a Metro bundle where the cause is hard to see.

**Files:**
- Create: `packages/core/__tests__/platform-free.test.ts`

**Interfaces:**
- Consumes: the `packages/core` layout
- Produces: two permanent invariants

- [ ] **Step 1: Write the failing test**

Create `packages/core/__tests__/platform-free.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * These two tests are the reason @quran/core can be consumed by a React Native
 * app unchanged. Enforced here rather than by convention, because a stray
 * import would otherwise pass CI and only fail later inside a Metro bundle,
 * where the cause is far harder to trace.
 *
 * Reading source as text is deliberate: importing the modules would not reveal
 * a type-only import, and the point is to catch the reference at all.
 */
const SRC = path.resolve(import.meta.dirname, '../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

const BANNED_IMPORTS = [
  /from\s+['"]react['"]/,
  /from\s+['"]react-dom/,
  /from\s+['"]next[/'"]/,
  /from\s+['"]node:/,
  /require\(\s*['"]node:/,
];

const BANNED_GLOBALS = [
  /\bdocument\./,
  /\bwindow\./,
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bHTMLElement\b/,
  /\bHTMLAudioElement\b/,
  /\bnew Audio\(/,
];

describe('@quran/core stays platform-free', () => {
  const files = sourceFiles(SRC);

  it('ships at least the modules it is supposed to', () => {
    // Guards against the suite passing vacuously if SRC were ever empty.
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it('imports nothing from react, next, or node built-ins', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of BANNED_IMPORTS) {
        if (pattern.test(text)) offenders.push(`${path.relative(SRC, file)} matches ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('references no DOM or browser-storage global', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of BANNED_GLOBALS) {
        if (pattern.test(text)) offenders.push(`${path.relative(SRC, file)} matches ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('declares no runtime dependencies', () => {
    const manifest = JSON.parse(
      readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8'),
    );
    expect(manifest.dependencies ?? {}).toEqual({});
    expect(manifest.peerDependencies ?? {}).toEqual({});
  });
});
```

- [ ] **Step 2: Run it and watch it pass, then prove it can fail**

Run: `npm test --workspace @quran/core`
Expected: 4 passing.

A guard that cannot fail is worthless, so verify it bites. Temporarily add this line to `packages/core/src/data/audioUrl.ts`:

```ts
const _probe = typeof window;
```

Run the suite again — the DOM-global test must fail. **Remove the line** and confirm the suite passes again. Record in your report that you did this.

- [ ] **Step 3: Commit**

```bash
git add packages/core/__tests__/platform-free.test.ts
git commit -m "test: assert @quran/core stays platform-free and dependency-free"
```

---

## Task 6: Update documentation

**Files:**
- Modify: `README.md`, `docs/DATA_SOURCES.md`

- [ ] **Step 1: Describe the new layout in the README**

Add a short section covering the workspace layout (`packages/core`, `apps/web`), what lives in core and why (it is consumed unchanged by a future React Native app), and the root commands: `npm run dev`, `npm test`, `npm run build`, `npm run test:e2e`.

Update any command or path the move invalidated. Check each before writing it — a README that does not survive a fresh clone is worse than none. Verify specifically that the "Running it" instructions still work from the repository root.

- [ ] **Step 2: Fix paths in DATA_SOURCES.md**

It refers to `scripts/fetch-quran-data.ts`, `public/timings/` and `public/audio/`, all of which now live under `apps/web/`. Update them.

- [ ] **Step 3: Verify and commit**

Run: `npm test` (154 passing), `npm run build` (success)

```bash
git add README.md docs/DATA_SOURCES.md
git commit -m "docs: describe the workspace layout"
```

---

## Self-Review

**Spec coverage.**

| Spec section | Task |
|---|---|
| §2 structure, npm workspaces, no Turbo | 1, 3 |
| §2 core ships TS source, `transpilePackages` | 1, 3 |
| §2 no `outputFileTracingRoot` | 3 (stated as a prohibition) |
| §3 what moves | 2 |
| §3 what stays, no speculative adapters | 2 (only the listed eight move) |
| §3 the `isValidPosition` exception | 2 |
| §4 five deploy changes | 3 (vitest, playwright), 4 (Vercel, ignore, workflow) |
| §5 tests pass unchanged | 2, 3 |
| §5 two guard tests | 5 |
| §6 out of scope | no task creates Expo, adapters, or Turbo |
| §9 definition of done | 4 (live verification), 5, 6 |

**Placeholder scan:** no TBDs, no "handle errors appropriately", no "similar to Task N" — each task carries its own code.

**Type consistency:** the export list in Task 2 Step 5 is the single declaration of core's surface; Tasks 3–6 consume it by package name only. `isValidPosition` and `LastPosition` keep the names they already have in `lib/player/lastPosition.ts`. The Vercel project and team ids in Task 4 match those used by the existing deploy workflow.

**One judgement call worth flagging:** Task 3 moves `playwright.config.ts` into `apps/web`, so `npm run test:e2e` is delegated from the root. Its `webServer` command is `npm run dev`, which resolves correctly inside the workspace — but if the e2e suite cannot start a server after the move, that is the first thing to check.
