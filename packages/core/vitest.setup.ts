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
 * stand-ins exist only to give it something to spy over. They record the
 * callback and deliberately never fire it: `SyncEngine.step()` calls
 * `schedule()` unconditionally, so a stand-in that actually schedules would
 * start an unbounded ~16ms setTimeout chain for any future test that
 * constructs a SyncEngine without spying rAF, outliving that test.
 */
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  let nextHandle = 1;
  const pendingCallbacks = new Map<number, FrameRequestCallback>();
  Object.assign(globalThis, {
    requestAnimationFrame: (callback: FrameRequestCallback): number => {
      const handle = nextHandle++;
      pendingCallbacks.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame: (handle: number): void => {
      pendingCallbacks.delete(handle);
    },
  });
}
