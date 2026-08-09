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

  // Flat stores such as GitHub release assets have no directories, so the
  // stored path's prefix is dropped and the filename alone is appended.
  it('resolves to base URL plus filename, dropping the directory prefix', async () => {
    const resolve = await load('https://github.com/u/r/releases/download/audio-v1');
    expect(resolve(PATH)).toBe(
      'https://github.com/u/r/releases/download/audio-v1/001001.mp3',
    );
  });

  it('does not double up slashes when the base URL has a trailing one', async () => {
    const resolve = await load('https://example.com/assets/');
    expect(resolve(PATH)).toBe('https://example.com/assets/001001.mp3');
  });

  it('handles a bare filename with no directory', async () => {
    const resolve = await load('https://example.com/assets');
    expect(resolve('001001.mp3')).toBe('https://example.com/assets/001001.mp3');
  });

  it('keeps filenames globally unique across surahs', async () => {
    const resolve = await load('https://example.com/a');
    expect(resolve('/audio/abdulbasit-murattal/002286.mp3')).toBe(
      'https://example.com/a/002286.mp3',
    );
    expect(resolve('/audio/abdulbasit-murattal/114006.mp3')).toBe(
      'https://example.com/a/114006.mp3',
    );
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
