import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuranReader } from '../QuranReader';
import { WordRegistry } from '@/lib/reader/wordRegistry';
import type { SurahText } from '@quran/core';

const text: SurahText = {
  surah: 1,
  ayahs: [
    { ayah: 1, words: [
      { id: '1:1:1', position: 1, tajweed: 'بِسۡمِ', indopak: 'بِسۡمِ' },
      { id: '1:1:2', position: 2, tajweed: '<rule class=ham_wasl>ٱ</rule>للَّهِ', indopak: 'اللهِ' },
    ] },
    { ayah: 2, words: [
      { id: '1:2:1', position: 1, tajweed: 'ٱلۡحَمۡدُ', indopak: 'اَلۡحَمۡدُ' },
    ] },
  ],
};

const setup = (overrides = {}) => {
  const registry = new WordRegistry();
  const onWordClick = vi.fn();
  const onAyahPlay = vi.fn();
  render(
    <QuranReader
      text={text}
      script="tajweed"
      registry={registry}
      onWordClick={onWordClick}
      onAyahPlay={onAyahPlay}
      activeAyah={1}
      {...overrides}
    />,
  );
  return { registry, onWordClick, onAyahPlay };
};

describe('QuranReader', () => {
  it('renders every word as an addressable element', () => {
    setup();
    expect(document.querySelector('[data-word-id="1:1:1"]')).toBeInTheDocument();
    expect(document.querySelector('[data-word-id="1:2:1"]')).toBeInTheDocument();
  });

  it('renders tajweed rule markup as elements, not escaped text', () => {
    setup();
    const word = document.querySelector('[data-word-id="1:1:2"]')!;
    expect(word.querySelector('rule')).not.toBeNull();
    expect(word.textContent).not.toContain('<rule');
  });

  it('renders IndoPak text when that script is selected', () => {
    setup({ script: 'indopak' });
    const word = document.querySelector('[data-word-id="1:1:2"]')!;
    expect(word.textContent).toBe('اللهِ');
    expect(word.querySelector('rule')).toBeNull();
  });

  it('produces identical word ids in both scripts', () => {
    const ids = (script: 'tajweed' | 'indopak') => {
      document.body.innerHTML = '';
      setup({ script });
      return [...document.querySelectorAll('[data-word-id]')]
        .map(el => el.getAttribute('data-word-id'));
    };
    expect(ids('tajweed')).toEqual(ids('indopak'));
  });

  it('calls onWordClick with the word id', async () => {
    const { onWordClick } = setup();
    await userEvent.click(document.querySelector('[data-word-id="1:1:2"]')!);
    expect(onWordClick).toHaveBeenCalledWith('1:1:2');
  });

  // Parameterised over both scripts on purpose: QuranWord has two near-
  // duplicate branches (tajweed vs indopak) differing only in how the text
  // is injected, and a keyboard fix applied to only one branch previously
  // slipped through review. Running the same assertion over both scripts
  // catches that class of drift instead of re-proving it once.
  describe.each(['tajweed', 'indopak'] as const)('keyboard activation (%s script)', script => {
    it('activates a word on Enter, per ARIA button semantics', () => {
      const { onWordClick } = setup({ script });
      const word = document.querySelector('[data-word-id="1:1:2"]')!;
      fireEvent.keyDown(word, { key: 'Enter' });
      expect(onWordClick).toHaveBeenCalledWith('1:1:2');
    });

    it('activates a word on Space, per ARIA button semantics', () => {
      const { onWordClick } = setup({ script });
      const word = document.querySelector('[data-word-id="1:1:2"]')!;
      fireEvent.keyDown(word, { key: ' ', code: 'Space' });
      expect(onWordClick).toHaveBeenCalledWith('1:1:2');
    });
  });

  it('calls onAyahPlay with the ayah number', async () => {
    const { onAyahPlay } = setup();
    await userEvent.click(screen.getByRole('button', { name: /play ayah 2/i }));
    expect(onAyahPlay).toHaveBeenCalledWith(2);
  });

  it('registry.setActive toggles classes without re-rendering', () => {
    const { registry } = setup();
    const first = document.querySelector('[data-word-id="1:1:1"]')!;
    const second = document.querySelector('[data-word-id="1:1:2"]')!;

    registry.setActive('1:1:1', false);
    expect(first.classList.contains('word--active')).toBe(true);

    registry.setActive('1:1:2', false);
    expect(first.classList.contains('word--active')).toBe(false);
    expect(second.classList.contains('word--active')).toBe(true);
  });

  it('marks estimated timings with the softer class', () => {
    const { registry } = setup();
    registry.setActive('1:1:1', true);
    const first = document.querySelector('[data-word-id="1:1:1"]')!;
    expect(first.classList.contains('word--active-estimated')).toBe(true);
  });

  it('clears the highlight when given null', () => {
    const { registry } = setup();
    registry.setActive('1:1:1', false);
    registry.setActive(null, false);
    expect(document.querySelector('.word--active')).toBeNull();
  });
});
