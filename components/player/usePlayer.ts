'use client';

import { createContext, useContext } from 'react';
import type { SurahTimings } from '@/lib/data/types';
import type { WordRegistry } from '@/lib/reader/wordRegistry';

export interface PlayerState {
  surahId: number | null;
  surahName: string | null;
  ayah: number;
  ayahIndex: number;
  totalAyahs: number;
  isPlaying: boolean;
  isLoading: boolean;
  currentMs: number;
  totalMs: number;
  volume: number;
  error: string | null;
  /**
   * Whether a live `AyahPlaylist` currently exists. `surahId` alone is not
   * enough to tell: the resume-restore effect sets `surahId` from storage
   * without ever constructing a playlist, so controls that operate on the
   * live playlist (prev/next) should gate on this, not on `surahId`.
   */
  hasPlaylist: boolean;
}

export interface PlayerActions {
  playSurah(surahId: number, opts?: { ayah?: number; localMs?: number; autoplay?: boolean }): Promise<void>;
  playWord(wordId: string): void;
  toggle(): void;
  next(): void;
  prev(): void;
  seek(globalMs: number): void;
  setVolume(volume: number): void;
  primeTimings(surahId: number, timings: SurahTimings): void;
  attachRegistry(surahId: number, registry: WordRegistry): () => void;
}

export type PlayerContextValue = PlayerState & PlayerActions;

export const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayer(): PlayerContextValue {
  const value = useContext(PlayerContext);
  if (!value) throw new Error('usePlayer must be used inside <PlayerProvider>');
  return value;
}
