import { vi } from 'vitest';

type Listener = (e: { type: string; arg: number | null }) => void;

let listeners: Listener[] = [];

export const calls = {
  engineReady: 0,
  position: [] as { offsetMs: number; durationMs: number }[],
  cleared: 0,
  errors: [] as string[],
};

export const fakeNative = {
  engineReady: vi.fn(() => { calls.engineReady++; }),
  setPosition: vi.fn((offsetMs: number, durationMs: number) => { calls.position.push({ offsetMs, durationMs }); }),
  clearPosition: vi.fn(() => { calls.cleared++; }),
  setError: vi.fn((m: string) => { calls.errors.push(m); }),
  addListener: vi.fn((_: string, cb: Listener) => {
    listeners.push(cb);
    return { remove: () => { listeners = listeners.filter(l => l !== cb); } };
  }),
};

export function emitCommand(type: string, arg: number | null = null): void {
  listeners.forEach(l => l({ type, arg }));
}

export function resetCarMedia(): void {
  listeners = [];
  calls.engineReady = 0;
  calls.position = [];
  calls.cleared = 0;
  calls.errors = [];
}

export const fakeExpoModulesCore = { requireNativeModule: () => fakeNative };
