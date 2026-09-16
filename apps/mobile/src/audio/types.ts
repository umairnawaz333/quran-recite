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
}

export interface PlayerFactory {
  (): PlayerHandle;
}
