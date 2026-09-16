import { useSyncExternalStore } from 'react';

/**
 * Which word is currently being recited.
 *
 * The web app toggles a CSS class on two DOM nodes per change, bypassing
 * React entirely. There is no DOM here, so this store plays the same role:
 * each rendered word subscribes with a selector that answers "am I active?",
 * so a change re-renders exactly the two words involved rather than a tree of
 * thousands. Al-Baqarah has 6,116 words and re-rendering them at frame rate
 * would be unusable.
 */
let active: string | null = null;
const listeners = new Set<() => void>();

export const activeWordStore = {
  set(wordId: string | null) {
    if (wordId === active) return;      // no-op writes must not wake subscribers
    active = wordId;
    listeners.forEach(cb => cb());
  },
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },
  isActive(wordId: string) {
    return active === wordId;
  },
  getSnapshot() {
    return active;
  },
};

/**
 * Whether `wordId` is the one currently being recited. Each word component
 * calls this with its own id, so a change to `activeWordStore` re-renders
 * only the (at most two) words whose answer actually flipped.
 */
export function useIsActiveWord(wordId: string): boolean {
  return useSyncExternalStore(
    activeWordStore.subscribe,
    () => activeWordStore.isActive(wordId),
  );
}
