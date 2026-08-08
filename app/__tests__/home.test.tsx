import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SurahList } from '../SurahList';
import type { SurahMeta } from '@/lib/data/types';

vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

const surahs: SurahMeta[] = [
  { id: 1, nameArabic: 'الفاتحة', nameSimple: 'Al-Fatihah', nameEnglish: 'The Opener', ayahCount: 7, revelationPlace: 'makkah', available: true },
  { id: 2, nameArabic: 'البقرة', nameSimple: 'Al-Baqarah', nameEnglish: 'The Cow', ayahCount: 286, revelationPlace: 'madinah', available: false },
];

describe('SurahList', () => {
  it('links available surahs', () => {
    render(<SurahList surahs={surahs} />);
    expect(screen.getByRole('link', { name: /Al-Fatihah/ })).toHaveAttribute('href', '/surah/1');
  });

  it('does not link unavailable surahs', () => {
    render(<SurahList surahs={surahs} />);
    expect(screen.queryByRole('link', { name: /Al-Baqarah/ })).toBeNull();
    expect(screen.getByText(/Al-Baqarah/)).toBeInTheDocument();
  });

  it('marks unavailable surahs as coming soon', () => {
    render(<SurahList surahs={surahs} />);
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it('shows ayah counts', () => {
    render(<SurahList surahs={surahs} />);
    expect(screen.getByText('7 ayahs')).toBeInTheDocument();
    expect(screen.getByText('286 ayahs')).toBeInTheDocument();
  });
});
