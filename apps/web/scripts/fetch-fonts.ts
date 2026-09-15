import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Google Fonts serves woff2 only when the UA looks like a modern browser. */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FONTS = [
  { family: 'Amiri Quran', file: 'amiri-quran.woff2' },
  { family: 'Noto Naskh Arabic', file: 'noto-naskh-arabic.woff2' },
];

const OUT_DIR = path.join(process.cwd(), 'public', 'fonts');

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  for (const font of FONTS) {
    const cssUrl =
      `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.family)}` +
      `&display=swap&subset=arabic`;

    const css = await fetch(cssUrl, { headers: { 'User-Agent': UA } }).then(r => {
      if (!r.ok) throw new Error(`CSS fetch failed for ${font.family}: ${r.status}`);
      return r.text();
    });

    const urls = [...css.matchAll(/url\((https:[^)]+\.woff2)\)/g)].map(m => m[1]);
    if (urls.length === 0) throw new Error(`No woff2 URL found for ${font.family}`);

    // The arabic subset is the largest; take it rather than the latin fallback.
    const buffers = await Promise.all(
      urls.map(u => fetch(u).then(r => r.arrayBuffer())),
    );
    const largest = buffers.reduce((a, b) => (b.byteLength > a.byteLength ? b : a));

    const dest = path.join(OUT_DIR, font.file);
    await writeFile(dest, Buffer.from(largest));
    console.log(`${font.family} -> ${font.file} (${(largest.byteLength / 1024).toFixed(0)} KB)`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
