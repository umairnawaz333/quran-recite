'use client';

import { ProgressBar } from './ProgressBar';

interface Props {
  isPlaying: boolean;
  currentMs: number;
  totalMs: number;
  ayahLabel: string;
  isLoading?: boolean;
  volume: number;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (ms: number) => void;
  onVolumeChange: (volume: number) => void;
}

/**
 * Fixed player bar pinned to the bottom of the viewport. On mobile it stays
 * reachable without covering the Arabic text, which scrolls independently
 * above it.
 */
export function AudioPlayer({
  isPlaying,
  currentMs,
  totalMs,
  ayahLabel,
  isLoading = false,
  volume,
  onPlayPause,
  onPrev,
  onNext,
  onSeek,
  onVolumeChange,
}: Props) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-3">
        <ProgressBar valueMs={currentMs} totalMs={totalMs} onSeek={onSeek} />

        <div className="flex items-center justify-between">
          <span className="w-24 truncate text-xs text-neutral-500">{ayahLabel}</span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous ayah"
              onClick={onPrev}
              className="rounded-full p-2 hover:bg-neutral-100"
            >
              ⏮
            </button>

            <button
              type="button"
              aria-label={isPlaying ? 'Pause' : 'Play'}
              onClick={onPlayPause}
              className="rounded-full bg-neutral-900 p-3 text-white hover:bg-neutral-700"
            >
              {isLoading ? '…' : isPlaying ? '⏸' : '▶'}
            </button>

            <button
              type="button"
              aria-label="Next ayah"
              onClick={onNext}
              className="rounded-full p-2 hover:bg-neutral-100"
            >
              ⏭
            </button>
          </div>

          <div className="flex w-24 justify-end">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              aria-label="Volume"
              onChange={e => onVolumeChange(Number(e.target.value))}
              className="h-1 w-16 cursor-pointer appearance-none rounded bg-neutral-200 accent-neutral-700"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
