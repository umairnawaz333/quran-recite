import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayerBar } from '../PlayerBar';
import { PlayerContext, type PlayerContextValue } from '../usePlayer';

const value = (over: Partial<PlayerContextValue> = {}): PlayerContextValue => ({
  surahId: null, surahName: null, ayah: 1, ayahIndex: 0, totalAyahs: 0,
  isPlaying: false, isLoading: false, currentMs: 0, totalMs: 0, volume: 1, error: null,
  playSurah: vi.fn(), playWord: vi.fn(), toggle: vi.fn(), next: vi.fn(), prev: vi.fn(),
  seek: vi.fn(), setVolume: vi.fn(), primeTimings: vi.fn(), attachRegistry: vi.fn(() => () => {}),
  ...over,
});

const renderBar = (over?: Partial<PlayerContextValue>) =>
  render(<PlayerContext.Provider value={value(over)}><PlayerBar /></PlayerContext.Provider>);

describe('PlayerBar', () => {
  it('renders nothing with no surah and no saved position', () => {
    const { container } = renderBar();
    expect(container.firstChild).toBeNull();
  });

  it('shows the surah and ayah once something is loaded', () => {
    renderBar({ surahId: 2, surahName: 'Al-Baqarah', ayah: 45, totalAyahs: 286 });
    expect(screen.getByText(/Al-Baqarah/)).toBeInTheDocument();
    expect(screen.getByText(/45/)).toBeInTheDocument();
  });

  it('offers play when paused and pause when playing', () => {
    renderBar({ surahId: 2, surahName: 'Al-Baqarah', isPlaying: false });
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
  });

  // The Phase 1 bug: the button claimed "Pause" while audio was still loading.
  it('shows a loading state rather than pause while audio loads', () => {
    renderBar({ surahId: 2, surahName: 'Al-Baqarah', isPlaying: true, isLoading: true });
    expect(screen.getByRole('button', { name: /loading/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^pause$/i })).toBeNull();
  });

  it('surfaces an error', () => {
    renderBar({ surahId: 2, surahName: 'Al-Baqarah', error: 'Unable to load this recitation.' });
    expect(screen.getByRole('alert')).toHaveTextContent(/unable to load/i);
  });

  it('links to the playing surah', () => {
    renderBar({ surahId: 36, surahName: 'Ya-Sin' });
    expect(screen.getByRole('link', { name: /Ya-Sin/ })).toHaveAttribute('href', '/surah/36');
  });
});
