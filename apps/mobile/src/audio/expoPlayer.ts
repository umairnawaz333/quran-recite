import { createAudioPlayer } from 'expo-audio';
import type { AudioPlayer, AudioStatus } from 'expo-audio';
import type { PlayerHandle } from './types';

/**
 * `PlayerHandle` implemented over `expo-audio`.
 *
 * The one fact that makes this whole feature work: `AudioPlayer.currentTime`
 * is a plain, synchronously readable number of seconds (not a promise, not a
 * periodic sample) — so `currentTimeMs` below needs no polling loop, buffer,
 * or extrapolation of its own. `SyncEngine` reads it straight off this
 * getter every animation frame, exactly as it reads `HTMLAudioElement`'s
 * `currentTime` on the web.
 *
 * expo-audio's own methods (`play`, `pause`, `replace`, `seekTo`) are mostly
 * fire-and-forget: the interesting state change arrives later on the
 * `playbackStatusUpdate` event as an `AudioStatus`. `load` and `play` are the
 * two calls `AyahSequencer` actually awaits, so both are turned into
 * promises that settle from that event stream — resolving once the status
 * confirms the source loaded / playback started, and rejecting on
 * `status.error`. That rejection is what lets a genuine playback failure
 * reach `AyahSequencer`'s `error` event through its existing `attemptPlay`
 * catch, rather than being swallowed here.
 */
export function createExpoPlayer(): PlayerHandle {
  const player: AudioPlayer = createAudioPlayer();
  const finishedCbs = new Set<() => void>();

  // Kept for the lifetime of the player: this is what turns
  // `status.didJustFinish` into the `onFinished` callbacks the sequencer
  // relies on to advance to the next ayah.
  const subscription = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
    if (status.didJustFinish) finishedCbs.forEach(cb => cb());
  });

  return {
    get currentTimeMs() {
      return player.currentTime * 1000;
    },

    get playing() {
      return player.playing;
    },

    // Exposes the raw expo-audio `AudioPlayer` so `PlayerProvider` can hand it
    // to `nowPlaying.ts`'s `setNowPlaying` for lock-screen activation.
    // `PlayerHandle` types this as `unknown` on purpose (see types.ts); this
    // is the one place in the app that knows it's actually an `AudioPlayer`.
    get nativePlayer() {
      return player;
    },

    load(uri: string): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        // Subscribed before `replace()` is called, so a status emitted as a
        // direct result of that call cannot be missed.
        const sub = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
          if (status.error) {
            sub.remove();
            reject(new Error(status.error));
          } else if (status.isLoaded) {
            sub.remove();
            resolve();
          }
        });
        // `load()` must never make sound; only `play()` may. expo-audio's
        // Android `replace()` does not honour that on its own: it re-issues
        // `play()` if the player was playing, and ExoPlayer's `prepare()`
        // starts the new source whenever `playWhenReady` is still set —
        // which it is on a player that reached the end of its ayah, since
        // finishing never clears it. The sequencer preloads the ayah after
        // next into exactly such a just-finished slot, so without this
        // pause the preload started reciting on top of the live ayah: two
        // voices from the first boundary of every surah with three or more
        // ayahs. This is what the user heard.
        player.pause();
        player.replace({ uri });
      });
    },

    play(): Promise<void> {
      // Already playing: calling the native `play()` again is a no-op that
      // may not produce a fresh status update, which would otherwise leave
      // this promise pending forever. The sequencer calls `play()` more
      // than once on an already-playing player (e.g. jumping to another
      // ayah while playback continues), so this has to be handled here
      // rather than assumed away.
      if (player.playing) return Promise.resolve();

      return new Promise<void>((resolve, reject) => {
        const sub = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
          if (status.error) {
            sub.remove();
            reject(new Error(status.error));
          } else if (status.playing) {
            sub.remove();
            resolve();
          }
        });
        player.play();
      });
    },

    pause(): void {
      player.pause();
    },

    seekToMs(ms: number): void {
      // Interface is synchronous; a seek failure is not actionable by the
      // caller, but it must not become an unhandled rejection.
      void player.seekTo(ms / 1000).catch(() => {});
    },

    onFinished(cb: () => void): () => void {
      finishedCbs.add(cb);
      return () => finishedCbs.delete(cb);
    },

    release(): void {
      subscription.remove();
      finishedCbs.clear();
      // Pause before removing, and never rely on `remove()` alone to stop
      // the sound. `PlayerProvider`'s `teardown()` releases the old
      // sequencer while its surah is *still audibly playing* — that is the
      // whole point of the switch-over — so this is the one place in the
      // app where a player is discarded mid-recitation. Every other
      // sound-stopping path (`AyahSequencer.pause`, `seekToAyah`) pauses
      // explicitly; this one used to leave stopping entirely to
      // `remove()`'s native teardown, which would overlap the old surah's
      // recitation with the new one for as long as that took.
      player.pause();
      player.remove();
    },
  };
}
