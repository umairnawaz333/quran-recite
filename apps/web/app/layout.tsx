import type { Metadata } from 'next';
import { OfflineBanner } from '@/components/OfflineBanner';
import { PlayerProvider } from '@/components/player/PlayerProvider';
import { PlayerBar } from '@/components/player/PlayerBar';
import { FollowPlayingSurah } from '@/components/player/FollowPlayingSurah';
import './globals.css';

export const metadata: Metadata = {
  title: 'Quran',
  description: 'Listen to the Quran and follow every word.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <OfflineBanner />
        {/* The provider lives here so audio survives client-side navigation. */}
        <PlayerProvider>
          {children}
          <PlayerBar />
          <FollowPlayingSurah />
        </PlayerProvider>
      </body>
    </html>
  );
}
