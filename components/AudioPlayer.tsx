'use client';

import { ProgressBar } from './ProgressBar';
import {
  PlayIcon, PauseIcon, PrevIcon, NextIcon, SpinnerIcon, VolumeIcon,
} from './PlayerIcons';

/**
 * Shared button styling.
 *
 * Size is set explicitly rather than derived from padding around the icon —
 * padding-sized buttons take the shape of whatever glyph is inside them, which
 * is what made the play button an oval. `focus-visible` replaces the browser's
 * default ring: keyboard users still get a clear indicator, mouse users don't
 * get a stray outline after clicking.
 */
const BUTTON =
  'grid place-items-center rounded-full transition ' +
  'outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 ' +
  'active:scale-95 disabled:opacity-40 disabled:pointer-events-none';

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
 * Fixed player bar pinned to the bottom of the viewport, stacked above other
 * content via z-index. This component only controls its own position and
 * stacking order — it does not reserve layout space, so the consuming page
 * is responsible for padding its scrollable content (e.g. the Arabic text)
 * so this bar never covers it.
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

        <div className="flex items-center justify-between gap-3">
          <span className="w-24 shrink-0 truncate text-xs tabular-nums text-neutral-500">
            {ayahLabel}
          </span>

          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Previous ayah"
              onClick={onPrev}
              className={`${BUTTON} size-10 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900`}
            >
              <PrevIcon className="size-5" />
            </button>

            {/* Larger than its neighbours so the primary action reads first,
                and never resizes: the spinner shares the icons' 24×24 box. */}
            <button
              type="button"
              aria-label={isPlaying ? 'Pause' : 'Play'}
              onClick={onPlayPause}
              className={`${BUTTON} size-14 bg-neutral-900 text-white shadow-sm hover:bg-neutral-700`}
            >
              {isLoading ? (
                <SpinnerIcon className="size-6 animate-spin" />
              ) : isPlaying ? (
                <PauseIcon className="size-6" />
              ) : (
                <PlayIcon className="size-6" />
              )}
            </button>

            <button
              type="button"
              aria-label="Next ayah"
              onClick={onNext}
              className={`${BUTTON} size-10 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900`}
            >
              <NextIcon className="size-5" />
            </button>
          </div>

          <div className="flex w-24 shrink-0 items-center justify-end gap-1.5">
            <VolumeIcon className="size-4 shrink-0 text-neutral-400" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              aria-label="Volume"
              onChange={e => onVolumeChange(Number(e.target.value))}
              className="h-1 w-14 cursor-pointer appearance-none rounded-full bg-neutral-200 accent-neutral-900 outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
