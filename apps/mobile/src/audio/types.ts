/**
 * The seam between the sequencer and whatever audio library actually plays
 * sound. Keeping playback pure TypeScript against this interface (rather
 * than against `expo-audio` directly) is what lets the sequencer's failure
 * modes — a rejected play(), a stale completion, the final-ayah boundary —
 * be tested without a device or an audio library at all.
 */
export interface PlayerHandle {
  readonly currentTimeMs: number;
  readonly playing: boolean;
  load(uri: string): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seekToMs(ms: number): void;
  onFinished(cb: () => void): () => void;
  /**
   * Subscribes to *transitions* of whether this player is actually making
   * sound, whoever caused them — including a play or pause the app never
   * asked for. That last case is the whole reason this exists: Android's
   * notification / lock-screen transport buttons and media keys act
   * straight on the native player the OS media session is bound to, never
   * through this app's JS, so a player starting or stopping behind the
   * sequencer's back is the only trace such a command leaves. See
   * `AyahSequencer`'s external-transport handling.
   *
   * Contract, which `AyahSequencer` relies on:
   *  - transitions only, never a repeat of the value last reported (a real
   *    player emits a status on a timer while playing);
   *  - the natural end of a track is *not* reported here — that is what
   *    `onFinished` is for, and reporting it twice would be indistinguishable
   *    from someone pressing pause at the exact ayah boundary.
   *
   * Returns an unsubscribe.
   */
  onPlayingChanged(cb: (playing: boolean) => void): () => void;
  release(): void;
  /**
   * The underlying platform player object, if this handle wraps one that
   * exposes further OS integration (expo-audio's lock-screen / notification
   * controls, in production). Deliberately untyped: this interface exists
   * precisely so `AyahSequencer` never has to know what backs it. Only
   * lock-screen wiring outside the sequencer (`PlayerProvider`) reaches
   * through this, casting it back to a concrete type there.
   */
  readonly nativePlayer?: unknown;
}

export interface PlayerFactory {
  (): PlayerHandle;
}
