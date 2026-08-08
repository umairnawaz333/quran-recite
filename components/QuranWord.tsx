'use client';

import { useCallback } from 'react';
import type { SurahWord } from '@/lib/data/types';
import type { WordRegistry } from '@/lib/reader/wordRegistry';

export type Script = 'tajweed' | 'indopak';

interface Props {
  word: SurahWord;
  script: Script;
  registry: WordRegistry;
  onClick: (wordId: string) => void;
}

export function QuranWord({ word, script, registry, onClick }: Props) {
  const ref = useCallback(
    (el: HTMLSpanElement | null) => registry.register(word.id, el),
    [registry, word.id],
  );

  // Tajweed text carries <rule> markup that must render as elements.
  if (script === 'tajweed') {
    return (
      <span
        ref={ref}
        className="word"
        data-word-id={word.id}
        role="button"
        tabIndex={0}
        onClick={() => onClick(word.id)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick(word.id);
          }
        }}
        dangerouslySetInnerHTML={{ __html: word.tajweed }}
      />
    );
  }

  return (
    <span
      ref={ref}
      className="word"
      data-word-id={word.id}
      role="button"
      tabIndex={0}
      onClick={() => onClick(word.id)}
      onKeyDown={e => { if (e.key === 'Enter') onClick(word.id); }}
    >
      {word.indopak}
    </span>
  );
}
