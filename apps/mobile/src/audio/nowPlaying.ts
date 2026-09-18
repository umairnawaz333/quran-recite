import { AppState } from 'react-native';
import type { AudioPlayer, AudioMetadata } from 'expo-audio';

/**
 * The player this app last handed to expo-audio as the lock-screen /
 * notification controller, i.e. the one Android's media session is bound to
 * and therefore the one its transport buttons act on.
 *
 * Module state rather than provider state because it mirrors something that
 * is itself process-global: expo-audio's playback service holds exactly one
 * `currentPlayer` for the whole app (see
 * `AudioControlsService.setPlayerOptions`). Keeping the mirror next to the
 * only function that moves it is what lets `setNowPlaying` tell "same
 * player, refresh its metadata" apart from "different player, move the
 * binding" — two calls with very different costs and risks (see below).
 */
let boundPlayer: AudioPlayer | null = null;

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
 *
 * Re-registering the *same* player is routed to `updateLockScreenMetadata`
 * instead, and that distinction matters a great deal on Android.
 * `setActiveForLockScreen` lands in `AudioControlsService.setPlayerOptions`,
 * which tears the `MediaSession` down and builds a new one; when the player
 * differs from the service's current one it goes further, through
 * `setActivePlayerInternal`, and re-promotes the playback service to the
 * foreground. `updateLockScreenMetadata` lands in `setPlayerMetadata`,
 * which does neither: it only re-posts the notification.
 *
 * That difference is why *moving* the binding is refused unless the app is
 * in the foreground. Releasing the `MediaSession` makes media3 drop the
 * playback service out of the foreground, and the `startForeground` that
 * `setActivePlayerInternal` then issues is rejected for a backgrounded app
 * — verified on Android 16 (API 37):
 *
 *   ActivityManager: Background started FGS: Disallowed [... uidState: SVC;
 *     BFGS denied: true; code:DENIED ...]
 *   ActivityManager: Service.startForeground() not allowed: service
 *     com.umairnawaz.quran/expo.modules.audio.service.AudioControlsService
 *
 * which leaves the service running but no longer in the foreground
 * (`dumpsys activity services` → `isForeground=false`) — i.e. it throws
 * away the very protection this registration exists to provide, and
 * freezes playback with it. Refreshing the metadata of the player already
 * bound is always safe, in any app state.
 */
export function setNowPlaying(player: AudioPlayer, metadata: AudioMetadata): void {
  if (player === boundPlayer) {
    player.updateLockScreenMetadata(metadata);
    return;
  }
  if (boundPlayer && AppState.currentState !== 'active') return;
  boundPlayer = player;
  player.setActiveForLockScreen(true, metadata);
}

/**
 * Whether Android's media session is currently bound to `player`.
 *
 * Only for describing the state, never for deciding to skip a
 * `setNowPlaying` — `setNowPlaying` does that itself.
 */
export function isNowPlaying(player: AudioPlayer): boolean {
  return player === boundPlayer;
}
