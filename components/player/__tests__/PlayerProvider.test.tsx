import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { PlayerProvider } from '../PlayerProvider';
import { usePlayer } from '../usePlayer';
import { primeTimings, resetTimingsCache } from '@/lib/player/timingsLoader';
import { WordRegistry } from '@/lib/reader/wordRegistry';
import type { SurahTimings } from '@/lib/data/types';

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
