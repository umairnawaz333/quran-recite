/**
 * Single point of resolution for ayah audio.
 *
 * Today every file is committed under public/audio and the stored path is used
 * verbatim. If large surahs later move to external object storage, this is the
 * only function that changes.
 */
export function resolveAudioUrl(rawUrl: string): string {
  return rawUrl;
}
