import manifest from '@quran/data/audio-sizes.json';

interface Manifest {
  reciterId: string;
  totalBytes: number;
  totalFiles: number;
  surahs: Record<string, { bytes: number; files: number }>;
}
const sizes = manifest as Manifest;

/** Bytes and file count of one surah's recitation, from the build-time manifest. */
export function surahAudioSize(surahId: number): { bytes: number; files: number } {
  return sizes.surahs[String(surahId)] ?? { bytes: 0, files: 0 };
}

export function allAudioSize(): { bytes: number; files: number } {
  return { bytes: sizes.totalBytes, files: sizes.totalFiles };
}

/** "0.9 MB", "222 MB", "2.5 GB" — one decimal under 10, none above. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 MB';
  const gb = bytes / 1e9;
  if (gb >= 1) return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
  const mb = bytes / 1e6;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
