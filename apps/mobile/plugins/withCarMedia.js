const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

const SERVICE = 'expo.modules.audio.service.AudioControlsService';
const ACTIONS = ['androidx.media3.session.MediaLibraryService', 'android.media.browse.MediaBrowserService'];
const AUTOMOTIVE_APP_DESC = `<?xml version="1.0" encoding="utf-8"?>
<automotiveApp>
  <uses name="media"/>
</automotiveApp>
`;

/**
 * Android Auto (and Automotive OS) find a media app by binding to a service
 * that answers the media-browser intents and by the car application
 * descriptor. The service is expo-audio's own `AudioControlsService`
 * (`node_modules/expo-audio/plugin/src/withAudio.ts`), which that plugin
 * already declares — `android:exported="false"` and a single intent filter
 * for `androidx.media3.session.MediaSessionService` — because a same-process
 * media session controller (the notification, the lock screen) doesn't need
 * cross-process binding. Android Auto/Automotive binds from a *different*
 * process (the car head unit / Android Auto app), so the service has to be
 * exported, and it has to additionally answer the media-browser actions.
 * This plugin flips that existing declaration rather than owning a separate
 * one — a second `<service>` entry with the same `android:name` would just
 * collide at manifest merge time.
 *
 * Registration order in `app.json`: this plugin must be listed BEFORE
 * `expo-audio`, not after. `@expo/config-plugins` composes manifest mods by
 * wrapping each newly-registered action *around* the ones already
 * registered (`withMod`/`withBaseMod` in `@expo/config-plugins`), so at
 * evaluation time the LAST-registered plugin's manifest callback actually
 * runs FIRST (right after the base mod reads the manifest off disk), and
 * the FIRST-registered plugin's callback runs LAST. Listing this plugin
 * after `expo-audio` would therefore make it run *before* expo-audio has
 * declared the service — this plugin would create a bare entry, and
 * expo-audio's `toggleService` (which only pushes when no entry of that
 * name exists yet) would then see one already there and skip, silently
 * dropping the `MediaSessionService` intent filter. Verified empirically
 * via `expo prebuild`: with this plugin listed before `expo-audio` in
 * `app.json`, the generated manifest carries all three intent filters
 * (`MediaSessionService`, `MediaLibraryService`, `MediaBrowserService`) on
 * one exported entry; listed after, the `MediaSessionService` filter is
 * lost.
 *
 * Idempotent: prebuild may run it over an already-modified tree.
 */
function addCarMediaToManifest(androidManifest) {
  const app = androidManifest.manifest.application[0];
  app.service = app.service ?? [];
  let service = app.service.find(s => s.$['android:name'] === SERVICE);
  if (!service) {
    // expo-audio hasn't declared it in this manifest (e.g. background
    // playback disabled, or it's only in expo-audio's library manifest,
    // which Gradle merges in later) — declare it fresh, already exported.
    service = { $: { 'android:name': SERVICE, 'android:exported': 'true', 'android:foregroundServiceType': 'mediaPlayback' } };
    app.service.push(service);
  } else {
    // expo-audio declared this for in-process media-session control only —
    // widen it for the car, which binds cross-process.
    service.$['android:exported'] = 'true';
    if (!service.$['android:foregroundServiceType']) {
      service.$['android:foregroundServiceType'] = 'mediaPlayback';
    }
  }
  service['intent-filter'] = service['intent-filter'] ?? [];
  for (const name of ACTIONS) {
    const present = service['intent-filter'].some(f => f.action?.some(a => a.$['android:name'] === name));
    if (!present) service['intent-filter'].push({ action: [{ $: { 'android:name': name } }] });
  }
  app['meta-data'] = app['meta-data'] ?? [];
  if (!app['meta-data'].some(m => m.$['android:name'] === 'com.google.android.gms.car.application')) {
    app['meta-data'].push({ $: { 'android:name': 'com.google.android.gms.car.application', 'android:resource': '@xml/automotive_app_desc' } });
  }
  return androidManifest;
}

function withCarMedia(config) {
  config = withAndroidManifest(config, c => { c.modResults = addCarMediaToManifest(c.modResults); return c; });
  return withDangerousMod(config, ['android', async c => {
    const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'automotive_app_desc.xml'), AUTOMOTIVE_APP_DESC);
    return c;
  }]);
}

module.exports = withCarMedia;
module.exports.addCarMediaToManifest = addCarMediaToManifest;
module.exports.AUTOMOTIVE_APP_DESC = AUTOMOTIVE_APP_DESC;
