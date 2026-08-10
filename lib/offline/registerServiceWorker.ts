/**
 * Registers the audio cache worker. Returns null rather than throwing when
 * service workers are unavailable — private browsing, an insecure context, or
 * a browser that does not support them. The app works without caching; it must
 * not fail to load because of it.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}
