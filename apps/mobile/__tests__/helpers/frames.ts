/**
 * A hand-cranked animation frame clock.
 *
 * Node has no `requestAnimationFrame` at all, so without this the highlight
 * loop (`SyncEngine.attach`) throws the moment playback starts. Driving it
 * by hand also makes the loop's lifecycle observable: a frame runs only when
 * a test says so, `pending()` reports whether a loop is still scheduled at
 * all, and `cancelled` counts the teardowns — which is what "the rAF loop
 * must not keep running after a pause or the end of a surah" comes down to.
 */
type FrameCallback = (time: number) => void;

let scheduled = new Map<number, FrameCallback>();
let nextId = 1;
let requested = 0;
let cancelled = 0;
let now = 0;

export const frames = {
  /** How many frames have been requested since the last reset. */
  get requested() { return requested; },
  /** How many scheduled frames have been cancelled since the last reset. */
  get cancelled() { return cancelled; },
  /** Frames scheduled and neither run nor cancelled — i.e. is a loop alive? */
  get pending() { return scheduled.size; },
};

export function installFrameClock(): void {
  globalThis.requestAnimationFrame = (cb: FrameCallback) => {
    const id = nextId++;
    requested += 1;
    scheduled.set(id, cb);
    return id;
  };
  globalThis.cancelAnimationFrame = (id?: number | null) => {
    if (id != null && scheduled.delete(id)) cancelled += 1;
  };
}

/** Runs `count` frames; each frame's callbacks may schedule the next one. */
export function runFrames(count = 1): void {
  for (let i = 0; i < count; i += 1) {
    const due = [...scheduled.values()];
    scheduled = new Map();
    now += 16;
    due.forEach(cb => cb(now));
  }
}

export function resetFrames(): void {
  scheduled = new Map();
  nextId = 1;
  requested = 0;
  cancelled = 0;
  now = 0;
}
