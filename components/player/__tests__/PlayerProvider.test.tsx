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
