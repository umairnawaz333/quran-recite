import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { FollowPlayingSurah } from '../FollowPlayingSurah';
import { PlayerContext, type PlayerContextValue } from '../usePlayer';

const push = vi.fn();
let pathname = '/';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => pathname,
}));

const value = (over: Partial<PlayerContextValue> = {}): PlayerContextValue => ({
  surahId: null, surahName: null, ayah: 1, ayahIndex: 0, totalAyahs: 0,
  isPlaying: false, isLoading: false, currentMs: 0, totalMs: 0, volume: 1, error: null,
  hasPlaylist: false,
  playSurah: vi.fn(), playWord: vi.fn(), toggle: vi.fn(), next: vi.fn(), prev: vi.fn(),
  seek: vi.fn(), setVolume: vi.fn(), primeTimings: vi.fn(), attachRegistry: vi.fn(() => () => {}),
  ...over,
});

function renderFollow(surahId: number | null) {
  return render(
    <PlayerContext.Provider value={value({ surahId })}>
      <FollowPlayingSurah />
    </PlayerContext.Provider>,
  );
}

beforeEach(() => {
  push.mockClear();
  pathname = '/';
});

describe('FollowPlayingSurah', () => {
  // Requirement 3, the case that matters: the user is on the page for the
  // surah that just finished, so the page must follow to the new one.
  it('navigates to the new surah when the playing surah changes while viewing the one that just finished', () => {
    pathname = '/surah/2/';
    const { rerender } = renderFollow(2);

    rerender(
      <PlayerContext.Provider value={value({ surahId: 3 })}>
        <FollowPlayingSurah />
      </PlayerContext.Provider>,
    );

    expect(push).toHaveBeenCalledWith('/surah/3');
  });

  // Requirement 3's other half: on the home page, nothing should navigate
  // out from under the user just because playback moved on.
  it('does not navigate when the user is on the home page', () => {
    pathname = '/';
    const { rerender } = renderFollow(2);

    rerender(
      <PlayerContext.Provider value={value({ surahId: 3 })}>
        <FollowPlayingSurah />
      </PlayerContext.Provider>,
    );

    expect(push).not.toHaveBeenCalled();
  });

  // And the other case a plain "surahId changed" check would miss: the user
  // is reading some *other* surah than the one that just finished playing.
  it('does not navigate when the user is viewing a different surah than the one that just finished', () => {
    pathname = '/surah/99/';
    const { rerender } = renderFollow(2);

    rerender(
      <PlayerContext.Provider value={value({ surahId: 3 })}>
        <FollowPlayingSurah />
      </PlayerContext.Provider>,
    );

    expect(push).not.toHaveBeenCalled();
  });

  // The very first render must not treat "nothing playing yet" -> "surah 1
  // offered" as a transition to follow — there is no "surah that just
  // finished" to have been viewing yet.
  it('does not navigate on the initial mount', () => {
    pathname = '/surah/1/';
    renderFollow(1);
    expect(push).not.toHaveBeenCalled();
  });
});
