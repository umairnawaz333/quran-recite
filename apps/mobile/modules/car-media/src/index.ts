import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

/** What the car asked for (spec §5.1–§5.4). */
export type CarCommand =
  | { type: 'playSurah'; surahId: number }
  | { type: 'nextSurah' }
  | { type: 'prevSurah' }
  | { type: 'nextAyah' }
  | { type: 'prevAyah' }
  | { type: 'resume' }
  | { type: 'seekTo'; positionMs: number };

export interface NowPlayingPosition {
  positionOffsetMs: number;
  durationMs: number;
}

type Native = {
  engineReady(): void;
  setPosition(offsetMs: number, durationMs: number): void;
  clearPosition(): void;
  setError(message: string): void;
  addListener(
    event: 'onCommand',
    cb: (e: { type: string; arg: number | null }) => void,
  ): EventSubscription;
};

const native = requireNativeModule<Native>('CarMedia');

export const CarMedia = {
  /** JS engine is up and listening; the native side flushes queued commands. */
  engineReady: () => native.engineReady(),
  /** Surah-level position mapping for the seek bar (spec §5.4). */
  setPosition: (p: NowPlayingPosition) => native.setPosition(p.positionOffsetMs, p.durationMs),
  clearPosition: () => native.clearPosition(),
  /** Push an error into the session (spec §7). */
  setError: (message: string) => native.setError(message),
  addCommandListener(cb: (c: CarCommand) => void): EventSubscription {
    return native.addListener('onCommand', (e) => {
      switch (e.type) {
        case 'playSurah':
          if (e.arg !== null) cb({ type: 'playSurah', surahId: e.arg });
          break;
        case 'seekTo':
          if (e.arg !== null) cb({ type: 'seekTo', positionMs: e.arg });
          break;
        case 'nextSurah':
        case 'prevSurah':
        case 'nextAyah':
        case 'prevAyah':
        case 'resume':
          cb({ type: e.type });
          break;
      }
    });
  },
};
