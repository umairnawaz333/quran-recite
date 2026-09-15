import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      // Load-bearing: vitest externalises workspace dependencies, and Node
      // cannot import @quran/core's TypeScript entry point directly without
      // this alias pointing straight at the source file.
      '@quran/core': path.resolve(import.meta.dirname, '../../packages/core/src/index.ts'),
    },
  },
});
