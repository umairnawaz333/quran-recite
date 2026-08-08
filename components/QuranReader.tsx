'use client';

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

export function QuranReader({
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
