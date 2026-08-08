import type { AyahTiming } from '@/lib/data/types';
import { resolveAudioUrl } from '@/lib/data/audioUrl';

type Events = {
  ayahchange: (ayahIndex: number) => void;
  state: (isPlaying: boolean) => void;
  ended: () => void;
  error: (ayahIndex: number) => void;
  loading: (isLoading: boolean) => void;
  duration: (ayahIndex: number, durationMs: number) => void;
};

/**
 * Plays a surah as a sequence of per-ayah audio files.
 *
 * Word timings only exist per ayah, so playback cannot use a single file. Two
 * audio elements alternate: while ayah N plays, N+1 preloads into the idle
 * element, so a boundary does not stall on the network.
 */
export class AyahPlaylist {
  private readonly ayahs: AyahTiming[];
  private readonly elements: [HTMLAudioElement, HTMLAudioElement];
  /** Which ayah index each element in `elements` currently holds. */
  private readonly slotAyahIndex: [number, number] = [0, 0];
  private activeSlot = 0;
  private index = 0;
  private playing = false;
  private listeners: { [K in keyof Events]: Set<Events[K]> } = {
    ayahchange: new Set(), state: new Set(), ended: new Set(),
    error: new Set(), loading: new Set(), duration: new Set(),
  };

  constructor(ayahs: AyahTiming[]) {
    this.ayahs = ayahs;
    this.elements = [new Audio(), new Audio()];
    this.elements.forEach(el => {
      el.preload = 'auto';
      el.addEventListener('ended', () => this.handleEnded(el));
      el.addEventListener('error', () => {
        // Only the currently-playing element's failure is a real playback
        // error. The idle/preloading element can fail (bad network, wrong
        // URL) without affecting the ayah that is happily playing right
        // now; that failure is recoverable silently — the boundary
        // transition will retry the load or surface it then.
        if (el !== this.current) return;
        const slot = this.elements.indexOf(el);
        this.emit('error', this.slotAyahIndex[slot]);
      });
      el.addEventListener('waiting', () => this.emit('loading', true));
      el.addEventListener('playing', () => this.emit('loading', false));
      el.addEventListener('loadedmetadata', () => {
        const slot = this.elements.indexOf(el);
        if (Number.isFinite(el.duration)) {
          this.emit('duration', this.slotAyahIndex[slot], Math.round(el.duration * 1000));
        }
      });
    });
    this.loadInto(this.activeSlot, 0);
    this.preloadNext();
  }

  get currentAyahIndex(): number { return this.index; }
  get isPlaying(): boolean { return this.playing; }
  get current(): HTMLAudioElement { return this.elements[this.activeSlot]; }

  /** Exposed so tests can dispatch events on the preloading element. */
  get idleForTest(): HTMLAudioElement {
    return this.elements[this.activeSlot === 0 ? 1 : 0];
  }

  on<K extends keyof Events>(event: K, cb: Events[K]): () => void {
    this.listeners[event].add(cb as never);
    return () => { this.listeners[event].delete(cb as never); };
  }

  localTimeMs(): number {
    return this.current.currentTime * 1000;
  }

  play(): void {
    this.playing = true;
    this.emit('state', true);
    this.attemptPlay(this.current, this.index);
  }

  pause(): void {
    this.playing = false;
    this.current.pause();
    this.emit('state', false);
  }

  /**
   * Applies volume to BOTH elements, not just the active one. Otherwise the
   * idle/preloading element keeps whatever volume it last had (or its
   * default of 1) and a boundary swap makes playback blip back to full
   * volume even though the user turned it down.
   */
  setVolume(volume: number): void {
    this.elements.forEach(el => { el.volume = volume; });
  }

  seekToAyah(index: number, localMs = 0): void {
    const clamped = Math.min(Math.max(index, 0), this.ayahs.length - 1);
    if (clamped !== this.index) {
      this.index = clamped;
      this.loadInto(this.activeSlot, clamped);
      this.emit('ayahchange', clamped);
      this.preloadNext();
    }
    this.current.currentTime = localMs / 1000;
    if (this.playing) this.attemptPlay(this.current, this.index);
  }

  next(): void { this.seekToAyah(this.index + 1, 0); }
  prev(): void { this.seekToAyah(this.index - 1, 0); }

  destroy(): void {
    this.elements.forEach(el => { el.pause(); el.src = ''; });
    (Object.keys(this.listeners) as (keyof Events)[])
      .forEach(k => this.listeners[k].clear());
  }

  /** Exposed so tests can drive an ayah boundary without real playback. */
  handleEndedForTest(): void {
    this.handleEnded(this.current);
  }

  private handleEnded(el: HTMLAudioElement): void {
    if (el !== this.current) return;

    if (this.index >= this.ayahs.length - 1) {
      this.playing = false;
      this.emit('state', false);

      // "Stop and reset to the surah's start": normalise the cursor so
      // currentAyahIndex reports the truth and a bare play()
      // afterwards starts from ayah 0 rather than replaying the last ayah's
      // tail. This does not itself resume playback.
      const changed = this.index !== 0;
      this.index = 0;
      this.activeSlot = 0;
      this.loadInto(0, 0);
      this.current.currentTime = 0;
      this.preloadNext();
      if (changed) this.emit('ayahchange', 0);

      this.emit('ended');
      return;
    }

    // Swap to the buffer that already holds the next ayah.
    this.activeSlot = this.activeSlot === 0 ? 1 : 0;
    this.index += 1;
    this.current.currentTime = 0;
    if (this.playing) this.attemptPlay(this.current, this.index);
    this.emit('ayahchange', this.index);
    this.preloadNext();
  }

  private preloadNext(): void {
    const nextIndex = this.index + 1;
    if (nextIndex >= this.ayahs.length) return;
    this.loadInto(this.activeSlot === 0 ? 1 : 0, nextIndex);
  }

  private loadInto(slot: number, ayahIndex: number): void {
    const el = this.elements[slot];
    this.slotAyahIndex[slot] = ayahIndex;
    const url = resolveAudioUrl(this.ayahs[ayahIndex].audioUrl);
    if (el.getAttribute('src') === url) return;
    el.setAttribute('src', url);
    el.src = url;
    el.load();
  }

  /**
   * Calls play() on `el` and never lets a rejection pass unnoticed.
   *
   * `play()` rejects for two distinct reasons in practice:
   *  - AbortError: the browser interrupted this play() with a concurrent
   *    load() — exactly what happens right after a boundary swap or seek.
   *    This is transient; retrying once on the same element is legitimate.
   *  - Anything else (notably NotAllowedError from an autoplay-policy
   *    block): terminal for this gesture. The playlist must not keep
   *    claiming to play — it flips to paused and surfaces `error` so the UI
   *    can offer retry instead of sitting on a silently stalled ayah.
   *
   * `ayahIndexAtCall` guards against a stale rejection landing after the
   * playlist has already moved on (seek/next/ended) by the time the promise
   * settles.
   */
  private attemptPlay(el: HTMLAudioElement, ayahIndexAtCall: number, allowRetry = true): void {
    const result = el.play();
    if (!result || typeof result.catch !== 'function') return;
    result.catch((err: unknown) => {
      if (el !== this.current || this.index !== ayahIndexAtCall) return;

      const name = (err as { name?: string } | null | undefined)?.name;
      if (name === 'AbortError' && allowRetry) {
        this.attemptPlay(el, ayahIndexAtCall, false);
        return;
      }

      this.playing = false;
      this.emit('state', false);
      this.emit('error', this.index);
    });
  }

  private emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): void {
    this.listeners[event].forEach(cb => (cb as (...a: unknown[]) => void)(...args));
  }
}
