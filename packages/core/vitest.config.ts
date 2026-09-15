import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Node lacks requestAnimationFrame/cancelAnimationFrame, which every
    // platform this package targets (browser, React Native) provides —
    // see vitest.setup.ts and src/global.d.ts for why that gap is filled
    // here rather than by moving SyncEngine out of core.
    setupFiles: ['./vitest.setup.ts'],
    include: ['__tests__/**/*.test.ts'],
  },
});
