'use client';

import { QuranWord, type Script } from './QuranWord';
import type { SurahWord } from '@/lib/data/types';
import type { WordRegistry } from '@/lib/reader/wordRegistry';

interface Props {
  surah: number;
  ayah: number;
  words: SurahWord[];
  script: Script;
  registry: WordRegistry;
  isActive: boolean;
  onWordClick: (wordId: string) => void;
  onAyahPlay: (ayah: number) => void;
}

export function AyahBlock({
  surah, ayah, words, script, registry, isActive, onWordClick, onAyahPlay,
}: Props) {
  return (
    <div
      data-ayah={ayah}
      className={`rounded-xl px-3 py-5 transition-colors ${
        isActive ? 'bg-amber-50/60' : ''
      }`}
    >
      <div className={`quran-text script-${script}`}>
        {words.map(word => (
          <QuranWord
            key={word.id}
            word={word}
            script={script}
            registry={registry}
            onClick={onWordClick}
          />
        ))}
        <span className="mx-2 text-2xl text-neutral-400">
          ﴿{toArabicDigits(ayah)}﴾
        </span>
      </div>

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          aria-label={`Play ayah ${ayah}`}
          onClick={() => onAyahPlay(ayah)}
          className="rounded-full px-3 py-1 text-sm text-neutral-500 hover:bg-neutral-100"
        >
          ▶ {surah}:{ayah}
        </button>
      </div>
    </div>
  );
}

function toArabicDigits(n: number): string {
  return String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
}
