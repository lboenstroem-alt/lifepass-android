// Manifest hardening for Google Play (owner: REL-1, from the 3.1.0
// release-readiness check, 28 Oct 2026). Libraries bring manifest entries the
// app never uses; this fragment takes them back out and says which hardware
// the app can live without.
//
// REMOVED COMPONENTS (tools:node="remove", applied when Gradle merges the
// library manifests):
// - expo-location's LocationTaskService. It is a foreground service of type
//   "location", for background location tasks. LifePass only ever asks for
//   one position while the app is open (src/stores/locationStore.ts), so the
//   service is never started; declaring it only invites Play's foreground
//   service declaration. expo-location's plugin options add permissions but
//   cannot remove the service, hence the manifest edit.
// - The image cropper's CropImageActivity (expo-image-picker). It is exported
//   with no permission, and the app never crops (`allowsEditing: false`,
//   src/features/meals/photo/pickPhoto.ts).
// - Compose's PreviewActivity, which expo-dev-launcher and expo-dev-menu pull
//   into every variant through ui-tooling. It is exported with no permission
//   and only serves Android Studio previews.
//
// OPTIONAL HARDWARE. Asking for RECORD_AUDIO and the location permissions
// makes Google Play assume the app needs a microphone and location hardware
// and hide it from devices without them. Dictation hides its button when no
// recognizer is there, and location is optional everywhere, so all four
// features are declared optional, as camera.js does for the camera.
//
// LARGE SCREENS. For apps targeting API 36, Android 16 ignores the portrait
// lock on displays 600 dp and wider, so on a tablet or an unfolded foldable
// the phone layout would be stretched to landscape. Until a tablet layout
// exists, PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY keeps the portrait
// phone layout there (letterboxed). Android honours it only while the app
// targets API 36: raising the target to 37 needs a real large-screen layout.
const { withAndroidManifest } = require('expo/config-plugins');

const { withPlugin } = require('./_plugins');

const REMOVED_COMPONENTS = [
  { tag: 'service', name: 'expo.modules.location.services.LocationTaskService' },
  { tag: 'activity', name: 'com.canhub.cropper.CropImageActivity' },
  { tag: 'activity', name: 'androidx.compose.ui.tooling.PreviewActivity' },
];

const OPTIONAL_FEATURES = [
  'android.hardware.microphone',
  'android.hardware.location',
  'android.hardware.location.gps',
  'android.hardware.location.network',
];

const RESTRICTED_RESIZABILITY = 'android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY';

/** The manifest with the hardening applied; safe to run more than once. */
function harden(manifest) {
  const features = (manifest['uses-feature'] ?? []).filter(
    (feature) => !OPTIONAL_FEATURES.includes(feature?.$?.['android:name']),
  );
  for (const name of OPTIONAL_FEATURES) {
    features.push({ $: { 'android:name': name, 'android:required': 'false' } });
  }

  const application = { ...(manifest.application?.[0] ?? { $: {} }) };
  for (const { tag, name } of REMOVED_COMPONENTS) {
    const others = (application[tag] ?? []).filter((entry) => entry?.$?.['android:name'] !== name);
    application[tag] = [...others, { $: { 'android:name': name, 'tools:node': 'remove' } }];
  }
  const properties = (application.property ?? []).filter((p) => p?.$?.['android:name'] !== RESTRICTED_RESIZABILITY);
  application.property = [...properties, { $: { 'android:name': RESTRICTED_RESIZABILITY, 'android:value': 'true' } }];

  return {
    ...manifest,
    $: { ...manifest.$, 'xmlns:tools': 'http://schemas.android.com/tools' },
    'uses-feature': features,
    application: [application, ...(manifest.application ?? []).slice(1)],
  };
}

function withReleaseHardening(config) {
  return withAndroidManifest(config, (mod) => {
    mod.modResults.manifest = harden(mod.modResults.manifest);
    return mod;
  });
}

module.exports = function releaseHardening(config) {
  return withPlugin(config, withReleaseHardening);
};

module.exports.REMOVED_COMPONENTS = REMOVED_COMPONENTS;
module.exports.OPTIONAL_FEATURES = OPTIONAL_FEATURES;
module.exports.RESTRICTED_RESIZABILITY = RESTRICTED_RESIZABILITY;
module.exports.harden = harden;
