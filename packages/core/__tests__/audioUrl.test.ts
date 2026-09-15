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
  return (await import('../src/data/audioUrl')).resolveAudioUrl;
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

  // Audio is sharded one GitHub Release per surah because a release caps at
  // 1000 assets and the recitation has 6,236 files. The shard is derived from
  // the filename's 3-digit surah prefix.
  it('routes to the per-surah release derived from the filename', async () => {
    const resolve = await load('https://github.com/u/r/releases/download');
    expect(resolve(PATH)).toBe(
      'https://github.com/u/r/releases/download/audio-001/001001.mp3',
    );
  });

  it('shards each surah to its own release tag', async () => {
    const resolve = await load('https://example.com/d');
    expect(resolve('/audio/abdulbasit-murattal/002255.mp3'))
      .toBe('https://example.com/d/audio-002/002255.mp3');
    expect(resolve('/audio/abdulbasit-murattal/114006.mp3'))
      .toBe('https://example.com/d/audio-114/114006.mp3');
    expect(resolve('/audio/abdulbasit-murattal/009129.mp3'))
      .toBe('https://example.com/d/audio-009/009129.mp3');
  });

  it('does not double up slashes when the base URL has a trailing one', async () => {
    const resolve = await load('https://example.com/d/');
    expect(resolve(PATH)).toBe('https://example.com/d/audio-001/001001.mp3');
  });

  it('handles a bare filename with no directory', async () => {
    const resolve = await load('https://example.com/d');
    expect(resolve('003007.mp3')).toBe('https://example.com/d/audio-003/003007.mp3');
  });

  // Building a URL from a filename we cannot parse would be confidently wrong.
  it('falls back to the local path for an unrecognised filename', async () => {
    const resolve = await load('https://example.com/d');
    expect(resolve('/audio/x/notanayah.mp3')).toBe('/audio/x/notanayah.mp3');
    expect(resolve('/audio/x/12345.mp3')).toBe('/audio/x/12345.mp3');
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
