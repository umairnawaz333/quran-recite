import type { AyahTiming } from '@quran/core';
import { resolveAyahSource } from '@quran/core';
import type { PlayerHandle, PlayerFactory } from './types';

type Events = {
  ayahchange: (index: number) => void;
  state: (playing: boolean) => void;
  error: (message: string) => void;
  ended: () => void;
};

/**
 * Plays a surah as a sequence of per-ayah audio files on ONE native player,
 * for the app's whole life, across surahs.
 *
 * This used to alternate two players so the next ayah could preload into
 * the idle one (the web's `AyahPlaylist` trick, which is the only way to be
 * gapless with `HTMLAudioElement`). On Android that design collided with
 * the lock screen: Android binds its media session to a single native
 * player, the binding cannot be moved while the app is backgrounded, and
 * expo destroys a player's own bare session when it becomes the bound one.
 * So on every other ayah the notification card showed — and its buttons
 * acted on — the silent player, and media keys reached the audible one
 * only by luck of session ordering. Two players also produced the two-voice
 * bugs this file has a history of: a preload starting under the live ayah.
 *
 * One player has none of those failure modes: the bound player is always
 * the one making sound, its card is always right, and there is nothing else
 * that could sound. What is given up is the in-memory preload. In its place
 * the next ayah is *prefetched to disk* (the `prefetch` seam, wired to the
 * app's warm cache) while the current one plays, so the boundary reload is
 * a local file: pause, replace, prepare, play — a short gap the reciter's
 * own pause between ayahs comfortably covers.
 *
 * Carried over from the two-player design, because they were paid for:
 *  - a `play()` rejection is always awaited and inspected, never discarded
 *    (`void player.play()` once left `isPlaying` true forever on a rejection
 *    no test caught, because the mock always resolved);
 *  - a generation token invalidates any completion or settled promise from a
 *    call the caller has since superseded — a stale finish AND a stale seek:
 *    every `await` is a point where a newer `seekToAyah`/`next`/`prev`/
 *    `switchTo` may have landed, and the resumed continuation rechecks
 *    before touching live state or emitting;
 *  - recorded *intent*: what this sequencer last told the player to do. A
 *    reported `playing` transition that disagrees with it came from outside
 *    the app — the notification, the lock screen, a headset button — and is
 *    adopted as the user's command, so the bar and the highlight learn of it.
 */
export class AyahSequencer {
  private ayahs: AyahTiming[];
  private readonly createPlayer: PlayerFactory;
  private readonly localPathFor?: (ayah: AyahTiming) => string | null;
  private readonly prefetch?: (ayah: AyahTiming) => Promise<void>;

  private player: PlayerHandle | undefined;
  private unsubFinished: (() => void) | null = null;
  private unsubTransport: (() => void) | null = null;
  /**
   * Which ayah the player holds a *successfully completed* load for, or
   * `null`: nothing loaded yet, a load in flight (the source is already
   * being replaced underneath), or the last load rejected.
   */
  private loadedIndex: number | null = null;

  private index = 0;
  private playing = false;
  /** What this sequencer last asked the player to do; see the class doc. */
  private intent = false;

  /**
   * Bumped by every `seekToAyah`/`next`/`prev`/`switchTo`/`release`.
   * Captured by each `onFinished` registration and by every `play()`/
   * `load()` attempt at the moment they are issued; a completion or a
   * settled promise that reports back under a stale generation is a
   * leftover from a call the caller has since moved past, and must not
   * touch live state.
   */
  private generation = 0;

  private readonly listeners: { [K in keyof Events]: Set<Events[K]> } = {
    ayahchange: new Set(),
    state: new Set(),
    error: new Set(),
    ended: new Set(),
  };

  constructor(
    ayahs: AyahTiming[],
    createPlayer: PlayerFactory,
    localPathFor?: (ayah: AyahTiming) => string | null,
    prefetch?: (ayah: AyahTiming) => Promise<void>,
  ) {
    this.ayahs = ayahs;
    this.createPlayer = createPlayer;
    this.localPathFor = localPathFor;
    this.prefetch = prefetch;
  }

  get currentIndex(): number {
    return this.index;
  }

  /** The player's position, fed to `SyncEngine` at frame rate. */
  get localTimeMs(): number {
    return this.player?.currentTimeMs ?? 0;
  }

  /**
   * The one `PlayerHandle`, or `undefined` before anything has loaded.
   * Exposed so `PlayerProvider` can hand the platform player behind it to
   * the lock screen. With a single player this is always the audible one.
   */
  get activePlayer(): PlayerHandle | undefined {
    return this.player;
  }

  on<K extends keyof Events>(event: K, cb: Events[K]): void {
    this.listeners[event].add(cb as never);
  }

  off<K extends keyof Events>(event: K, cb: Events[K]): void {
    this.listeners[event].delete(cb as never);
  }

  async seekToAyah(index: number, localMs = 0): Promise<void> {
    this.generation += 1;
    const gen = this.generation;
    const clamped = Math.min(Math.max(index, 0), this.ayahs.length - 1);
    this.index = clamped;

    // Silence first: whatever is sounding belongs to the ayah being left.
    this.pausePlayer();

    // A load failure propagates to the caller (the provider attributes it
    // to the surah that was asked for); `advanceInto`, which has no caller,
    // reports its own failures through `error` instead.
    const player = await this.load(clamped);
    // A newer seek may have landed while this load was in flight (a
    // double-tap, a scrub). Without this the stale continuation would seek
    // the player to its own now-wrong position and emit its own superseded
    // index after the live call already emitted the correct one.
    if (gen !== this.generation) return;

    player.seekToMs(localMs);
    this.emit('ayahchange', clamped);
    this.prefetchNext();

    if (this.playing) {
      await this.attemptPlay(player, gen);
    }
  }

  /**
   * Move onto another surah on the same player. The old surah stops the
   * moment the new first ayah starts loading (one player cannot do both);
   * the caller keeps its visible state on the old surah until this resolves,
   * so the bar never names a surah that has not loaded. Anything the old
   * surah does during the load — finishing its ayah, say — is dropped as
   * stale, so it neither advances nor reports `ended` mid-switch.
   */
  async switchTo(ayahs: AyahTiming[], index: number, localMs = 0): Promise<void> {
    const previous = { ayahs: this.ayahs, index: this.index };
    this.ayahs = ayahs;
    // Whatever the player holds is the old surah's.
    this.loadedIndex = null;
    try {
      await this.seekToAyah(index, localMs);
    } catch (err) {
      // Back to the old surah, so a later play() reloads what the caller
      // still describes rather than the surah that failed.
      this.ayahs = previous.ayahs;
      this.index = previous.index;
      this.loadedIndex = null;
      throw err;
    }
  }

  async play(): Promise<void> {
    this.playing = true;
    this.emit('state', true);
    const player = this.player;
    if (!player) return;
    if (this.loadedIndex === null) {
      // The player holds nothing usable (a failed load, or a switch that
      // failed and was rolled back): reload the current ayah first.
      // `seekToAyah` plays it, since `playing` is already set.
      try {
        await this.seekToAyah(this.index);
      } catch (err) {
        this.playing = false;
        this.emit('state', false);
        this.emit('error', err instanceof Error ? err.message : String(err));
      }
      return;
    }
    await this.attemptPlay(player, this.generation);
  }

  pause(): void {
    this.playing = false;
    this.pausePlayer();
    this.emit('state', false);
  }

  next(): Promise<void> {
    return this.seekToAyah(this.index + 1);
  }

  prev(): Promise<void> {
    return this.seekToAyah(this.index - 1);
  }

  release(): void {
    // Invalidate every in-flight continuation the same way a seek does: a
    // boundary advance or a play attempt that resumes after this sees a
    // stale generation and drops out instead of touching a released player.
    this.generation += 1;
    this.unsubFinished?.();
    this.unsubTransport?.();
    this.unsubFinished = null;
    this.unsubTransport = null;
    this.player?.release();
    this.player = undefined;
    this.loadedIndex = null;
    (Object.keys(this.listeners) as (keyof Events)[]).forEach(k => this.listeners[k].clear());
  }

  private ensurePlayer(): PlayerHandle {
    if (!this.player) {
      this.player = this.createPlayer();
      // For the player's whole life, not per ayah: what this watches for is
      // a transport command from outside the app.
      this.unsubTransport = this.player.onPlayingChanged(playing => this.handleExternalTransport(playing));
    }
    return this.player;
  }

  /**
   * (Re)arms the finish subscription for `ayahIndex` under `gen`. Replace,
   * don't stack: a real player would otherwise accumulate one listener per
   * ayah over a 6,236-ayah corpus.
   */
  private subscribeFinished(player: PlayerHandle, gen: number, ayahIndex: number): void {
    this.unsubFinished?.();
    this.unsubFinished = player.onFinished(() => this.handleFinished(gen, ayahIndex));
  }

  /** Gets the player holding `ayahIndex`, loading it if it does not already. */
  private async load(ayahIndex: number): Promise<PlayerHandle> {
    const player = this.ensurePlayer();
    const gen = this.generation;
    if (this.loadedIndex === ayahIndex) {
      this.subscribeFinished(player, gen, ayahIndex);
      return player;
    }

    // Nothing may be listening for a finish while the source is replaced:
    // the old file reaching its end mid-load (or the platform reporting a
    // finish as it tears the old source down) would otherwise be read as
    // the NEW ayah finishing, and the sequencer would advance past an ayah
    // that never played. The subscription is armed once the load settles.
    this.unsubFinished?.();
    this.unsubFinished = null;

    const ayah = this.ayahs[ayahIndex];
    const localPath = this.localPathFor ? this.localPathFor(ayah) : null;
    const { uri } = resolveAyahSource(ayah, localPath);
    // Invalidate before the load starts, not after it settles: the platform
    // player swaps its source synchronously inside `load()`.
    this.loadedIndex = null;
    // A load is never meant to make sound (`expoPlayer.load` pauses first,
    // for exactly that reason), so record the intent alongside: a player
    // that came out of a load playing did not do so on this sequencer's
    // orders.
    this.intent = false;
    await player.load(uri);

    // Only record the load as complete if no newer call superseded it while
    // it was in flight — otherwise a late-resolving stale load could claim
    // the player holds an ayah it has since been told to replace.
    if (gen === this.generation) {
      this.loadedIndex = ayahIndex;
      this.subscribeFinished(player, gen, ayahIndex);
    }
    return player;
  }

  /** Warm the disk cache with the ayah after the current one. */
  private prefetchNext(): void {
    const nextIndex = this.index + 1;
    if (nextIndex >= this.ayahs.length || !this.prefetch) return;
    void this.prefetch(this.ayahs[nextIndex]).catch(() => {});
  }

  /**
   * Fires when the player, loaded for `ayahIndex` under generation `gen`,
   * reaches the end of its file. Both are captured at load time, not read
   * live, so a completion that arrives after the caller has moved on is
   * recognisable as stale and dropped before it can touch live state.
   */
  private handleFinished(gen: number, ayahIndex: number): void {
    if (gen !== this.generation) return;

    if (ayahIndex >= this.ayahs.length - 1) {
      this.playing = false;
      // Reaching the end of the surah stops the player as surely as a
      // pause would; recording that keeps a later, genuinely external start
      // recognisable as external.
      this.pausePlayer();
      this.emit('state', false);
      this.emit('ended');
      return;
    }

    // The player reached the end of its file on its own; nothing ever told
    // it to stop. Record that before loading the next ayah into it — a
    // platform player that keeps "play when ready" armed across the end of
    // a track would otherwise start the new source the instant it loads.
    // `expoPlayer.load()` defends against the same thing at its own layer.
    this.pausePlayer();

    const nextIndex = ayahIndex + 1;
    this.index = nextIndex;
    this.emit('ayahchange', nextIndex);
    this.prefetchNext();

    void this.advanceInto(nextIndex, gen);
  }

  /**
   * Gets the player actually playing `ayahIndex` after a boundary. Loads it
   * (from the disk cache when the prefetch landed, else streaming) and
   * plays. If the load fails, that surfaces as `error` rather than leaving
   * playback silently stalled at the boundary.
   */
  private async advanceInto(ayahIndex: number, gen: number): Promise<void> {
    let player: PlayerHandle;
    try {
      player = await this.load(ayahIndex);
    } catch (err) {
      if (gen !== this.generation) return;
      this.playing = false;
      this.emit('state', false);
      this.emit('error', err instanceof Error ? err.message : String(err));
      return;
    }
    if (gen !== this.generation) return;

    player.seekToMs(0);
    if (this.playing) {
      // Fire-and-forget: this runs from handleFinished, itself invoked by
      // onFinished's `() => void` callback, so there is nothing here that
      // could await it. That's fine — attemptPlay never rejects; every
      // play() failure is caught and handled inside its own try/catch.
      void this.attemptPlay(player, gen);
    }
  }

  /**
   * Calls `play()` and always awaits the result — never `void player.play()`,
   * which is the exact bug the web app shipped: a rejection with the promise
   * discarded left `isPlaying` true forever.
   *
   * `play()` rejects for two distinct reasons in practice:
   *  - `AbortError`: a concurrent load/seek interrupted this attempt. This
   *    is transient; retrying once is legitimate.
   *  - anything else (`NotAllowedError`, a decode failure): terminal. The
   *    sequencer reports not-playing and surfaces the error.
   */
  private async attemptPlay(player: PlayerHandle, gen: number, allowRetry = true): Promise<void> {
    try {
      this.intent = true;
      await player.play();
    } catch (err) {
      if (gen !== this.generation) return;

      const name = (err as { name?: string } | null | undefined)?.name;
      if (name === 'AbortError' && allowRetry) {
        return this.attemptPlay(player, gen, false);
      }

      this.playing = false;
      // This play never took: the player is not playing and is not meant to
      // be, so leaving the intent set would make its *next* genuine start
      // look self-inflicted.
      this.intent = false;
      this.emit('state', false);
      this.emit('error', err instanceof Error ? err.message : String(err));
    }
  }

  private pausePlayer(): void {
    this.intent = false;
    this.player?.pause();
  }

  /**
   * A `playing` transition reported by the player. One that agrees with the
   * recorded intent is this sequencer's own command being reported back;
   * one that disagrees came from outside the app and is adopted as the
   * user's — so the bar and the word highlight learn of it.
   */
  private handleExternalTransport(playing: boolean): void {
    if (playing === this.intent) return;
    if (playing) {
      this.intent = true;
      if (!this.playing) void this.play();
    } else {
      this.intent = false;
      if (this.playing) this.pause();
    }
  }

  private emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): void {
    this.listeners[event].forEach(cb => (cb as (...a: Parameters<Events[K]>) => void)(...args));
  }
}
