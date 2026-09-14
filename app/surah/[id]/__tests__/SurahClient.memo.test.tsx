import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import type { SurahMeta, SurahText, SurahTimings } from '@quran/core';

vi.mock('next/link', () => ({
  default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href}>{children}</a>
  ),
}));

const ayahBlockRenders = vi.fn();

// Same technique as components/__tests__/QuranReader.memo.test.tsx: wrap the
// real AyahBlock so we can count how many times it is actually invoked,
// without changing what it renders.
vi.mock('@/components/AyahBlock', async () => {
  const actual = await vi.importActual<typeof import('@/components/AyahBlock')>(
    '@/components/AyahBlock',
  );
  return {
    ...actual,
    AyahBlock: (props: Parameters<typeof actual.AyahBlock>[0]) => {
      ayahBlockRenders();
      return actual.AyahBlock(props);
    },
  };
});

const { SurahClient } = await import('../SurahClient');
const { PlayerProvider } = await import('@/components/player/PlayerProvider');
const { usePlayer } = await import('@/components/player/usePlayer');
const { resetTimingsCache } = await import('@quran/core');

const meta: SurahMeta = {
  id: 1, nameArabic: 'الفاتحة', nameSimple: 'Al-Fatihah', nameEnglish: 'The Opener',
  ayahCount: 2, revelationPlace: 'makkah', available: true,
};

const text: SurahText = {
  surah: 1,
  ayahs: [
    { ayah: 1, words: [{ id: '1:1:1', position: 1, tajweed: 'بِسۡمِ', indopak: 'بِسۡمِ' }] },
    { ayah: 2, words: [{ id: '1:2:1', position: 1, tajweed: 'ٱلۡحَمۡدُ', indopak: 'اَلۡحَمۡدُ' }] },
  ],
};

const timings: SurahTimings = {
  surah: 1, reciterId: 'abdulbasit-murattal', surahDurationMs: 16000,
  ayahs: [
    // Deliberately long: jsdom's mocked audio element never actually advances
    // currentTime, so an ayah boundary would only ever be crossed by an
    // explicit `ended` dispatch this test never sends — the duration here
    // exists only to document that a real ayah boundary is not in play.
    { ayah: 1, audioUrl: '/audio/abdulbasit-murattal/001001.mp3', startOffsetMs: 0, durationMs: 8000,
      words: [{ id: '1:1:1', position: 1, startMs: 0, endMs: 8000, estimated: false }] },
    { ayah: 2, audioUrl: '/audio/abdulbasit-murattal/001002.mp3', startOffsetMs: 8000, durationMs: 8000,
      words: [{ id: '1:2:1', position: 1, startMs: 0, endMs: 8000, estimated: false }] },
  ],
};

/** Exposes `isPlaying` for the test to wait on, without changing SurahClient itself. */
function Harness(props: { meta: SurahMeta; text: SurahText; timings: SurahTimings }) {
  const { isPlaying } = usePlayer();
  return (
    <>
      <span data-testid="playing">{String(isPlaying)}</span>
      <SurahClient {...props} />
    </>
  );
}

beforeEach(() => {
  resetTimingsCache();
  localStorage.clear();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  // jsdom does not implement scrollIntoView; useAutoScroll calls it whenever
  // the active ayah is on screen, same polyfill as
  // lib/reader/__tests__/useAutoScroll.test.tsx.
  Element.prototype.scrollIntoView = vi.fn();
  ayahBlockRenders.mockClear();
});

describe('SurahClient memoization under PlayerProvider', () => {
  // Regression test for the bug found while verifying Task 9 by hand:
  // handleWordClick/handleAyahPlay depended on the whole `player` context
  // value, which PlayerProvider rebuilds on every progress tick (every
  // 250ms while playing). Passed into QuranReader (wrapped in React.memo
  // specifically so its word tree does not reconcile on every tick), an
  // unstable callback prop defeats that memo — for Al-Baqarah's 6,116
  // words, several times a second. This asserts the memo actually holds
  // once those callbacks are pinned to the provider's stable action
  // references instead of the whole `player` object.
  it('does not reconcile AyahBlock on progress ticks once playback is running', async () => {
    render(
      <PlayerProvider>
        <Harness meta={meta} text={text} timings={timings} />
      </PlayerProvider>,
    );

    // Initial mount renders every ayah once.
    expect(ayahBlockRenders).toHaveBeenCalledTimes(text.ayahs.length);
    ayahBlockRenders.mockClear();

    // Starting playback legitimately changes props once (isThisSurahPlaying
    // flips, which handleWordClick/handleAyahPlay depend on) — that one
    // transition is not what this test is about, so it is excluded below.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play ayah 1' }));
    });
    await waitFor(() => expect(screen.getByTestId('playing').textContent).toBe('true'));
    ayahBlockRenders.mockClear();

    // Let several of the provider's 250ms progress ticks fire for real.
    // currentMs changes each time (a fresh state object, even if the
    // computed value repeats), which re-renders every context consumer,
    // including SurahClient — the memo is what must stop that from
    // cascading into AyahBlock.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 800));
    });

    expect(ayahBlockRenders).not.toHaveBeenCalled();
  });
});
