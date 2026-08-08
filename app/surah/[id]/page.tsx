import { notFound } from 'next/navigation';
import {
  getAvailableSurahIds, getSurahMeta, getSurahText, getSurahTimings,
} from '@/lib/data/loaders';
import { SurahClient } from './SurahClient';

export function generateStaticParams() {
  return getAvailableSurahIds().map(id => ({ id: String(id) }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const meta = getSurahMeta(Number(id));
  if (!meta) return {};
  return {
    title: `Surah ${meta.nameSimple} — listen and follow word by word`,
    description: `Listen to Surah ${meta.nameSimple} (${meta.nameEnglish}) recited by AbdulBaset AbdulSamad, with each word highlighted as it is recited.`,
  };
}

export default async function SurahPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const surahId = Number(id);
  const meta = getSurahMeta(surahId);
  if (!meta || !meta.available) notFound();

  return (
    <SurahClient
      meta={meta}
      text={getSurahText(surahId)}
      timings={getSurahTimings(surahId)}
    />
  );
}
