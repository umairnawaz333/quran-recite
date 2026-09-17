'use client';

import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { usePlayer } from './usePlayer';

const SURAH_PATH = /^\/surah\/(\d+)\/?$/;

/**
 * Mirrors mobile's `FollowPlayingSurah` (App.tsx): when recitation runs on
 * from one surah into the next — the end of a surah, or "next" on its last
 * ayah — and the user was viewing the surah that just finished, the page
 * follows to the new one. If they were on the home page, or reading some
 * other surah, nothing navigates.
 *
 * Mounted once inside `PlayerProvider` in the root layout, alongside
 * `PlayerBar`, so it is unaffected by which page happens to be showing.
 */
export function FollowPlayingSurah() {
  // Destructure only the specific state field this needs, per this file's
  // neighbours: the provider's context value is rebuilt on every 250ms
  // tick, so depending on the whole player object here would re-run this
  // effect on that same cadence instead of only when the playing surah
  // actually changes.
  const { surahId } = usePlayer();
  const pathname = usePathname();
  const router = useRouter();
  const previous = useRef<number | null>(null);

  useEffect(() => {
    const prev = previous.current;
    previous.current = surahId;
    if (surahId === null || prev === null || prev === surahId) return;

    const match = SURAH_PATH.exec(pathname);
    const viewedSurahId = match ? Number(match[1]) : null;
    if (viewedSurahId === prev) router.push(`/surah/${surahId}`);
    // `pathname`/`router` are deliberately read, not depended on: this must
    // fire only when the PLAYING surah changes, never when navigation
    // itself does (which would also change `pathname`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surahId]);

  return null;
}
