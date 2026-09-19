import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { engine } from './PlaybackEngine';
import type { EngineState } from './PlaybackEngine';

/** Exactly the fields the engine publishes; see `EngineState` for `pendingSurahId`. */
export type PlayerState = EngineState;

export interface PlayerActions {
  /** Start (or jump within) a surah; `wordId` recites from that word, as clicking a word does on the web. */
  play(surahId: number, ayah?: number, wordId?: string): Promise<void>;
  toggle(): void;
  next(): Promise<void>;
  prev(): Promise<void>;
  /**
   * Registers `surahId` as the surah currently on screen and returns an
   * unsubscribe to call on unmount (or before re-registering a new id).
   *
   * The web attaches a whole per-page `WordRegistry` object here because its
   * DOM nodes belong to the page. Mobile has no DOM — `activeWordStore` is
   * one global store shared by every mounted word — so the only thing a
   * screen needs to hand over is *which* surah it is showing; the engine
   * uses that to decide whether it may paint into that shared store at all.
   */
  attachViewer(surahId: number): () => void;
}

export type PlayerContextValue = PlayerState & PlayerActions;

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayer(): PlayerContextValue {
  const value = useContext(PlayerContext);
  if (!value) throw new Error('usePlayer must be used inside <PlayerProvider>');
  return value;
}

/**
 * The React face of `PlaybackEngine`.
 *
 * Mounted once in `App.tsx`, above the screen switch, so navigating between
 * the surah list and the reader never interrupts recitation. Playback itself
 * lives in the engine (module scope, no React) so the same sequencer serves
 * the screens, the lock screen and — from Stage 3a — a car head unit that
 * may start it with no Activity at all. This component only subscribes to
 * the engine's snapshots and re-exposes its actions under the names the
 * screens already use: `usePlayer()` is unchanged by the extraction.
 */
export function PlayerProvider({ children }: { children: React.ReactNode }) {
  // Not a teardown: the engine outlives every React tree by design (the car
  // may be driving it). `start()` is idempotent, so a second mount is free.
  useEffect(() => { engine.start(); }, []);

  // `getState` returns the same object until a field really moves, which is
  // what this hook requires of a store (see `patch` in PlaybackEngine.ts).
  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);

  // The context value is rebuilt on every state tick (every ayah change,
  // every isPlaying/isLoading flip). Consumers must destructure the actions
  // they need in effects/memos and depend on those specific, stable
  // references rather than on this whole object — otherwise an effect
  // re-runs on that same cadence. (This is exactly what once silently broke
  // word highlighting on the web: a cleanup depending on the whole player
  // object ran constantly and cleared the registry before anything could
  // paint into it.)
  //
  // The actions are the engine's own functions, passed through unwrapped:
  // module-scope identities, stable for the life of the process, so that
  // discipline costs consumers nothing.
  const value = useMemo(() => ({
    ...state,
    play: engine.play,
    toggle: engine.toggle,
    next: engine.next,
    prev: engine.prev,
    attachViewer: engine.attachViewer,
  }), [state]);

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
