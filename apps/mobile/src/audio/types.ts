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
  release(): void;
  /**
   * The underlying platform player object, if this handle wraps one that
   * exposes further OS integration (expo-audio's lock-screen / notification
   * controls, in production). Deliberately untyped: this interface exists
   * precisely so `AyahSequencer` never has to know what backs it. Only
   * lock-screen wiring outside the sequencer (`usePlayback`) reaches
   * through this, casting it back to a concrete type there.
   */
  readonly nativePlayer?: unknown;
}

export interface PlayerFactory {
  (): PlayerHandle;
}
