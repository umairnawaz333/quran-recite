'use client';

import Link from 'next/link';
import { usePlayer } from './usePlayer';
import { ProgressBar } from '@/components/ProgressBar';
import { PlayIcon, PauseIcon, PrevIcon, NextIcon, SpinnerIcon } from '@/components/PlayerIcons';

const BUTTON =
  'grid place-items-center rounded-full transition ' +
  'outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 ' +
  'active:scale-95';

/**
 * The player, visible on every page. It is also the resume affordance: when
 * nothing is playing but a previous position was saved, it shows that position
 * with a play button, which is why no separate "continue reading" card exists.
 */
export function PlayerBar() {
  const p = usePlayer();

  // Nothing has ever played and nothing was saved — show no chrome at all.
  if (p.surahId === null) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white/95 backdrop-blur">
      {p.error && (
        <div role="alert" className="bg-red-50 px-4 py-2 text-center text-sm text-red-800">
          {p.error}
        </div>
      )}

      <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-3">
        <ProgressBar valueMs={p.currentMs} totalMs={p.totalMs} onSeek={p.seek} />

        <div className="flex items-center justify-between gap-3">
          <Link
            href={`/surah/${p.surahId}`}
            className="min-w-0 flex-1 truncate text-sm text-neutral-700 hover:text-neutral-900"
          >
            <span className="font-medium">{p.surahName}</span>
            <span className="ml-2 text-neutral-400 tabular-nums">
              {p.ayah}{p.totalAyahs ? ` / ${p.totalAyahs}` : ''}
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <button type="button" aria-label="Previous ayah" onClick={p.prev}
              className={`${BUTTON} size-10 text-neutral-600 hover:bg-neutral-100`}>
              <PrevIcon className="size-5" />
            </button>

            <button
              type="button"
              aria-label={p.isLoading ? 'Loading' : p.isPlaying ? 'Pause' : 'Play'}
              onClick={p.toggle}
              className={`${BUTTON} size-14 bg-neutral-900 text-white shadow-sm hover:bg-neutral-700`}
            >
              {p.isLoading
                ? <SpinnerIcon className="size-6 animate-spin" />
                : p.isPlaying ? <PauseIcon className="size-6" /> : <PlayIcon className="size-6" />}
            </button>

            <button type="button" aria-label="Next ayah" onClick={p.next}
              className={`${BUTTON} size-10 text-neutral-600 hover:bg-neutral-100`}>
              <NextIcon className="size-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
