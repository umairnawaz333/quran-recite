import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">Surah not available yet</h1>
      <p className="text-neutral-500">
        This surah&apos;s recitation data has not been added yet.
      </p>
      <Link href="/" className="text-neutral-900 underline">Back to all surahs</Link>
    </main>
  );
}
