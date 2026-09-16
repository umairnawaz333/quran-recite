import type { AudioPlayer, AudioMetadata } from 'expo-audio';

/**
 * Activates `player` as the active lock-screen / notification media
 * controller, with the given metadata.
 *
 * This is a correctness requirement, not polish. Per expo-audio's installed
 * docs (see `AudioMode.shouldPlayInBackground` in
 * `node_modules/expo-audio/build/Audio.types.d.ts`): on Android, background
 * audio playback is killed by the OS after roughly three minutes unless a
 * player is registered active for lock-screen controls — an OS battery
 * limitation, not a library bug. Skip this call and playback will look
 * completely fine in every quick manual check, then silently die a few
 * minutes into any real background listening session. Do not delete this as
 * unused-looking cleanup.
 *
 * `interruptionMode: 'doNotMix'` must also be set via `setAudioModeAsync`
 * (done in `PlayerProvider`) — without it the OS may not associate the
 * lock-screen controls with this player at all.
 */
export function setNowPlaying(player: AudioPlayer, metadata: AudioMetadata): void {
  player.setActiveForLockScreen(true, metadata);
}
