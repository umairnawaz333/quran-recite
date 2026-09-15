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
