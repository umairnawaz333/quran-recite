import '@testing-library/jest-dom/vitest';

// Polyfill localStorage for jsdom in Node.js if not available
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
