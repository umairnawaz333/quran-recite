/**
 * Single point of resolution for ayah audio.
 *
 * The full recitation is ~3 GB — too large for a Git repository and larger
 * than a Vercel deployment accepts — so the audio lives in object storage and
 * is served from a CDN. The JSON in `data/` stores a root-relative path like
 * `/audio/abdulbasit-murattal/001001.mp3`; this function decides what that
 * path actually resolves to.
 *
 * With a base configured via `configureAudioBase`, the file is fetched from a
 * per-surah GitHub Release. GitHub caps a release at 1000 assets and the
 * recitation has 6,236 files, so the audio is sharded one release per surah,
 * tagged `audio-001` … `audio-114`.
 *
 * Filenames are `SSSAAA.mp3` — 3-digit surah, 3-digit ayah — so the shard is
 * derivable from the filename itself and needs no lookup table:
 *
 *   /audio/abdulbasit-murattal/002255.mp3
 *     -> {base}/audio-002/002255.mp3
 *
 * With no base configured, paths stay root-relative and are served from
 * `public/audio`, so a local checkout with fetched audio needs no config.
 * Each host decides what to configure and how — the web passes in
 * `NEXT_PUBLIC_AUDIO_BASE_URL` from `PlayerProvider.tsx`; this package has no
 * opinion on environment variables or build-time substitution.
 */

/**
 * The base every audio path is resolved against, supplied by the host rather
 * than read from the environment.
 *
 * This used to be a module-scope `process.env.NEXT_PUBLIC_AUDIO_BASE_URL`
 * read, which is why sub-project A could not use this file off the web: React
 * Native ships a `process` shim, so the variable was simply `undefined` and
 * every path silently fell back to a root-relative one that means nothing on
 * a native client. Reading it at call time also removes the `vi.resetModules()`
 * the tests needed to vary it.
 */
let base: string | undefined;

export function configureAudioBase(value: string | undefined): void {
  base = value?.trim().replace(/\/+$/, '') || undefined;
}

/** `SSSAAA.mp3` — the first three digits are the surah number. */
const AUDIO_FILENAME = /^(\d{3})\d{3}\.mp3$/;

export function resolveAudioUrl(rawUrl: string): string {
  if (!base) return rawUrl;

  // Already absolute — leave it alone rather than double-prefixing.
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;

  const filename = rawUrl.split('/').pop();
  if (!filename) return rawUrl;

  const match = AUDIO_FILENAME.exec(filename);
  // An unexpected filename means the shard cannot be derived. Fall back to the
  // local path rather than building a URL that is certainly wrong.
  if (!match) return rawUrl;

  return `${base}/audio-${match[1]}/${filename}`;
}
