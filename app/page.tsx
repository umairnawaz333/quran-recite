import { getSurahList } from '@/lib/data/loaders';
import { SurahList } from './SurahList';

export const metadata = {
  title: 'Quran — listen and follow every word',
  description:
    'Listen to the Quran recited by AbdulBaset AbdulSamad while each word is highlighted in time with the recitation.',
};

export default function HomePage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-10">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-semibold">Quran</h1>
        <p className="mt-1 text-neutral-500">Listen · Read · Follow along</p>
      </header>
      <SurahList surahs={getSurahList()} />
    </main>
  );
}
