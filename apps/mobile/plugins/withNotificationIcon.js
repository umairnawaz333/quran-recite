const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

/**
 * Ships the app's status-bar / notification icon as `@drawable/notification_icon`.
 *
 * Android draws a notification's small icon as an alpha mask — white in the
 * status bar, tinted by the notification's colour in the shade — so it has
 * to be a single-colour silhouette, not the coloured launcher icon (which
 * Android would flatten into a plain white square: the "plain icon" the
 * status bar showed). expo-audio's playback notification is patched
 * (`patches/expo-audio+*.patch`) to pick up this drawable by name whenever
 * the app provides one, so this plugin is what makes the media notification
 * carry the app's mark instead of media3's generic play circle.
 *
 * The PNGs come from `design/logo/generate.py` (one per density bucket,
 * 24 dp: 24 / 36 / 48 / 72 / 96 px), and are copied into
 * `android/app/src/main/res/drawable-<density>/` at prebuild time. A
 * config plugin rather than checked-in `res/` files because `android/` is
 * generated and git-ignored.
 */
const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];

module.exports = function withNotificationIcon(config, { dir = './assets/notification' } = {}) {
  return withDangerousMod(config, [
    'android',
    async config => {
      const res = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res');
      for (const density of DENSITIES) {
        const src = path.join(config.modRequest.projectRoot, dir, `notification_icon-${density}.png`);
        if (!fs.existsSync(src)) throw new Error(`withNotificationIcon: missing ${src} — run design/logo/generate.py`);
        const out = path.join(res, `drawable-${density}`);
        fs.mkdirSync(out, { recursive: true });
        fs.copyFileSync(src, path.join(out, 'notification_icon.png'));
      }
      return config;
    },
  ]);
};
