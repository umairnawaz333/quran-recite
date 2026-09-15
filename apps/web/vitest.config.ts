import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost',
      },
    },
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    exclude: ['node_modules/**', '.next/**', 'out/**', 'e2e/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
      // Load-bearing: vitest externalises workspace dependencies, and Node
      // cannot import @quran/core's TypeScript entry point directly without
      // this alias pointing straight at the source file. Consequence: this
      // unit suite never exercises the package's real exports/main
      // resolution the way `next build` and Metro would.
      '@quran/core': path.resolve(import.meta.dirname, '../../packages/core/src/index.ts'),
    },
  },
});
