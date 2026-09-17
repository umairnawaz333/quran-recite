import { describe, it, expect } from 'vitest';
import { surahAudioSize, allAudioSize, formatBytes } from '../src/offline/audioSizes';
import surahs from '@quran/data/surahs.json';

describe('audio size manifest', () => {
  it('has an entry for every surah, with file counts matching the ayah counts', () => {
    for (const s of surahs as { id: number; ayahCount: number }[]) {
      const size = surahAudioSize(s.id);
      expect(size.files, `surah ${s.id}`).toBe(s.ayahCount);
      expect(size.bytes).toBeGreaterThan(0);
    }
  });

  it('totals the whole recitation', () => {
    const all = allAudioSize();
    expect(all.files).toBe(6236);
    expect(all.bytes).toBeGreaterThan(2_000_000_000);
  });

  it('formats sizes the way the UI shows them', () => {
    expect(formatBytes(900_000)).toBe('0.9 MB');
    expect(formatBytes(222_000_000)).toBe('222 MB');
    expect(formatBytes(2_500_000_000)).toBe('2.5 GB');
    expect(formatBytes(0)).toBe('0 MB');
  });
});
