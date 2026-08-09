/**
 * Single point of resolution for ayah audio.
 *
 * The full recitation is ~3 GB — too large for a Git repository and larger
 * than a Vercel deployment accepts — so the audio lives in object storage and
 * is served from a CDN. The JSON in `data/` stores a root-relative path like
 * `/audio/abdulbasit-murattal/001001.mp3`; this function decides what that
 * path actually resolves to.
 *
 * With NEXT_PUBLIC_AUDIO_BASE_URL set, paths are rewritten to that origin.
 * Without it, they stay root-relative and are served from `public/audio`,
 * so a local checkout with fetched audio still works with no configuration.
 */

const BASE = process.env.NEXT_PUBLIC_AUDIO_BASE_URL?.trim().replace(/\/+$/, '');

export function resolveAudioUrl(rawUrl: string): string {
  if (!BASE) return rawUrl;

  // Already absolute — leave it alone rather than double-prefixing.
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;

  return `${BASE}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
}
