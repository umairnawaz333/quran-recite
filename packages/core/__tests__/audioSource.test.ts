import { describe, it, expect } from 'vitest';
import { resolveAyahSource } from '../src/data/audioSource';
import type { AyahTiming } from '../src/data/types';

const ayah: AyahTiming = {
  ayah: 1,
  audioUrl: '/audio/abdulbasit-murattal/001001.mp3',
  startOffsetMs: 0,
  durationMs: 5000,
  words: [],
};

describe('resolveAyahSource', () => {
  it('prefers a local file when one is given', () => {
    expect(resolveAyahSource(ayah, 'file:///data/surah-1/001001.mp3')).toEqual({
      uri: 'file:///data/surah-1/001001.mp3',
      local: true,
    });
  });

  it('falls back to the resolved remote url when there is no local file', () => {
    const got = resolveAyahSource(ayah, null);
    expect(got.local).toBe(false);
    // Whatever resolveAudioUrl produces for the stored path.
    expect(got.uri).toContain('001001.mp3');
  });

  it('treats an empty local path as absent rather than as a valid file', () => {
    expect(resolveAyahSource(ayah, '').local).toBe(false);
  });
});
