import type { Metadata } from 'next';
import { OfflineBanner } from '@/components/OfflineBanner';
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
        {children}
      </body>
    </html>
  );
}
