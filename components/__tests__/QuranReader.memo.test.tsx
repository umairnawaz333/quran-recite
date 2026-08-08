import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useCallback, useMemo, useState } from 'react';
import type { SurahText } from '@/lib/data/types';

const ayahBlockRenders = vi.fn();

// Wrap the real AyahBlock so we can count how many times it is actually
// invoked, without changing what it renders. If QuranReader's memo bites,
// a parent re-render that leaves QuranReader's props referentially
// unchanged must not call AyahBlock again at all.
vi.mock('../AyahBlock', async () => {
  const actual = await vi.importActual<typeof import('../AyahBlock')>('../AyahBlock');
  return {
    ...actual,
    AyahBlock: (props: Parameters<typeof actual.AyahBlock>[0]) => {
      ayahBlockRenders();
      return actual.AyahBlock(props);
    },
  };
});

const { QuranReader } = await import('../QuranReader');
const { WordRegistry } = await import('@/lib/reader/wordRegistry');

const text: SurahText = {
  surah: 1,
  ayahs: [
    { ayah: 1, words: [{ id: '1:1:1', position: 1, tajweed: 'بِسۡمِ', indopak: 'بِسۡمِ' }] },
    { ayah: 2, words: [{ id: '1:2:1', position: 1, tajweed: 'ٱلۡحَمۡدُ', indopak: 'اَلۡحَمۡدُ' }] },
  ],
};

function Harness() {
  const [tick, setTick] = useState(0);
  const registry = useMemo(() => new WordRegistry(), []);
  const onWordClick = useCallback(() => {}, []);
  const onAyahPlay = useCallback(() => {}, []);
  return (
    <div>
      <button onClick={() => setTick(t => t + 1)}>tick {tick}</button>
      <QuranReader
        text={text}
        script="tajweed"
        registry={registry}
        activeAyah={1}
        onWordClick={onWordClick}
        onAyahPlay={onAyahPlay}
      />
    </div>
  );
}

describe('QuranReader memoization', () => {
  it('does not reconcile AyahBlock when an unrelated ancestor re-renders with unchanged props', () => {
    const { getByRole } = render(<Harness />);
    expect(ayahBlockRenders).toHaveBeenCalledTimes(text.ayahs.length);
    ayahBlockRenders.mockClear();

    const button = getByRole('button', { name: /tick/i });
    fireEvent.click(button); // mimics SurahClient's 250ms tick: unrelated state changes
    fireEvent.click(button);
    fireEvent.click(button);

    expect(ayahBlockRenders).not.toHaveBeenCalled();
  });
});
