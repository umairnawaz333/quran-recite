import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoScroll } from '../useAutoScroll';

beforeEach(() => {
  document.body.innerHTML = `
    <div data-ayah="1"></div>
    <div data-ayah="2"></div>`;
  Element.prototype.scrollIntoView = vi.fn();
});

describe('useAutoScroll', () => {
  it('scrolls the active ayah into view', () => {
    renderHook(({ ayah }) => useAutoScroll(ayah, true), {
      initialProps: { ayah: 1 },
    });
    expect(document.querySelector('[data-ayah="1"]')!.scrollIntoView)
      .toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  });

  it('does nothing when disabled', () => {
    renderHook(() => useAutoScroll(1, false));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('suspends after a manual wheel scroll', () => {
    const { result } = renderHook(() => useAutoScroll(1, true));
    expect(result.current.suspended).toBe(false);
    act(() => { window.dispatchEvent(new Event('wheel')); });
    expect(result.current.suspended).toBe(true);
  });

  it('stops scrolling while suspended', () => {
    const { rerender } = renderHook(({ ayah }) => useAutoScroll(ayah, true), {
      initialProps: { ayah: 1 },
    });
    act(() => { window.dispatchEvent(new Event('wheel')); });
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    rerender({ ayah: 2 });
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('resume() restores scrolling', () => {
    const { result, rerender } = renderHook(({ ayah }) => useAutoScroll(ayah, true), {
      initialProps: { ayah: 1 },
    });
    act(() => { window.dispatchEvent(new Event('wheel')); });
    act(() => { result.current.resume(); });
    expect(result.current.suspended).toBe(false);
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    rerender({ ayah: 2 });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
