import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { configureAudioBase, resolveAudioUrl } from '../src/data/audioUrl';

const PATH = '/audio/abdulbasit-murattal/001001.mp3';

describe('resolveAudioUrl', () => {
  beforeEach(() => {
    configureAudioBase(undefined);
  });

  afterEach(() => {
    configureAudioBase(undefined);
  });

  it('returns the path unchanged when no base URL is configured', () => {
    expect(resolveAudioUrl(PATH)).toBe(PATH);
  });

  // Audio is sharded one GitHub Release per surah because a release caps at
  // 1000 assets and the recitation has 6,236 files. The shard is derived from
  // the filename's 3-digit surah prefix.
  it('routes to the per-surah release derived from the filename', () => {
    configureAudioBase('https://github.com/u/r/releases/download');
    expect(resolveAudioUrl(PATH)).toBe(
      'https://github.com/u/r/releases/download/audio-001/001001.mp3',
    );
  });

  it('shards each surah to its own release tag', () => {
    configureAudioBase('https://example.com/d');
    expect(resolveAudioUrl('/audio/abdulbasit-murattal/002255.mp3'))
      .toBe('https://example.com/d/audio-002/002255.mp3');
    expect(resolveAudioUrl('/audio/abdulbasit-murattal/114006.mp3'))
      .toBe('https://example.com/d/audio-114/114006.mp3');
    expect(resolveAudioUrl('/audio/abdulbasit-murattal/009129.mp3'))
      .toBe('https://example.com/d/audio-009/009129.mp3');
  });

  it('does not double up slashes when the base URL has a trailing one', () => {
    configureAudioBase('https://example.com/d/');
    expect(resolveAudioUrl(PATH)).toBe('https://example.com/d/audio-001/001001.mp3');
  });

  it('handles a bare filename with no directory', () => {
    configureAudioBase('https://example.com/d');
    expect(resolveAudioUrl('003007.mp3')).toBe('https://example.com/d/audio-003/003007.mp3');
  });

  // Building a URL from a filename we cannot parse would be confidently wrong.
  it('falls back to the local path for an unrecognised filename', () => {
    configureAudioBase('https://example.com/d');
    expect(resolveAudioUrl('/audio/x/notanayah.mp3')).toBe('/audio/x/notanayah.mp3');
    expect(resolveAudioUrl('/audio/x/12345.mp3')).toBe('/audio/x/12345.mp3');
  });

  it('leaves an already-absolute URL alone', () => {
    configureAudioBase('https://pub-abc123.r2.dev');
    const absolute = 'https://example.com/audio/001001.mp3';
    expect(resolveAudioUrl(absolute)).toBe(absolute);
  });

  it('treats an empty or whitespace base URL as unset', () => {
    configureAudioBase('');
    expect(resolveAudioUrl(PATH)).toBe(PATH);
    configureAudioBase('   ');
    expect(resolveAudioUrl(PATH)).toBe(PATH);
  });

  it('strips a trailing slash from the configured base', () => {
    configureAudioBase('https://example.com/d///');
    expect(resolveAudioUrl(PATH)).toBe('https://example.com/d/audio-001/001001.mp3');
  });
});
