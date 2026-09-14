/**
 * Public surface of @quran/core.
 *
 * Everything here is platform-free: no React, no Next, no node built-ins, no
 * DOM. That constraint is what lets a React Native app consume this package
 * unchanged, and it is enforced by __tests__/platform-free.test.ts rather than
 * by convention.
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
