'use client';

import { useState } from 'react';

export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

interface Props {
  valueMs: number;
  totalMs: number;
  onSeek: (ms: number) => void;
}

/**
 * Whole-surah scrub bar. The seek commits on release so that dragging across
 * ayah boundaries does not trigger a load for every intermediate position.
 */
export function ProgressBar({ valueMs, totalMs, onSeek }: Props) {
  const [dragMs, setDragMs] = useState<number | null>(null);
  const shown = dragMs ?? valueMs;

  const commit = () => {
    if (dragMs !== null) {
      onSeek(dragMs);
      setDragMs(null);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <span className="w-10 text-right text-xs tabular-nums text-neutral-500">
        {formatTime(shown)}
      </span>
      <input
        type="range"
        min={0}
        max={Math.max(totalMs, 1)}
        value={shown}
        aria-label="Seek within surah"
        onChange={e => setDragMs(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        className="h-1 flex-1 cursor-pointer appearance-none rounded bg-neutral-200 accent-amber-600"
      />
      <span className="w-10 text-xs tabular-nums text-neutral-500">
        {formatTime(totalMs)}
      </span>
    </div>
  );
}
