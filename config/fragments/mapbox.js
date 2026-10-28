// @rnmapbox/maps: the Explore map (owner: F0; runtime use: EXPL-2, ATTR-2).
//
// Tokens (both live in the Mapbox account, both are EAS environment variables,
// neither is ever committed):
//   MAPBOX_DOWNLOAD_TOKEN     secret `sk.` token, scope Downloads:Read, for
//                             Gradle to fetch the native Mapbox SDK. Mapbox has
//                             since dropped the requirement, so a build without
//                             it still works; when it is set, it is used.
//   EXPO_PUBLIC_MAPBOX_TOKEN  public `pk.` token, read at RUNTIME
//                             (`env.mapboxToken`, src/config/env.ts) and handed
//                             to Mapbox.setAccessToken(). Restricted to this app.
// Use the Android tokens, never the iOS one RELEASE-2.5.0 says to revoke.
//
// WHY NOT THE PLUGIN'S `RNMapboxMapsDownloadToken` OPTION. Plugin options are
// part of the public app config, which Expo embeds in the app itself
// (expo-constants), so the secret token would ship inside every APK. Here the
// token goes only into the generated android/gradle.properties during
// prebuild, a file that is never committed and never bundled.
const { withGradleProperties } = require('expo/config-plugins');

const { withPlugin } = require('./_plugins');

const GRADLE_KEY = 'MAPBOX_DOWNLOADS_TOKEN';

function withMapboxDownloadToken(config) {
  const token = process.env.MAPBOX_DOWNLOAD_TOKEN;
  if (!token) return config;
  return withGradleProperties(config, (gradle) => {
    gradle.modResults = gradle.modResults.filter(
      (item) => !(item.type === 'property' && item.key === GRADLE_KEY),
    );
    gradle.modResults.push({ type: 'property', key: GRADLE_KEY, value: token });
    return gradle;
  });
}

module.exports = function mapbox(config) {
  return withPlugin(withPlugin(config, '@rnmapbox/maps'), withMapboxDownloadToken);
};

module.exports.GRADLE_KEY = GRADLE_KEY;
