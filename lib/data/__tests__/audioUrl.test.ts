import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const PATH = '/audio/abdulbasit-murattal/001001.mp3';

/**
 * The module reads the env var once at import time, so each case needs a
 * fresh module registry rather than just a changed variable.
 */
async function load(base?: string) {
  vi.resetModules();
  if (base === undefined) delete process.env.NEXT_PUBLIC_AUDIO_BASE_URL;
  else process.env.NEXT_PUBLIC_AUDIO_BASE_URL = base;
  return (await import('../audioUrl')).resolveAudioUrl;
}

describe('resolveAudioUrl', () => {
  const original = process.env.NEXT_PUBLIC_AUDIO_BASE_URL;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_AUDIO_BASE_URL;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_AUDIO_BASE_URL;
    else process.env.NEXT_PUBLIC_AUDIO_BASE_URL = original;
    vi.resetModules();
  });

  it('returns the path unchanged when no base URL is configured', async () => {
    const resolve = await load();
    expect(resolve(PATH)).toBe(PATH);
  });

  it('prefixes the base URL when one is configured', async () => {
    const resolve = await load('https://pub-abc123.r2.dev');
    expect(resolve(PATH)).toBe('https://pub-abc123.r2.dev/audio/abdulbasit-murattal/001001.mp3');
  });

  it('does not double up slashes when the base URL has a trailing one', async () => {
    const resolve = await load('https://pub-abc123.r2.dev/');
    expect(resolve(PATH)).toBe('https://pub-abc123.r2.dev/audio/abdulbasit-murattal/001001.mp3');
  });

  it('adds a slash when the stored path lacks one', async () => {
    const resolve = await load('https://pub-abc123.r2.dev');
    expect(resolve('audio/x.mp3')).toBe('https://pub-abc123.r2.dev/audio/x.mp3');
  });

  it('leaves an already-absolute URL alone', async () => {
    const resolve = await load('https://pub-abc123.r2.dev');
    const absolute = 'https://example.com/audio/001001.mp3';
    expect(resolve(absolute)).toBe(absolute);
  });

  it('treats an empty or whitespace base URL as unset', async () => {
    expect((await load(''))(PATH)).toBe(PATH);
    expect((await load('   '))(PATH)).toBe(PATH);
  });
});
