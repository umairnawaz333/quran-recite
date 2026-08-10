import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerServiceWorker } from '../registerServiceWorker';

afterEach(() => { vi.unstubAllGlobals(); });

describe('registerServiceWorker', () => {
  it('returns null when service workers are unsupported', async () => {
    vi.stubGlobal('navigator', {});
    expect(await registerServiceWorker()).toBeNull();
  });

  it('registers sw.js at the root scope', async () => {
    const register = vi.fn().mockResolvedValue({ scope: '/' });
    vi.stubGlobal('navigator', { serviceWorker: { register } });

    const reg = await registerServiceWorker();
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(reg).toEqual({ scope: '/' });
  });

  // A blocked worker (private browsing, insecure context) must degrade to
  // "no caching", never crash the app.
  it('returns null when registration rejects', async () => {
    const register = vi.fn().mockRejectedValue(new Error('blocked'));
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    expect(await registerServiceWorker()).toBeNull();
  });
});
