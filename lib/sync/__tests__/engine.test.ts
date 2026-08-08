import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { findActiveWordIndex, SyncEngine } from '../engine';
import type { WordTiming } from '@/lib/normalize/types';

const t = (position: number, startMs: number, endMs: number): WordTiming => ({
  id: `1:1:${position}`, position, startMs, endMs, estimated: false,
});

// Real Al-Fatihah 1:1 timings
const WORDS = [t(1, 600, 970), t(2, 980, 1560), t(3, 1570, 2520), t(4, 2530, 3920)];

describe('findActiveWordIndex', () => {
  it('finds the word containing the time', () => {
    expect(findActiveWordIndex(WORDS, 700)).toBe(0);
    expect(findActiveWordIndex(WORDS, 2000)).toBe(2);
  });

  it('is inclusive of startMs and exclusive of endMs', () => {
    expect(findActiveWordIndex(WORDS, 600)).toBe(0);
    expect(findActiveWordIndex(WORDS, 970)).toBe(-1);   // in the gap
    expect(findActiveWordIndex(WORDS, 980)).toBe(1);
  });

  it('returns -1 before the first word (leading silence)', () => {
    expect(findActiveWordIndex(WORDS, 0)).toBe(-1);
    expect(findActiveWordIndex(WORDS, 599)).toBe(-1);
  });

  it('returns -1 after the last word', () => {
    expect(findActiveWordIndex(WORDS, 3920)).toBe(-1);
    expect(findActiveWordIndex(WORDS, 99999)).toBe(-1);
  });

  it('returns -1 for an empty timing list', () => {
    expect(findActiveWordIndex([], 100)).toBe(-1);
  });
});

describe('SyncEngine', () => {
  let raf: ReturnType<typeof vi.spyOn>;
  let frame: FrameRequestCallback | null = null;

  beforeEach(() => {
    frame = null;
    raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(cb => {
      frame = cb;
      return 1;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  const tick = () => frame?.(0);

  it('emits the active word id when it changes', () => {
    let now = 700;
    const engine = new SyncEngine();
    const seen: (string | null)[] = [];
    engine.onChange(id => seen.push(id));
    engine.attach(() => now, WORDS);

    tick();
    now = 2000;
    tick();

    expect(seen).toEqual(['1:1:1', '1:1:3']);
    engine.detach();
  });

  it('does not re-emit while the same word stays active', () => {
    let now = 700;
    const engine = new SyncEngine();
    const cb = vi.fn();
    engine.onChange(cb);
    engine.attach(() => now, WORDS);

    tick();
    now = 800;
    tick();
    now = 900;
    tick();

    expect(cb).toHaveBeenCalledTimes(1);
    engine.detach();
  });

  it('emits null when playback enters a gap', () => {
    let now = 700;
    const engine = new SyncEngine();
    const seen: (string | null)[] = [];
    engine.onChange(id => seen.push(id));
    engine.attach(() => now, WORDS);

    tick();
    now = 975;   // between words
    tick();

    expect(seen).toEqual(['1:1:1', null]);
    engine.detach();
  });

  it('stops scheduling frames after detach', () => {
    const engine = new SyncEngine();
    engine.attach(() => 700, WORDS);
    const before = raf.mock.calls.length;
    engine.detach();
    tick();
    expect(raf.mock.calls.length).toBe(before);
  });

  it('unsubscribing stops delivery', () => {
    let now = 700;
    const engine = new SyncEngine();
    const cb = vi.fn();
    const off = engine.onChange(cb);
    engine.attach(() => now, WORDS);
    off();
    tick();
    expect(cb).not.toHaveBeenCalled();
    engine.detach();
  });

  it('replays the current word to a listener that subscribes after attach, with no frame tick required', () => {
    const now = 700;
    const engine = new SyncEngine();
    engine.attach(() => now, WORDS);
    tick(); // establishes an active word ('1:1:1')

    const cb = vi.fn();
    engine.onChange(cb); // subscribes mid-playback, no tick() afterward

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('1:1:1');
    engine.detach();
  });

  it('does not fire a listener that subscribes before attach until the first frame', () => {
    const engine = new SyncEngine();
    const cb = vi.fn();
    engine.onChange(cb);
    expect(cb).not.toHaveBeenCalled();

    engine.attach(() => 700, WORDS);
    expect(cb).not.toHaveBeenCalled(); // still no frame processed yet

    tick();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('1:1:1');
    engine.detach();
  });

  it('does not duplicate-deliver to a replayed listener when the word stays active', () => {
    const now = 700;
    const engine = new SyncEngine();
    engine.attach(() => now, WORDS);
    tick();

    const cb = vi.fn();
    engine.onChange(cb); // replay: 1 call

    tick(); // same word still active; should not call again

    expect(cb).toHaveBeenCalledTimes(1);
    engine.detach();
  });

  it('does not replay a stale word id after detach followed by a new subscription', () => {
    const engine = new SyncEngine();
    engine.attach(() => 700, WORDS);
    tick(); // active word becomes '1:1:1'
    engine.detach();

    const cb = vi.fn();
    engine.onChange(cb);

    expect(cb).not.toHaveBeenCalled();
  });
});
