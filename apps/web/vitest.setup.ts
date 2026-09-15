import '@testing-library/jest-dom/vitest';

/*
 * jsdom (v30 under vitest 4) exposes no localStorage: both
 * globalThis.localStorage and window.localStorage are undefined, even with
 * environmentOptions.jsdom.url set to a non-opaque origin. lib/player/
 * lastPosition.ts targets real browser storage, so tests need a stand-in.
 *
 * The guard means a jsdom version that does provide Storage takes precedence
 * over this stand-in rather than being shadowed by it.
 */
if (typeof localStorage === 'undefined') {
  const store: Record<string, string> = {};
  const createStorage = () => ({
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      Object.keys(store).forEach(key => delete store[key]);
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  });
  Object.assign(globalThis, { localStorage: createStorage() });
}
