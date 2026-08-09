'use client';

import { QuranWord, type Script } from './QuranWord';
import { PlayIcon } from './PlayerIcons';
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
          className="group flex items-center gap-1.5 rounded-full py-1 pl-1.5 pr-3 text-sm text-neutral-400 outline-none transition hover:bg-neutral-100 hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          <span className="grid size-6 place-items-center rounded-full bg-neutral-100 text-neutral-500 transition group-hover:bg-neutral-900 group-hover:text-white">
            <PlayIcon className="size-3" />
          </span>
          <span className="tabular-nums">{surah}:{ayah}</span>
        </button>
      </div>
    </div>
  );
}

function toArabicDigits(n: number): string {
  return String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
}
