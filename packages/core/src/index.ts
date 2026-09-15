/**
 * Public surface of @quran/core.
 *
 * Everything here is platform-free: no React, no Next, no node built-ins, no
 * DOM — enforced by __tests__/platform-free.test.ts rather than by convention.
 */
export { normalizeAyah } from './normalize/segments';
export { countBaseLetters, countRecitationWeight, stripPrivateUse } from './normalize/arabic';
export { parseTajweed } from './normalize/tajweed';
export type { TajweedRun } from './normalize/tajweed';
export type {
  RawSegment, NormalizeWord, WordTiming, NormalizeInput, NormalizeResult,
} from './normalize/types';

export { Timeline } from './sync/timeline';
export type { TimelinePosition } from './sync/timeline';
export { SyncEngine, findActiveWordIndex } from './sync/engine';
export type { ActiveWordListener, Unsubscribe } from './sync/engine';

export { resolveAudioUrl, configureAudioBase } from './data/audioUrl';
export { resolveAyahSource } from './data/audioSource';
export type {
  SurahMeta, SurahWord, SurahText, AyahTiming, SurahTimings,
} from './data/types';

export {
  loadTimings, primeTimings, resetTimingsCache, configureTimings,
} from './player/timingsLoader';
export type { TimingsStore } from './player/timingsLoader';
export { isValidPosition } from './player/lastPosition';
export type { LastPosition } from './player/lastPosition';
