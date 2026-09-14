/**
 * Ambient globals this package's runtime code relies on.
 *
 * This package's tsconfig deliberately omits the "dom" lib so that a stray
 * reference to a DOM/browser global (document, window, localStorage, ...)
 * fails to compile — see __tests__/platform-free.test.ts. `process.env`,
 * `fetch`, and `requestAnimationFrame`/`cancelAnimationFrame` are not DOM
 * globals in that sense: they are provided by every target runtime this
 * package ships to (a browser, Node, and React Native all have `fetch` and
 * `requestAnimationFrame`; `process.env` is substituted at build time by
 * both Next.js and Metro). Declaring just these — instead of adding "dom"
 * to lib — keeps every other DOM global absent and the guard test meaningful.
 */
declare const process: { env: Record<string, string | undefined> };

// `init` is typed `unknown` rather than a real RequestInit shape because no
// caller in this package passes one — keep this shim only as wide as the
// code actually uses.
declare function fetch(
  input: string,
  init?: unknown,
): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

type FrameRequestCallback = (time: number) => void;

declare function requestAnimationFrame(callback: FrameRequestCallback): number;
declare function cancelAnimationFrame(handle: number): void;
