import { defineConfig } from 'vitest/config';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

/**
 * The exact `react` copy that `react-test-renderer` itself loads.
 *
 * `react-test-renderer` is CommonJS, so vitest externalises it and Node —
 * not vite — resolves its internal `require('react')`, which no alias can
 * redirect. This workspace has two installed copies (the hoisted root one
 * and `apps/mobile/node_modules/react`), and rendering through the renderer
 * while the component tree imports the *other* copy fails outright: the
 * hooks dispatcher is per-copy module state, so `useState` reads it from a
 * copy the renderer never populated ("Cannot read properties of null
 * (reading 'useState')"). Pointing every vite-resolved `react` import at
 * whichever copy the renderer picked keeps both sides on one instance, and
 * keeps doing so if hoisting changes.
 */
const reactDir = path.dirname(
  createRequire(require.resolve('react-test-renderer')).resolve('react/package.json'),
);

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
      react: reactDir,
    },
  },
});
