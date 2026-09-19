import { describe, expect, it } from 'vitest';
import { addCarMediaToManifest, AUTOMOTIVE_APP_DESC } from '../plugins/withCarMedia';

const manifest = () => ({
  manifest: {
    application: [
      {
        $: { 'android:name': '.MainApplication' },
        service: [
          {
            $: {
              'android:name': 'expo.modules.audio.service.AudioControlsService',
              'android:exported': 'false',
              'android:foregroundServiceType': 'mediaPlayback',
            },
            'intent-filter': [
              { action: [{ $: { 'android:name': 'androidx.media3.session.MediaSessionService' } }] },
            ],
          },
        ],
      },
    ],
  },
});

describe('withCarMedia', () => {
  it("adds the two browser intent filters to expo-audio's service, once", () => {
    const m = addCarMediaToManifest(addCarMediaToManifest(manifest()));
    const svc = m.manifest.application[0].service[0];
    const actions = svc['intent-filter'].flatMap((f: { action: { $: Record<string, string> }[] }) =>
      f.action.map(a => a.$['android:name']),
    );
    expect(actions).toEqual([
      'androidx.media3.session.MediaSessionService',
      'androidx.media3.session.MediaLibraryService',
      'android.media.browse.MediaBrowserService',
    ]);
  });

  it('exports a service expo-audio declared as not exported and keeps its MediaSessionService filter', () => {
    const m = addCarMediaToManifest(manifest());
    const svc = m.manifest.application[0].service[0];
    expect(svc.$['android:exported']).toBe('true');
    expect(svc.$['android:foregroundServiceType']).toBe('mediaPlayback');
    const actions = svc['intent-filter'].flatMap((f: { action: { $: Record<string, string> }[] }) =>
      f.action.map(a => a.$['android:name']),
    );
    expect(actions).toContain('androidx.media3.session.MediaSessionService');
    expect(actions.filter((a: string) => a === 'androidx.media3.session.MediaSessionService')).toHaveLength(1);
  });

  it('declares the car application descriptor once', () => {
    const m = addCarMediaToManifest(addCarMediaToManifest(manifest()));
    const meta = m.manifest.application[0]['meta-data'].filter(
      (x: { $: Record<string, string> }) => x.$['android:name'] === 'com.google.android.gms.car.application',
    );
    expect(meta).toHaveLength(1);
    expect(meta[0].$['android:resource']).toBe('@xml/automotive_app_desc');
  });

  it('the descriptor declares a media app', () => {
    expect(AUTOMOTIVE_APP_DESC).toContain('<uses name="media"/>');
  });

  it("declares expo-audio's service itself when the app manifest has none (the library manifest is merged later by Gradle)", () => {
    const m = addCarMediaToManifest({ manifest: { application: [{ $: {}, service: [] }] } });
    const svc = m.manifest.application[0].service.find(
      (x: { $: Record<string, string> }) => x.$['android:name'] === 'expo.modules.audio.service.AudioControlsService',
    );
    expect(svc.$['android:exported']).toBe('true');
    expect(svc.$['android:foregroundServiceType']).toBe('mediaPlayback');
    expect(svc['intent-filter']).toHaveLength(2);
  });
});
