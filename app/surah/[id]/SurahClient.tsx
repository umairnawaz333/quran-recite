'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { QuranReader } from '@/components/QuranReader';
import { AudioPlayer } from '@/components/AudioPlayer';
import { ScriptToggle } from '@/components/ScriptToggle';
import { JumpToAyahPill } from '@/components/JumpToAyahPill';
import type { Script } from '@/components/QuranWord';
import { WordRegistry } from '@/lib/reader/wordRegistry';
import { useAutoScroll } from '@/lib/reader/useAutoScroll';
import { AyahPlaylist } from '@/lib/audio/playlist';
import { SyncEngine } from '@/lib/sync/engine';
import { Timeline } from '@/lib/sync/timeline';
import type { SurahMeta, SurahText, SurahTimings } from '@/lib/data/types';

const SCRIPT_KEY = 'quran.script';

interface Props {
  meta: SurahMeta;
  text: SurahText;
  timings: SurahTimings;
}

export function SurahClient({ meta, text, timings }: Props) {
  const registry = useMemo(() => new WordRegistry(), []);
  const timeline = useMemo(() => new Timeline(timings.ayahs), [timings]);

  const playlistRef = useRef<AyahPlaylist | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);

  const [script, setScript] = useState<Script>('tajweed');
  const [isPlaying, setPlaying] = useState(false);
  const [isLoading, setLoading] = useState(false);
  const [ayahIndex, setAyahIndex] = useState(0);
  const [currentMs, setCurrentMs] = useState(0);
  const [totalMs, setTotalMs] = useState(timeline.totalMs);
  const [volume, setVolume] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const activeAyah = timings.ayahs[ayahIndex]?.ayah ?? 1;
  const { suspended, resume } = useAutoScroll(activeAyah, isPlaying);

  // Restore the saved script choice.
  useEffect(() => {
    const saved = window.localStorage.getItem(SCRIPT_KEY);
    if (saved === 'tajweed' || saved === 'indopak') setScript(saved);
  }, []);

  const changeScript = useCallback((next: Script) => {
    setScript(next);
    window.localStorage.setItem(SCRIPT_KEY, next);
  }, []);

  // Build the playlist and sync engine once.
  useEffect(() => {
    const playlist = new AyahPlaylist(timings.ayahs);
    const engine = new SyncEngine();
    playlistRef.current = playlist;
    engineRef.current = engine;

    const offs = [
      playlist.on('state', setPlaying),
      playlist.on('loading', setLoading),
      playlist.on('error', i => setError(
        `Unable to load the recitation for ayah ${timings.ayahs[i]?.ayah ?? i + 1}.`,
      )),
      playlist.on('ended', () => {
        registry.setActive(null, false);
        playlist.seekToAyah(0, 0);
        setAyahIndex(0);
      }),
      playlist.on('ayahchange', index => {
        setAyahIndex(index);
        engine.setWords(timings.ayahs[index]?.words ?? []);
        setError(null);
      }),
      playlist.on('duration', (index, durationMs) => {
        timeline.setActualDuration(index, durationMs, playlist.currentAyahIndex);
        setTotalMs(timeline.totalMs);
      }),
      engine.onChange(wordId => {
        const words = timings.ayahs[playlist.currentAyahIndex]?.words ?? [];
        const word = words.find(w => w.id === wordId);
        registry.setActive(wordId, word?.estimated ?? false);
      }),
    ];

    engine.attach(() => playlist.localTimeMs(), timings.ayahs[0]?.words ?? []);

    // Deep-link: `?ayah=N` positions playback at that ayah and scrolls it
    // into view, without forcing playback to start.
    const requestedAyah = Number(new URLSearchParams(window.location.search).get('ayah'));
    if (Number.isFinite(requestedAyah)) {
      const targetIndex = timings.ayahs.findIndex(a => a.ayah === requestedAyah);
      if (targetIndex !== -1) {
        playlist.seekToAyah(targetIndex, 0);
        setAyahIndex(targetIndex);
        engine.setWords(timings.ayahs[targetIndex].words);
        const el = document.querySelector(`[data-ayah="${requestedAyah}"]`);
        el?.scrollIntoView({ block: 'center' });
      }
    }

    // Progress bar updates at a human rate; the highlight runs at frame rate.
    const ticker = window.setInterval(() => {
      setCurrentMs(
        timeline.localToGlobal(playlist.currentAyahIndex, playlist.localTimeMs()),
      );
    }, 250);

    return () => {
      window.clearInterval(ticker);
      offs.forEach(off => off());
      engine.detach();
      playlist.destroy();
      registry.clear();
    };
  }, [timings, timeline, registry]);

  useEffect(() => {
    const playlist = playlistRef.current;
    if (playlist) playlist.setVolume(volume);
  }, [volume, ayahIndex]);

  const togglePlay = useCallback(() => {
    const playlist = playlistRef.current;
    if (!playlist) return;
    if (playlist.isPlaying) playlist.pause();
    else playlist.play();
  }, []);

  // Space toggles playback unless the user is typing or on a control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const target = e.target as HTMLElement;
      if (target.closest('input, button, textarea, [role="button"]')) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay]);

  const handleWordClick = useCallback((wordId: string) => {
    const playlist = playlistRef.current;
    if (!playlist) return;
    const [, ayahStr] = wordId.split(':');
    const index = timings.ayahs.findIndex(a => a.ayah === Number(ayahStr));
    if (index === -1) return;
    const word = timings.ayahs[index].words.find(w => w.id === wordId);
    playlist.seekToAyah(index, word?.startMs ?? 0);
    setAyahIndex(index);
    engineRef.current?.setWords(timings.ayahs[index].words);
    playlist.play();
    resume();
  }, [timings, resume]);

  const handleAyahPlay = useCallback((ayah: number) => {
    const playlist = playlistRef.current;
    if (!playlist) return;
    const index = timings.ayahs.findIndex(a => a.ayah === ayah);
    if (index === -1) return;
    playlist.seekToAyah(index, 0);
    setAyahIndex(index);
    engineRef.current?.setWords(timings.ayahs[index].words);
    playlist.play();
    resume();
  }, [timings, resume]);

  const handleSeek = useCallback((globalMs: number) => {
    const playlist = playlistRef.current;
    if (!playlist) return;
    const { ayahIndex: index, localMs } = timeline.globalToLocal(globalMs);
    playlist.seekToAyah(index, localMs);
    setAyahIndex(index);
    engineRef.current?.setWords(timings.ayahs[index]?.words ?? []);
    setCurrentMs(globalMs);
  }, [timeline, timings]);

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

      {error && (
        <div role="alert" className="mx-auto mt-4 max-w-3xl px-4">
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}{' '}
            <button type="button" className="underline" onClick={togglePlay}>
              Try again
            </button>
          </div>
        </div>
      )}

      <QuranReader
        text={text}
        script={script}
        registry={registry}
        activeAyah={activeAyah}
        onWordClick={handleWordClick}
        onAyahPlay={handleAyahPlay}
      />

      <JumpToAyahPill visible={suspended && isPlaying} onClick={resume} />

      <AudioPlayer
        isPlaying={isPlaying}
        isLoading={isLoading}
        currentMs={currentMs}
        totalMs={totalMs}
        volume={volume}
        ayahLabel={`Ayah ${activeAyah} / ${meta.ayahCount}`}
        onPlayPause={togglePlay}
        onPrev={() => playlistRef.current?.prev()}
        onNext={() => playlistRef.current?.next()}
        onSeek={handleSeek}
        onVolumeChange={setVolume}
      />
    </main>
  );
}
