import type { AyahTiming } from './types';
import { resolveAudioUrl } from './audioUrl';

/**
 * Where a given ayah's audio should be played from.
 *
 * This exists so playback never branches on whether a surah is downloaded:
 * the sequencer asks for a uri and gets one. Keeping the decision here rather
 * than in the app is what lets offline stay invisible to the player.
 */
export function resolveAyahSource(
  ayah: AyahTiming,
  localPath: string | null,
): { uri: string; local: boolean } {
  // An empty string is a missing path, not a valid file at the filesystem
  // root — treating it as present would hand the player an unplayable uri.
  if (localPath) return { uri: localPath, local: true };
  return { uri: resolveAudioUrl(ayah.audioUrl), local: false };
}
