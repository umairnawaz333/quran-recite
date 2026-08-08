'use client';

import { memo } from 'react';
import { AyahBlock } from './AyahBlock';
import type { Script } from './QuranWord';
import type { SurahText } from '@/lib/data/types';
import type { WordRegistry } from '@/lib/reader/wordRegistry';

interface Props {
  text: SurahText;
  script: Script;
  registry: WordRegistry;
  activeAyah: number;
  onWordClick: (wordId: string) => void;
  onAyahPlay: (ayah: number) => void;
}

/**
 * Memoized so the 250ms progress-bar tick in SurahClient — which changes
 * unrelated state (currentMs) and re-renders SurahClient — does not cascade
 * into reconciling the entire word tree. All props here are referentially
 * stable across that tick, so React.memo's shallow comparison bails out and
 * this subtree (and everything under it, including AyahBlock/QuranWord) is
 * not called at all. See README.md "How it works" for the full picture.
 */
function QuranReaderComponent({
  text, script, registry, activeAyah, onWordClick, onAyahPlay,
}: Props) {
  return (
    <div className="mx-auto max-w-3xl pb-40">
      {text.ayahs.map(ayah => (
        <AyahBlock
          key={ayah.ayah}
          surah={text.surah}
          ayah={ayah.ayah}
          words={ayah.words}
          script={script}
          registry={registry}
          isActive={ayah.ayah === activeAyah}
          onWordClick={onWordClick}
          onAyahPlay={onAyahPlay}
        />
      ))}
    </div>
  );
}

export const QuranReader = memo(QuranReaderComponent);
