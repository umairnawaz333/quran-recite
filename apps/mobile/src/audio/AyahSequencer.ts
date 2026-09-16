import type { AyahTiming } from '@quran/core';
import { resolveAyahSource } from '@quran/core';
import type { PlayerHandle, PlayerFactory } from './types';

type Slot = 0 | 1;

type Events = {
  ayahchange: (index: number) => void;
  state: (playing: boolean) => void;
  error: (message: string) => void;
  ended: () => void;
};

/**
 * Plays a surah as a sequence of per-ayah audio files with no audible gap
 * between them, despite there being no native queue: `expo-audio` (and the
 * web's `HTMLAudioElement` before it) plays exactly one source at a time.
 *
 * This is a from-scratch port of the web's `AyahPlaylist`
 * (`apps/web/lib/audio/playlist.ts`) onto the device-agnostic `PlayerHandle`
 * seam, carrying over the failure handling that playlist got right only
 * after shipping bugs:
 *
 *  - two player instances alternate, so the next ayah preloads into the idle
 *    one while the current one plays — that overlap is the whole gapless
 *    trick;
 *  - a `play()` rejection is always awaited and inspected, never discarded
 *    (`void player.play()` is exactly the bug that once left `isPlaying`
 *    true forever on a rejection no test caught, because the mock always
 *    resolved);
 *  - a generation token invalidates any completion or settled promise from a
 *    call the caller has since superseded (a seek while a stale finish is
 *    in flight must not move playback backwards).
 */
export class AyahSequencer {
  private readonly ayahs: AyahTiming[];
  private readonly createPlayer: PlayerFactory;
  private readonly localPathFor?: (ayah: number) => string | null;

  /** The two alternating player instances, created lazily on first use. */
  private readonly players: [PlayerHandle | undefined, PlayerHandle | undefined] = [undefined, undefined];
  /** Unsubscribes the previous `onFinished` registration for each slot. */
  private readonly slotUnsub: [(() => void) | null, (() => void) | null] = [null, null];

  private activeSlot: Slot = 0;
  private index = 0;
  private playing = false;

  /**
   * Bumped by every `seekToAyah`/`next`/`prev`. Captured by each
   * `onFinished` registration and by every `play()` attempt at the moment
   * they are issued; a completion or a settled promise that reports back
   * under a stale generation is a leftover from a call the caller has since
   * moved past, and must not touch live state.
   */
  private generation = 0;

  private readonly listeners: { [K in keyof Events]: Set<Events[K]> } = {
    ayahchange: new Set(),
    state: new Set(),
    error: new Set(),
    ended: new Set(),
  };

  constructor(ayahs: AyahTiming[], createPlayer: PlayerFactory, localPathFor?: (ayah: number) => string | null) {
    this.ayahs = ayahs;
    this.createPlayer = createPlayer;
    this.localPathFor = localPathFor;
  }

  get currentIndex(): number {
    return this.index;
  }

  /** The live player's position, fed to `SyncEngine` at frame rate. */
  get localTimeMs(): number {
    return this.players[this.activeSlot]?.currentTimeMs ?? 0;
  }

  on<K extends keyof Events>(event: K, cb: Events[K]): void {
    this.listeners[event].add(cb as never);
  }

  async seekToAyah(index: number, localMs = 0): Promise<void> {
    this.generation += 1;
    const clamped = Math.min(Math.max(index, 0), this.ayahs.length - 1);
    this.index = clamped;

    const player = await this.loadInto(this.activeSlot, clamped);
    player.seekToMs(localMs);
    this.emit('ayahchange', clamped);
    this.preloadNext();

    if (this.playing) {
      await this.attemptPlay(player, this.generation, this.activeSlot);
    }
  }

  async play(): Promise<void> {
    this.playing = true;
    this.emit('state', true);
    const player = this.players[this.activeSlot];
    if (!player) return;
    await this.attemptPlay(player, this.generation, this.activeSlot);
  }

  pause(): void {
    this.playing = false;
    this.players[this.activeSlot]?.pause();
    this.emit('state', false);
  }

  next(): Promise<void> {
    return this.seekToAyah(this.index + 1);
  }

  prev(): Promise<void> {
    return this.seekToAyah(this.index - 1);
  }

  release(): void {
    this.slotUnsub.forEach(unsub => unsub?.());
    this.players.forEach(p => p?.release());
    (Object.keys(this.listeners) as (keyof Events)[]).forEach(k => this.listeners[k].clear());
  }

  /** Loads `ayahIndex` into `slot`, (re)subscribing that slot's completion. */
  private async loadInto(slot: Slot, ayahIndex: number): Promise<PlayerHandle> {
    if (!this.players[slot]) {
      this.players[slot] = this.createPlayer();
    }
    const player = this.players[slot]!;

    // Replace, don't stack, the finish subscription: a real player would
    // otherwise accumulate one listener per ayah over a 6,236-ayah corpus.
    this.slotUnsub[slot]?.();
    const gen = this.generation;
    this.slotUnsub[slot] = player.onFinished(() => this.handleFinished(slot, gen, ayahIndex));

    const ayah = this.ayahs[ayahIndex];
    const localPath = this.localPathFor ? this.localPathFor(ayah.ayah) : null;
    const { uri } = resolveAyahSource(ayah, localPath);
    await player.load(uri);
    return player;
  }

  /** Preloads the ayah after the current one into the now-idle slot. */
  private preloadNext(): void {
    const nextIndex = this.index + 1;
    if (nextIndex >= this.ayahs.length) return;
    const idleSlot: Slot = this.activeSlot === 0 ? 1 : 0;
    // Fire-and-forget: preloading must not block the caller, and a preload
    // failure is recoverable at the boundary (the swap will retry the load)
    // rather than a reason to fail whatever is in progress right now.
    void this.loadInto(idleSlot, nextIndex).catch(() => {});
  }

  /**
   * Fires when the player loaded into `slot` for `ayahIndex` under
   * generation `gen` finishes. All three are captured at load time, not
   * read live, so a completion that arrives after the caller has moved on
   * (a newer generation, or this slot is no longer the active one) is
   * recognisable as stale and is dropped before it can touch live state —
   * even though the underlying player object may be reused across slots and
   * fire its stored callbacks unconditionally.
   */
  private handleFinished(slot: Slot, gen: number, ayahIndex: number): void {
    if (gen !== this.generation) return;
    if (slot !== this.activeSlot) return;

    if (ayahIndex >= this.ayahs.length - 1) {
      this.playing = false;
      this.emit('state', false);
      this.emit('ended');
      return;
    }

    const nextIndex = ayahIndex + 1;
    const nextSlot: Slot = slot === 0 ? 1 : 0;
    this.activeSlot = nextSlot;
    this.index = nextIndex;

    const nextPlayer = this.players[nextSlot];
    nextPlayer?.seekToMs(0);
    if (this.playing && nextPlayer) {
      void this.attemptPlay(nextPlayer, gen, nextSlot);
    }

    this.emit('ayahchange', nextIndex);
    this.preloadNext();
  }

  /**
   * Calls `play()` on `player` and always awaits the result — never
   * `void player.play()`, which is the exact bug the web app shipped: a
   * rejection with the promise discarded left `isPlaying` true forever.
   *
   * `play()` rejects for two distinct reasons in practice:
   *  - `AbortError`: a concurrent load/seek interrupted this attempt. This
   *    is transient; retrying once on the same player is legitimate.
   *  - anything else (e.g. an autoplay-policy block): terminal. The
   *    sequencer must not keep claiming to play — it flips to paused and
   *    surfaces `error` so the caller can offer retry.
   *
   * `gen`/`slotAtCall` guard against a stale rejection or resolution
   * landing after the sequencer has already moved on (seek/next/prev, or a
   * natural advance) by the time the promise settles.
   */
  private async attemptPlay(player: PlayerHandle, gen: number, slotAtCall: Slot, allowRetry = true): Promise<void> {
    try {
      await player.play();
      if (gen !== this.generation || slotAtCall !== this.activeSlot) return;
    } catch (err) {
      if (gen !== this.generation || slotAtCall !== this.activeSlot) return;

      const name = (err as { name?: string } | null | undefined)?.name;
      if (name === 'AbortError' && allowRetry) {
        return this.attemptPlay(player, gen, slotAtCall, false);
      }

      this.playing = false;
      this.emit('state', false);
      const message = err instanceof Error ? err.message : String(err);
      this.emit('error', message);
    }
  }

  private emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): void {
    this.listeners[event].forEach(cb => (cb as (...a: unknown[]) => void)(...args));
  }
}
