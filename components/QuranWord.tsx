'use client';

import { useCallback, type KeyboardEvent } from 'react';
import type { SurahWord } from '@quran/core';
import type { WordRegistry } from '@/lib/reader/wordRegistry';

export type Script = 'tajweed' | 'indopak';

interface Props {
  word: SurahWord;
  script: Script;
  registry: WordRegistry;
  onClick: (wordId: string) => void;
}

/**
 * Every attribute and handler here is shared by both scripts and must stay
 * that way — the two branches below differ ONLY in how the text is injected
 * (tajweed's <rule> markup needs dangerouslySetInnerHTML; IndoPak is plain
 * text as children). Keeping ref/role/tabIndex/onClick/onKeyDown in one
 * place means a fix like "Space activates a word" can't drift into being
 * applied to only one script again.
 */
export function QuranWord({ word, script, registry, onClick }: Props) {
  const ref = useCallback(
    (el: HTMLSpanElement | null) => registry.register(word.id, el),
    [registry, word.id],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    // Enter and Space both activate, per ARIA button semantics for role="button".
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick(word.id);
    }
  };

  const sharedProps = {
    ref,
    className: 'word',
    'data-word-id': word.id,
    role: 'button' as const,
    tabIndex: 0,
    onClick: () => onClick(word.id),
    onKeyDown: handleKeyDown,
  };

  // Tajweed text carries <rule> markup that must render as elements. This is
  // the only script where raw HTML is ever injected — IndoPak always renders
  // its text as plain children below.
  if (script === 'tajweed') {
    return <span {...sharedProps} dangerouslySetInnerHTML={{ __html: word.tajweed }} />;
  }

  return <span {...sharedProps}>{word.indopak}</span>;
}
