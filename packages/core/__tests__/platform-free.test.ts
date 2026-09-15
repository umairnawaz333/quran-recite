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
 *
 * Division of labour with `npm run typecheck` (`packages/core/tsconfig.json`
 * has no `dom` lib): tsc is the PRIMARY guard against undeclared DOM globals —
 * a bare reference like `typeof window` fails to compile there
 * (`TS2304: Cannot find name 'window'`) before this file ever runs. This scan
 * is the SECOND layer: it catches what tsc happily accepts — banned imports
 * (`react`, `react-dom`, `next`, `node:`) and DOM-typed property access, e.g.
 * `window.location`, which fails the assertion below even though `window`
 * alone would already have failed to compile.
 *
 * Because this scan reads raw source text, it does not distinguish code from
 * comments or string literals — a doc comment that spells out "localStorage"
 * to explain this very boundary trips it exactly like real usage would. That
 * is deliberate (see above), so when prose needs to name a banned identifier,
 * reword the prose (as `global.d.ts` and `lastPosition.ts` do) rather than
 * weakening a pattern here to let it through.
 *
 * Two dependencies this file's coverage relies on but does not itself make
 * obvious: `BANNED_IMPORTS` only matches `node:`-prefixed specifiers, so a
 * bare legacy import like `from 'fs'` slips past this scan entirely — it is
 * caught only by `tsc` (`TS2307: Cannot find module 'fs'`, since core's
 * tsconfig has no Node types). And the primary guard against undeclared DOM
 * globals (a bare `typeof window`) is the `tsc --noEmit -p
 * packages/core/tsconfig.json` leg of the root `typecheck` script, not this
 * file — remove that leg and this scan alone cannot catch it, since a bare
 * `window` with no following `.` matches none of `BANNED_GLOBALS` either.
 *
 * Verified probes, both since removed:
 *   - `const _probe = typeof window;` in src/data/audioUrl.ts fails
 *     `npm run typecheck` with `TS2304: Cannot find name 'window'` — it does
 *     NOT fail this file's DOM-global test (no `.` after `window`).
 *   - `const _probe = window.location;` in the same file fails this file's
 *     DOM-global test (`data/audioUrl.ts matches /\bwindow\./`) — and also
 *     fails at runtime under Vitest's `node` environment, since Node has no
 *     `window` either.
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
