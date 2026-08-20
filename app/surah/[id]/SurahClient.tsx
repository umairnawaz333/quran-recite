'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { QuranReader } from '@/components/QuranReader';
import { ScriptToggle } from '@/components/ScriptToggle';
import { JumpToAyahPill } from '@/components/JumpToAyahPill';
import type { Script } from '@/components/QuranWord';
import { WordRegistry } from '@/lib/reader/wordRegistry';
import { useAutoScroll } from '@/lib/reader/useAutoScroll';
import { usePlayer } from '@/components/player/usePlayer';
import type { SurahMeta, SurahText, SurahTimings } from '@/lib/data/types';

const SCRIPT_KEY = 'quran.script';

interface Props {
  meta: SurahMeta;
  text: SurahText;
  timings: SurahTimings;
}

export function SurahClient({ meta, text, timings }: Props) {
  const registry = useMemo(() => new WordRegistry(), []);
  const player = usePlayer();
  const [script, setScript] = useState<Script>('tajweed');

  const isThisSurahPlaying = player.surahId === meta.id;
  const activeAyah = isThisSurahPlaying ? player.ayah : 1;
  const { suspended, resume } = useAutoScroll(activeAyah, isThisSurahPlaying && player.isPlaying);

  useEffect(() => {
    const saved = window.localStorage.getItem(SCRIPT_KEY);
    if (saved === 'tajweed' || saved === 'indopak') setScript(saved);
  }, []);

  const changeScript = useCallback((next: Script) => {
    setScript(next);
    window.localStorage.setItem(SCRIPT_KEY, next);
  }, []);

  // Hand our timings to the provider so pressing play costs no extra fetch.
  // Depend on the action itself (stable across renders), not the whole
  // `player` object, which is a fresh reference on every state tick — keying
  // off it would re-run this (harmlessly, but pointlessly) many times a second.
  const { primeTimings, attachRegistry } = player;
  useEffect(() => {
    primeTimings(meta.id, timings);
  }, [primeTimings, meta.id, timings]);

  // Register our DOM word map. The provider paints into it only while this
  // surah is the one playing. Must depend on the stable `attachRegistry`
  // action rather than `player`: the context value is rebuilt on every
  // playback tick, and keying this effect off it would detach and
  // `registry.clear()` the word map on every tick, permanently erasing the
  // DOM node map after the first re-run and leaving nothing to highlight.
  useEffect(() => {
    const detach = attachRegistry(meta.id, registry);
    return () => { detach(); registry.clear(); };
  }, [attachRegistry, meta.id, registry]);

  const handleWordClick = useCallback((wordId: string) => {
    if (isThisSurahPlaying) { player.playWord(wordId); resume(); return; }
    const [, ayahStr] = wordId.split(':');
    void player.playSurah(meta.id, { ayah: Number(ayahStr) }).then(resume);
  }, [player, meta.id, isThisSurahPlaying, resume]);

  const handleAyahPlay = useCallback((ayah: number) => {
    void player.playSurah(meta.id, { ayah }).then(resume);
  }, [player, meta.id, resume]);

  return (
    <main className="min-h-screen bg-white">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← All surahs
        </Link>
        <ScriptToggle script={script} onChange={changeScript} />
      </header>

      <div className="mx-auto max-w-3xl px-4 text-center">
        <h1 className="text-3xl">{meta.nameArabic}</h1>
        <p className="text-neutral-500">{meta.nameSimple} · {meta.nameEnglish}</p>
        <p className="mt-1 text-xs text-neutral-400">AbdulBaset AbdulSamad · Murattal</p>
      </div>

      <QuranReader
        text={text}
        script={script}
        registry={registry}
        activeAyah={activeAyah}
        onWordClick={handleWordClick}
        onAyahPlay={handleAyahPlay}
      />

      <JumpToAyahPill visible={suspended && isThisSurahPlaying && player.isPlaying} onClick={resume} />
    </main>
  );
}
