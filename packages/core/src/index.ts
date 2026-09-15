/**
 * Public surface of @quran/core.
 *
 * Everything here is platform-free: no React, no Next, no node built-ins, no
 * DOM — enforced by __tests__/platform-free.test.ts rather than by convention.
 * That is necessary, but not sufficient, for a React Native app to consume
 * this package unchanged. Two known gaps, both left for sub-project B:
 *
 *  - `data/audioUrl.ts` assumes a bundler substitutes
 *    `process.env.NEXT_PUBLIC_AUDIO_BASE_URL` at build time (see its
 *    comment); with no such seam it silently falls back to a root-relative
 *    path rather than throwing.
 *  - `player/timingsLoader.ts` fetches a root-relative URL, which only
 *    resolves against a document origin; React Native's `fetch` requires an
 *    absolute URL and rejects this outright on the first call (see its
 *    comment).
 */
export { normalizeAyah } from './normalize/segments';
export { countBaseLetters, countRecitationWeight, stripPrivateUse } from './normalize/arabic';
export type {
  RawSegment, NormalizeWord, WordTiming, NormalizeInput, NormalizeResult,
} from './normalize/types';

export { Timeline } from './sync/timeline';
export type { TimelinePosition } from './sync/timeline';
export { SyncEngine, findActiveWordIndex } from './sync/engine';
export type { ActiveWordListener, Unsubscribe } from './sync/engine';

export { resolveAudioUrl } from './data/audioUrl';
export type {
  SurahMeta, SurahWord, SurahText, AyahTiming, SurahTimings,
} from './data/types';

export { loadTimings, primeTimings, resetTimingsCache } from './player/timingsLoader';
export { isValidPosition } from './player/lastPosition';
export type { LastPosition } from './player/lastPosition';
