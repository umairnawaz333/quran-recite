// Walks the locally fetched audio (apps/web/public/audio/<reciter>/SSSAAA.mp3)
// and writes audio-sizes.json: per-surah bytes and file counts, plus totals.
// Run from the repo root: `npm run build:audio-sizes`. Requires the audio to
// be present locally (`npm run fetch:data -- --surahs=1-114`); the UI reads
// this manifest so it can say "222 MB" before a download starts instead of
// issuing 286 HEAD requests to learn what this script already knows.
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RECITER = process.argv[2] ?? 'abdulbasit-murattal';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const audioDir = path.resolve(root, '../../apps/web/public/audio', RECITER);
const out = path.join(root, 'audio-sizes.json');

const files = readdirSync(audioDir).filter(f => /^\d{6}\.mp3$/.test(f));
if (files.length === 0) {
  console.error(`No audio files in ${audioDir}. Fetch them first: npm run fetch:data -- --surahs=1-114`);
  process.exit(1);
}

const surahs = {};
let totalBytes = 0;
for (const f of files) {
  const surah = String(Number(f.slice(0, 3)));
  const bytes = statSync(path.join(audioDir, f)).size;
  surahs[surah] ??= { bytes: 0, files: 0 };
  surahs[surah].bytes += bytes;
  surahs[surah].files += 1;
  totalBytes += bytes;
}

const manifest = {
  reciterId: RECITER,
  generatedAt: new Date().toISOString().slice(0, 10),
  totalBytes,
  totalFiles: files.length,
  surahs,
};
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${out}: ${files.length} files, ${(totalBytes / 1e9).toFixed(2)} GB across ${Object.keys(surahs).length} surahs`);
