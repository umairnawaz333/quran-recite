import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProgressBar, formatTime } from '../ProgressBar';

describe('formatTime', () => {
  it('formats milliseconds as m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(9000)).toBe('0:09');
    expect(formatTime(95000)).toBe('1:35');
    expect(formatTime(3600000)).toBe('60:00');
  });

  it('handles non-finite input', () => {
    expect(formatTime(Number.NaN)).toBe('0:00');
  });
});

describe('ProgressBar', () => {
  it('shows elapsed and total time', () => {
    render(<ProgressBar valueMs={9000} totalMs={95000} onSeek={vi.fn()} />);
    expect(screen.getByText('0:09')).toBeInTheDocument();
    expect(screen.getByText('1:35')).toBeInTheDocument();
  });

  it('does not seek while dragging', () => {
    const onSeek = vi.fn();
    render(<ProgressBar valueMs={0} totalMs={10000} onSeek={onSeek} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '5000' } });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('seeks on release with the dragged value', () => {
    const onSeek = vi.fn();
    render(<ProgressBar valueMs={0} totalMs={10000} onSeek={onSeek} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '5000' } });
    fireEvent.pointerUp(slider);
    expect(onSeek).toHaveBeenCalledWith(5000);
  });

  it('shows the dragged position rather than the incoming one', () => {
    const { rerender } = render(
      <ProgressBar valueMs={0} totalMs={10000} onSeek={vi.fn()} />,
    );
    const slider = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '7000' } });
    rerender(<ProgressBar valueMs={100} totalMs={10000} onSeek={vi.fn()} />);
    expect(slider.value).toBe('7000');
  });

  it('discards the drag on pointercancel without seeking', () => {
    const onSeek = vi.fn();
    render(<ProgressBar valueMs={0} totalMs={10000} onSeek={onSeek} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '5000' } });
    fireEvent.pointerCancel(slider);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('follows an updated valueMs prop again after a cancelled drag', () => {
    const { rerender } = render(
      <ProgressBar valueMs={0} totalMs={10000} onSeek={vi.fn()} />,
    );
    const slider = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '5000' } });
    fireEvent.pointerCancel(slider);
    rerender(<ProgressBar valueMs={200} totalMs={10000} onSeek={vi.fn()} />);
    expect(slider.value).toBe('200');
  });

  it('still commits on pointerup', () => {
    const onSeek = vi.fn();
    render(<ProgressBar valueMs={0} totalMs={10000} onSeek={onSeek} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '6000' } });
    fireEvent.pointerUp(slider);
    expect(onSeek).toHaveBeenCalledWith(6000);
  });
});
