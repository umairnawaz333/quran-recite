import type { AudioMetadata } from 'expo-audio';
import type { SurahMeta } from '@quran/core';

/**
 * What the lock screen, the notification and — from Stage 3a — the car's
 * Now Playing card show for a surah: the one place these strings are built
 * (spec §2). One media session serves all three, so the wording cannot be
 * allowed to differ per driver — hence one function, not one per caller.
 *
 * `ayah` is the ayah now reciting, which is why every caller re-registers on
 * `ayahchange`: the subtitle follows the recitation rather than naming the
 * surah twice.
 */
export function lockScreenMeta(meta: SurahMeta, ayah: number): AudioMetadata {
  return {
    title: `${meta.nameSimple} · ${meta.nameArabic}`,
    artist: `Ayah ${ayah}`,
    albumTitle: 'AbdulBaset AbdulSamad · Murattal',
  };
}
