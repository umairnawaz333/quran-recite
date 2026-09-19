import { engine } from '../player/PlaybackEngine';
import { CarMedia } from '../../modules/car-media/src';

/**
 * The car's view of the engine (spec §4): commands from the head unit become
 * engine calls; the engine's state becomes the seek bar's surah-level position
 * and, when a surah cannot start, the session error the car shows. Metadata
 * (title/subtitle/artwork) already flows through the lock-screen path — the
 * session is one and the same — so nothing is duplicated here.
 */
let active: (() => void) | null = null;

export function registerCarEngine(): () => void {
  if (active) {
    // Already wired, but still announce: `engineReady()` is what flushes the
    // native queue, and a re-boot inside a live runtime (the booter reset
    // itself after a delivery found no sink, or a second headless task
    // started) has commands waiting behind a boot that this runtime has
    // already completed. Announcing only on the first call leaves them there
    // until they time out. The native side is idempotent.
    CarMedia.engineReady();
    return active;
  }
  engine.start();
  const commands = CarMedia.addCommandListener(c => {
    switch (c.type) {
      case 'playSurah': void engine.play(c.surahId); break;
      case 'nextSurah': void engine.nextSurah(); break;
      case 'prevSurah': void engine.prevSurah(); break;
      case 'nextAyah': void engine.next(); break;
      case 'prevAyah': void engine.prev(); break;
      case 'resume': void engine.resume(); break;
      case 'seekTo': void engine.seekToSurahPosition(c.positionMs); break;
    }
  });
  let lastKey = '';
  let lastError: string | null = null;
  const unsubscribe = engine.subscribe(() => {
    const s = engine.getState();
    const t = engine.currentTimings();
    const index = engine.currentAyahIndex();
    if (t && index >= 0) {
      const key = `${s.surahId}:${index}`;
      if (key !== lastKey) { lastKey = key; CarMedia.setPosition({ positionOffsetMs: t.ayahs[index].startOffsetMs, durationMs: t.surahDurationMs }); }
    } else if (lastKey) { lastKey = ''; CarMedia.clearPosition(); }
    if (s.error && s.error !== lastError) {
      // Spec §7: a surah that never started (its timings, or a mid-play
      // switch/seek, failed to load) gets the connection copy — the
      // engine's own message names an offline surah the car cannot act on.
      // A failure mid-surah (the sequencer's own `onError`) shows the
      // engine's text as-is, since it already names the real failure.
      CarMedia.setError(s.errorKind === 'playback' ? s.error : 'No connection — download this surah on your phone');
    }
    lastError = s.error;
  });
  CarMedia.engineReady();
  active = () => { commands.remove(); unsubscribe(); CarMedia.clearPosition(); active = null; };
  return active;
}
