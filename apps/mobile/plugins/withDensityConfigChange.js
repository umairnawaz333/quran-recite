const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Adds `density` to `MainActivity`'s `android:configChanges`.
 *
 * Expo's generated manifest already lists
 * `keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|smallestScreenSize|assetsPaths`,
 * which covers a fold, an unfold and a rotation on their own — but not a
 * *density* change. Emulator testing for Task 13 (`wm size` + `wm density`
 * together, standing in for a foldable AVD) showed that combination forces
 * Android to destroy and recreate the activity — "finishDrawing of relaunch"
 * in `dumpsys`/logcat — because density isn't in that list. That tears down
 * the whole JS context, and with it the live `AyahSequencer`/`SyncEngine`
 * pair in `PlayerProvider`: exactly the "fold restarts playback" failure
 * Task 13 exists to prevent. Real foldables can change density across a
 * fold (switching which physical panel is driving the app), so this closes
 * the gap rather than relying on size/layout coverage alone.
 *
 * `app.json` is plain JSON and has no field for extra `configChanges`
 * flags, so this runs as a config plugin (referenced from `app.json`'s
 * `plugins` array) at prebuild time instead.
 */
module.exports = function withDensityConfigChange(config) {
  return withAndroidManifest(config, config => {
    const application = config.modResults.manifest.application?.[0];
    const activity = application?.activity?.find(
      a => a.$?.['android:name'] === '.MainActivity',
    );
    if (activity) {
      const key = 'android:configChanges';
      const parts = (activity.$[key] ?? '').split('|').filter(Boolean);
      if (!parts.includes('density')) parts.push('density');
      activity.$[key] = parts.join('|');
    }
    return config;
  });
};
