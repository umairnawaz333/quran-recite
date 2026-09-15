/*
 * This package keeps `environment: 'node'` in vitest.config.ts deliberately:
 * running the suite without a DOM is part of the evidence that @quran/core
 * is platform-free (see src/global.d.ts). `requestAnimationFrame`/
 * `cancelAnimationFrame` are declared there as ambient globals because every
 * platform this package targets — a browser, React Native — provides them;
 * Node is the one exception, and it is a gap in the *test* environment, not
 * in a platform this package ships to. So it is filled here, in test setup,
 * rather than by moving `SyncEngine` out of core.
 *
 * `packages/core/__tests__/engine.test.ts` does
 * `vi.spyOn(globalThis, 'requestAnimationFrame')`, which requires the
 * property to already exist on the object before it can be spied on — these
 * timer-backed stand-ins exist only to give it something to spy over; the
 * spy replaces the scheduling behaviour in every test that uses it.
 */
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  Object.assign(globalThis, {
    requestAnimationFrame: (callback: FrameRequestCallback): number => {
      return setTimeout(() => callback(Date.now()), 16) as unknown as number;
    },
    cancelAnimationFrame: (handle: number): void => {
      clearTimeout(handle);
    },
  });
}
