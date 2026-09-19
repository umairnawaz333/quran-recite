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
  if (active) return active;
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
    if (s.error && s.error !== lastError) CarMedia.setError('No connection — download this surah on your phone');
    lastError = s.error;
  });
  CarMedia.engineReady();
  active = () => { commands.remove(); unsubscribe(); CarMedia.clearPosition(); active = null; };
  return active;
}
