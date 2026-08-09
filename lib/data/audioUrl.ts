/**
 * Single point of resolution for ayah audio.
 *
 * The full recitation is ~3 GB — too large for a Git repository and larger
 * than a Vercel deployment accepts — so the audio lives in object storage and
 * is served from a CDN. The JSON in `data/` stores a root-relative path like
 * `/audio/abdulbasit-murattal/001001.mp3`; this function decides what that
 * path actually resolves to.
 *
 * With NEXT_PUBLIC_AUDIO_BASE_URL set, the file is fetched from that origin
 * by FILENAME ALONE — the stored directory prefix is dropped. Filenames are
 * `SSSAAA.mp3` (3-digit surah, 3-digit ayah), which is globally unique, and
 * flat stores such as GitHub release assets cannot express directories.
 *
 * Without the variable, paths stay root-relative and are served from
 * `public/audio`, so a local checkout with fetched audio needs no config.
 */

const BASE = process.env.NEXT_PUBLIC_AUDIO_BASE_URL?.trim().replace(/\/+$/, '');

export function resolveAudioUrl(rawUrl: string): string {
  if (!BASE) return rawUrl;

  // Already absolute — leave it alone rather than double-prefixing.
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;

  const filename = rawUrl.split('/').pop();
  if (!filename) return rawUrl;

  return `${BASE}/${filename}`;
}
