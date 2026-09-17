import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { PlayerProvider } from '../PlayerProvider';
import { usePlayer } from '../usePlayer';
import { primeTimings, resetTimingsCache } from '@quran/core';
import { writeLastPosition } from '@/lib/player/lastPosition';
import { WordRegistry } from '@/lib/reader/wordRegistry';
import { AyahPlaylist } from '@/lib/audio/playlist';
import type { SurahTimings } from '@quran/core';

const timings = (surah: number): SurahTimings => ({
  surah, reciterId: 'abdulbasit-murattal', surahDurationMs: 4000,
  ayahs: [
    { ayah: 1, audioUrl: `/audio/abdulbasit-murattal/${String(surah).padStart(3,'0')}001.mp3`,
      startOffsetMs: 0, durationMs: 4000,
      words: [
        { id: `${surah}:1:1`, position: 1, startMs: 600, endMs: 970, estimated: false },
        { id: `${surah}:1:2`, position: 2, startMs: 980, endMs: 1560, estimated: true },
      ] },
  ],
});

function Probe() {
  const p = usePlayer();
  return (
    <div>
      <span data-testid="surah">{p.surahId ?? 'none'}</span>
      <span data-testid="playing">{String(p.isPlaying)}</span>
      <span data-testid="loading">{String(p.isLoading)}</span>
      <button onClick={() => p.playSurah(2)}>play2</button>
      <button onClick={() => p.toggle()}>toggle</button>
    </div>
  );
}

beforeEach(() => {
  resetTimingsCache();
  localStorage.clear();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

const setup = () => render(<PlayerProvider><Probe /></PlayerProvider>);

describe('PlayerProvider', () => {
  it('starts with nothing playing', () => {
    setup();
    expect(screen.getByTestId('surah').textContent).toBe('none');
    expect(screen.getByTestId('playing').textContent).toBe('false');
  });

  it('loads a surah and begins playing', async () => {
    primeTimings(2, timings(2));
    setup();
    await act(async () => { screen.getByText('play2').click(); });
    await waitFor(() => expect(screen.getByTestId('surah').textContent).toBe('2'));
  });

  // The loading state must not clear until audio actually produces sound —
  // otherwise the button says "Pause" while nothing is playing, which is what
  // made highlighting look broken in Phase 1.
  it('stays loading until the audio element reports playing', async () => {
    primeTimings(2, timings(2));
    setup();
    await act(async () => { screen.getByText('play2').click(); });
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('true'));
  });

  it('writes the last position when the surah changes', async () => {
    primeTimings(2, timings(2));
    setup();
    await act(async () => { screen.getByText('play2').click(); });
    await waitFor(() => {
      const raw = localStorage.getItem('quran.lastPosition');
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw!).surahId).toBe(2);
    });
  });

  // The AyahPlaylist's own `isPlaying` flips true as soon as `play()` is
  // called, independent of the `loading`/`playing` DOM events that clear
  // `isLoading` — so pressing play then immediately pressing stop again on a
  // slow connection used to leave `isLoading` stuck true forever, with the
  // spinner spinning over silent, paused audio.
  it('pausing while still loading clears both the loading and playing state', async () => {
    primeTimings(2, timings(2));
    setup();
    await act(async () => { screen.getByText('play2').click(); });
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('true'));
    await waitFor(() => expect(screen.getByTestId('playing').textContent).toBe('true'));

    await act(async () => { screen.getByText('toggle').click(); });

    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('playing').textContent).toBe('false');
  });
});

describe('resume restore without a playlist', () => {
  // The restore effect sets `surahId`/`ayah` from storage on mount without
  // ever constructing a playlist. This block covers every control that used
  // to look live but silently do nothing in that state.

  function WordProbe() {
    const p = usePlayer();
    return (
      <div>
        <span data-testid="surah">{p.surahId ?? 'none'}</span>
        <span data-testid="ayah">{p.ayah}</span>
        <span data-testid="hasPlaylist">{String(p.hasPlaylist)}</span>
        <span data-testid="playing">{String(p.isPlaying)}</span>
        <button onClick={() => p.playWord('2:1:2')}>clickWord</button>
        <button onClick={p.next}>next</button>
        <button onClick={p.prev}>prev</button>
      </div>
    );
  }

  it('clicking a word after a restore (no playlist) starts playback at that word', async () => {
    writeLastPosition({ surahId: 2, ayah: 1, localMs: 0 });
    primeTimings(2, timings(2));
    const seekSpy = vi.spyOn(AyahPlaylist.prototype, 'seekToAyah');

    try {
      render(<PlayerProvider><WordProbe /></PlayerProvider>);

      // Restore effect has run: surahId is set from storage, but nothing was
      // ever built — this is exactly the state that left word clicks dead.
      await waitFor(() => expect(screen.getByTestId('surah').textContent).toBe('2'));
      expect(screen.getByTestId('hasPlaylist').textContent).toBe('false');

      await act(async () => { screen.getByText('clickWord').click(); });

      await waitFor(() => expect(screen.getByTestId('hasPlaylist').textContent).toBe('true'));
      await waitFor(() => expect(screen.getByTestId('playing').textContent).toBe('true'));

      // Word `2:1:2` starts at 980ms — it must land there, not just at the
      // ayah's start (0ms), which is what "starts playback at that word"
      // means as opposed to merely starting the surah.
      expect(seekSpy).toHaveBeenCalledWith(0, 980);
    } finally {
      seekSpy.mockRestore();
    }
  });

  it('prev/next are safe no-ops when no playlist exists yet', async () => {
    writeLastPosition({ surahId: 2, ayah: 1, localMs: 0 });

    render(<PlayerProvider><WordProbe /></PlayerProvider>);
    await waitFor(() => expect(screen.getByTestId('surah').textContent).toBe('2'));
    expect(screen.getByTestId('hasPlaylist').textContent).toBe('false');

    expect(() => {
      act(() => { screen.getByText('next').click(); });
      act(() => { screen.getByText('prev').click(); });
    }).not.toThrow();

    // Nothing to advance through means the restored position must not
    // silently change.
    expect(screen.getByTestId('ayah').textContent).toBe('1');
    expect(screen.getByTestId('hasPlaylist').textContent).toBe('false');
  });
});

describe('registry attachment', () => {
  function AttachProbe({ surahId, registry }: { surahId: number; registry: WordRegistry }) {
    const p = usePlayer();
    return <button onClick={() => p.attachRegistry(surahId, registry)}>attach</button>;
  }

  it('paints only when the attached surah is the playing surah', async () => {
    primeTimings(2, timings(2));
    const wrong = new WordRegistry();
    const spy = vi.spyOn(wrong, 'setActive');

    render(
      <PlayerProvider>
        <Probe />
        <AttachProbe surahId={5} registry={wrong} />
      </PlayerProvider>,
    );

    await act(async () => { screen.getByText('attach').click(); });
    await act(async () => { screen.getByText('play2').click(); });
    await waitFor(() => expect(screen.getByTestId('surah').textContent).toBe('2'));

    // The mocked audio element's currentTime never advances past 0, so the
    // sync engine's active word is always null here — force at least one
    // real requestAnimationFrame tick so the engine actually emits before
    // asserting, otherwise this assertion would pass trivially whether or
    // not the guard exists (nothing would have been emitted yet).
    await act(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });

    // Surah 5's registry must never be touched while surah 2 plays.
    expect(spy).not.toHaveBeenCalled();
  });

  it('detaching leaves playback running', async () => {
    primeTimings(2, timings(2));
    const registry = new WordRegistry();
    let detach: (() => void) | undefined;

    function Attach() {
      const p = usePlayer();
      return <button onClick={() => { detach = p.attachRegistry(2, registry); }}>attach</button>;
    }

    render(<PlayerProvider><Probe /><Attach /></PlayerProvider>);
    await act(async () => { screen.getByText('play2').click(); });
    await act(async () => { screen.getByText('attach').click(); });
    await act(async () => { detach?.(); });

    expect(screen.getByTestId('surah').textContent).toBe('2');
  });
});

describe('surah-to-surah continuation', () => {
  // These tests need to trigger a real ayah-boundary end on the exact
  // `AyahPlaylist` instance the provider currently owns, without wiring up
  // real audio playback. `AyahPlaylist.prototype.play()` is called exactly
  // once per instance, synchronously, as soon as `playSurah` constructs it
  // (autoplay defaults to true) — spying on it, calling through to the real
  // implementation, is a reliable hook for capturing that instance the
  // moment it goes live. `handleEndedForTest()` is the class's own,
  // purpose-built way to simulate an ayah (and here, a whole surah) ending.
  let instances: AyahPlaylist[];
  let playSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    instances = [];
    const originalPlay = AyahPlaylist.prototype.play;
    playSpy = vi.spyOn(AyahPlaylist.prototype, 'play').mockImplementation(function (
      this: AyahPlaylist, ...args: unknown[]
    ) {
      if (!instances.includes(this)) instances.push(this);
      return (originalPlay as (...a: unknown[]) => void).apply(this, args);
    });
  });

  afterEach(() => { playSpy.mockRestore(); });

  const live = () => instances[instances.length - 1];

  function ContinuationProbe() {
    const p = usePlayer();
    return (
      <div>
        <span data-testid="surah">{p.surahId ?? 'none'}</span>
        <span data-testid="ayah">{p.ayah}</span>
        <span data-testid="playing">{String(p.isPlaying)}</span>
        <button onClick={() => { void p.playSurah(2); }}>play2</button>
        <button onClick={() => { void p.playSurah(113); }}>play113</button>
        <button onClick={() => { void p.playSurah(114); }}>play114</button>
        <button onClick={p.next}>next</button>
      </div>
    );
  }

  // Requirement 1: `ended` on the last ayah of surah N (N < 114) starts
  // surah N+1 from ayah 1 and keeps playing, rather than the previous
  // behaviour of just patching `isPlaying: false`.
  it('ended on the last ayah of a surah before 114 starts the next surah playing', async () => {
    primeTimings(2, timings(2));
    primeTimings(3, timings(3));
    render(<PlayerProvider><ContinuationProbe /></PlayerProvider>);

    await act(async () => { screen.getByText('play2').click(); });
    await waitFor(() => expect(screen.getByTestId('surah').textContent).toBe('2'));

    await act(async () => { live().handleEndedForTest(); });

    await waitFor(() => expect(screen.getByTestId('surah').textContent).toBe('3'));
    expect(screen.getByTestId('ayah').textContent).toBe('1');
    expect(screen.getByTestId('playing').textContent).toBe('true');
  });

  // Requirement 1's other half: 114 is the last surah, so ending it must
  // still stop rather than reach for a nonexistent surah 115. Without the
  // `surahId < 114` guard this would call `loadTimings(115)`, which is not
  // primed and would surface as a load error instead of a clean stop.
  it('ended on surah 114 stops instead of continuing past the last surah', async () => {
    primeTimings(114, timings(114));
    render(<PlayerProvider><ContinuationProbe /></PlayerProvider>);

    await act(async () => { screen.getByText('play114').click(); });
    await waitFor(() => expect(screen.getByTestId('surah').textContent).toBe('114'));

    await act(async () => { live().handleEndedForTest(); });

    expect(screen.getByTestId('surah').textContent).toBe('114');
    expect(screen.getByTestId('playing').textContent).toBe('false');
  });

  // Requirement 2: `next` on the last ayah of surah N (N < 114) moves to
  // surah N+1's first ayah, rather than the previous bare
  // `playlist.next()`, which would have nothing to advance to and stay put.
  it('next on the last ayah of a surah before 114 moves to the next surah', async () => {
    primeTimings(2, timings(2));
    primeTimings(3, timings(3));
    render(<PlayerProvider><ContinuationProbe /></PlayerProvider>);

    await act(async () => { screen.getByText('play2').click(); });
    await waitFor(() => expect(screen.getByTestId('surah').textContent).toBe('2'));

    await act(async () => { screen.getByText('next').click(); });

    await waitFor(() => expect(screen.getByTestId('surah').textContent).toBe('3'));
    expect(screen.getByTestId('ayah').textContent).toBe('1');
  });

  // `next` mid-surah must be unaffected by the boundary-crossing change
  // above: with more than one ayah left, it should still just advance
  // within the current surah rather than jumping ahead to the next one.
  it('next mid-surah still advances within the surah instead of jumping ahead', async () => {
    const twoAyahs = (surah: number): SurahTimings => ({
      surah, reciterId: 'abdulbasit-murattal', surahDurationMs: 8000,
      ayahs: [
        { ayah: 1, audioUrl: `/audio/abdulbasit-murattal/${String(surah).padStart(3, '0')}001.mp3`,
          startOffsetMs: 0, durationMs: 4000,
          words: [{ id: `${surah}:1:1`, position: 1, startMs: 600, endMs: 970, estimated: false }] },
        { ayah: 2, audioUrl: `/audio/abdulbasit-murattal/${String(surah).padStart(3, '0')}002.mp3`,
          startOffsetMs: 4000, durationMs: 4000,
          words: [{ id: `${surah}:2:1`, position: 1, startMs: 600, endMs: 970, estimated: false }] },
      ],
    });
    primeTimings(2, twoAyahs(2));
    render(<PlayerProvider><ContinuationProbe /></PlayerProvider>);

    await act(async () => { screen.getByText('play2').click(); });
    await waitFor(() => expect(screen.getByTestId('surah').textContent).toBe('2'));

    await act(async () => { screen.getByText('next').click(); });

    expect(screen.getByTestId('surah').textContent).toBe('2');
    await waitFor(() => expect(screen.getByTestId('ayah').textContent).toBe('2'));
  });
});

describe('request superseding', () => {
  function DualProbe() {
    const p = usePlayer();
    return (
      <div>
        <span data-testid="surah">{p.surahId ?? 'none'}</span>
        <span data-testid="error">{p.error ?? 'none'}</span>
        <button onClick={() => { void p.playSurah(3); }}>playA</button>
        <button onClick={() => { void p.playSurah(2); }}>playB</button>
      </div>
    );
  }

  // A slow, uncached load (surah 3) must not clobber a faster later request
  // (surah 2) that already became the live playlist by the time the slow
  // one resolves — otherwise the user ends up hearing whatever they
  // navigated away from. Surah 2 is primed (instant); surah 3 is left
  // uncached so `loadTimings` falls through to `fetch`, which this test
  // holds open deliberately until after surah 2 has already taken over.
  it('ignores a slow load that resolves after a faster later request', async () => {
    primeTimings(2, timings(2));

    let resolveA!: (value: Response) => void;
    const pending = new Promise<Response>(resolve => { resolveA = resolve; });
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((input: unknown) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.includes('/timings/abdulbasit-murattal/3.json')) return pending;
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    });

    try {
      render(<PlayerProvider><DualProbe /></PlayerProvider>);

      // Start A's slow load, then immediately request B — B is cached and
      // wins the race by resolving first.
      await act(async () => { screen.getByText('playA').click(); });
      await act(async () => { screen.getByText('playB').click(); });
      await waitFor(() => expect(screen.getByTestId('surah').textContent).toBe('2'));

      // A's fetch now resolves, long after B has become the live playlist.
      await act(async () => {
        resolveA(new Response(JSON.stringify(timings(3)), { status: 200 }));
        // Flush the rest of loadTimings' promise chain (res.json(), cache
        // set, and playSurah's own post-await guard check).
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      // The provider must still report surah 2 — A's stale resolution must
      // be a complete no-op, including not surfacing as an error.
      expect(fetchSpy).toHaveBeenCalled();
      expect(screen.getByTestId('surah').textContent).toBe('2');
      expect(screen.getByTestId('error').textContent).toBe('none');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
