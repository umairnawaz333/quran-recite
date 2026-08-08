import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { OfflineBanner } from '../OfflineBanner';

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  });
}

afterEach(() => {
  cleanup();
  setOnLine(true);
});

describe('OfflineBanner', () => {
  it('renders nothing when online', () => {
    setOnLine(true);
    const { container } = render(<OfflineBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the message when offline', () => {
    setOnLine(false);
    render(<OfflineBanner />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Connection lost. Please check your internet connection.',
    );
  });

  it('removes its listeners on unmount', () => {
    setOnLine(true);
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = render(<OfflineBanner />);

    expect(addSpy).toHaveBeenCalledWith('online', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('offline', expect.any(Function));

    const onlineHandler = addSpy.mock.calls.find((call) => call[0] === 'online')?.[1];
    const offlineHandler = addSpy.mock.calls.find((call) => call[0] === 'offline')?.[1];

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('online', onlineHandler);
    expect(removeSpy).toHaveBeenCalledWith('offline', offlineHandler);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
