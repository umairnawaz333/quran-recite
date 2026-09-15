/**
 * Public surface of @quran/core.
 *
 * Everything here is platform-free: no React, no Next, no node built-ins, no
 * DOM — enforced by __tests__/platform-free.test.ts rather than by convention.
 * That is necessary, but not sufficient, for a React Native app to consume
 * this package unchanged: `data/audioUrl.ts` still assumes a bundler
 * substitutes `process.env.NEXT_PUBLIC_AUDIO_BASE_URL` at build time (see its
 * comment) rather than working with no such seam at all. Closing that gap is
 * sub-project B's job.
 */
export { normalizeAyah } from './normalize/segments';
export { countBaseLetters, countRecitationWeight, stripPrivateUse } from './normalize/arabic';
export type {
  RawSegment, NormalizeWord, WordTiming, NormalizeInput, NormalizeResult,
} from './normalize/types';

export { Timeline } from './sync/timeline';
export type { TimelinePosition } from './sync/timeline';
export { findActiveWordIndex } from './sync/engine';

export { resolveAudioUrl } from './data/audioUrl';
export type {
  SurahMeta, SurahWord, SurahText, AyahTiming, SurahTimings,
} from './data/types';

export { loadTimings, primeTimings, resetTimingsCache } from './player/timingsLoader';
export { isValidPosition } from './player/lastPosition';
export type { LastPosition } from './player/lastPosition';
