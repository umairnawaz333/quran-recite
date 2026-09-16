import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Google Fonts serves woff2 only when the UA looks like a modern browser. */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * An old, pre-woff2-era UA. Google Fonts falls back to serving TTF to
 * browsers this old — that's how we get a format React Native can load,
 * without hardcoding the hashed font URLs (which change on font revisions).
 */
const LEGACY_UA = 'Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.34 (KHTML, like Gecko)';

const FONTS = [
  { family: 'Amiri Quran', woff2File: 'amiri-quran.woff2', ttfFile: 'amiri-quran.ttf' },
  { family: 'Noto Naskh Arabic', woff2File: 'noto-naskh-arabic.woff2', ttfFile: 'noto-naskh-arabic.ttf' },
];

const WEB_OUT_DIR = path.join(process.cwd(), 'public', 'fonts');
const MOBILE_OUT_DIR = path.join(process.cwd(), '..', 'mobile', 'assets', 'fonts');

async function fetchLargestVariant(cssUrl: string, ua: string, format: 'woff2' | 'ttf', family: string) {
  const css = await fetch(cssUrl, { headers: { 'User-Agent': ua } }).then(r => {
    if (!r.ok) throw new Error(`CSS fetch failed for ${family} (${format}): ${r.status}`);
    return r.text();
  });

  const pattern = format === 'woff2' ? /url\((https:[^)]+\.woff2)\)/g : /url\((https:[^)]+\.ttf)\)/g;
  const urls = [...css.matchAll(pattern)].map(m => m[1]);
  if (urls.length === 0) throw new Error(`No ${format} URL found for ${family}`);

  // The arabic subset is the largest; take it rather than the latin fallback.
  const buffers = await Promise.all(
    urls.map(u => fetch(u).then(r => r.arrayBuffer())),
  );
  return buffers.reduce((a, b) => (b.byteLength > a.byteLength ? b : a));
}

async function main() {
  await mkdir(WEB_OUT_DIR, { recursive: true });
  await mkdir(MOBILE_OUT_DIR, { recursive: true });

  for (const font of FONTS) {
    const cssUrl =
      `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.family)}` +
      `&display=swap&subset=arabic`;

    const woff2 = await fetchLargestVariant(cssUrl, UA, 'woff2', font.family);
    const woff2Dest = path.join(WEB_OUT_DIR, font.woff2File);
    await writeFile(woff2Dest, Buffer.from(woff2));
    console.log(`${font.family} -> ${font.woff2File} (${(woff2.byteLength / 1024).toFixed(0)} KB)`);

    // React Native cannot load woff2; expo-font needs ttf/otf. Bundled as an
    // app asset (never fetched at runtime — see apps/mobile/src/reader/fonts.ts).
    const ttf = await fetchLargestVariant(cssUrl, LEGACY_UA, 'ttf', font.family);
    const ttfDest = path.join(MOBILE_OUT_DIR, font.ttfFile);
    await writeFile(ttfDest, Buffer.from(ttf));
    console.log(`${font.family} -> ${font.ttfFile} (${(ttf.byteLength / 1024).toFixed(0)} KB)`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
