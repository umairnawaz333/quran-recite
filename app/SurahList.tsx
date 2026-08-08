import Link from 'next/link';
import type { SurahMeta } from '@/lib/data/types';

export function SurahList({ surahs }: { surahs: SurahMeta[] }) {
  return (
    <ul className="divide-y divide-neutral-100">
      {surahs.map(surah => {
        const body = (
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-4">
              <span className="w-8 text-sm tabular-nums text-neutral-400">{surah.id}</span>
              <div>
                <div className="font-medium">{surah.nameSimple}</div>
                <div className="text-sm text-neutral-500">{surah.nameEnglish}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg" dir="rtl">{surah.nameArabic}</div>
              <div className="text-xs text-neutral-400">
                <span>{surah.ayahCount} ayahs</span>
                {!surah.available && <span> · coming soon</span>}
              </div>
            </div>
          </div>
        );

        return (
          <li key={surah.id} className={surah.available ? '' : 'opacity-40'}>
            {surah.available
              ? <Link href={`/surah/${surah.id}`} className="block hover:bg-neutral-50">{body}</Link>
              : body}
          </li>
        );
      })}
    </ul>
  );
}
