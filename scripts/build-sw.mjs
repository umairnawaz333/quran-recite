import { build } from 'esbuild';

// The service worker cannot import from the app bundle at runtime, so it is
// written in TypeScript and bundled here. This is what lets it share the
// unit-tested eviction rule in lib/offline/evictions.ts rather than carrying
// a hand-copied duplicate.
await build({
  entryPoints: ['lib/offline/sw.ts'],
  outfile: 'public/sw.js',
  bundle: true,
  format: 'iife',
  target: 'es2020',
  platform: 'browser',
  legalComments: 'none',
  banner: { js: '/* Generated from lib/offline/sw.ts — do not edit. */' },
});

console.log('built public/sw.js');
