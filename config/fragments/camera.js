// Camera for the Scan tab, meal photos and barcodes (owner: CHECKIN-1).
//
// THE PLUGIN. `expo-camera` adds CAMERA to the manifest. `recordAudioAndroid:
// false` stops it adding RECORD_AUDIO as well: the scanner never records
// sound. expo-camera's own library manifest still declares RECORD_AUDIO, so
// the app keeps the microphone permission whatever this says. That is fine:
// Coach dictation needs it (config/fragments/speech.js, app.json). Only
// `blockedPermissions` could remove it, and it must not, or dictation breaks.
// The iOS purpose string the plugin also writes is dropped by `androidOnly`.
//
// THE CAMERA IS NOT REQUIRED. Asking for CAMERA makes Google Play assume the
// app needs a camera, and hide it from phones and tablets without one, unless
// the manifest says otherwise. LifePass works without one: the Scan tab says
// "The camera isn't available on this device" (iOS `.unavailable`) and meals
// can still be logged by search. So both camera features are declared
// optional.
const { withAndroidManifest } = require('expo/config-plugins');
const withCamera = require('expo-camera/plugin/build/withCamera').default;

const { androidOnly, withPlugin } = require('./_plugins');

/** Hardware the app can use but does not need (Play filtering). */
const OPTIONAL_FEATURES = ['android.hardware.camera', 'android.hardware.camera.autofocus'];

/** The manifest with both camera features declared optional (any earlier declaration of them replaced). */
function withOptionalFeatures(manifest) {
  const features = (manifest['uses-feature'] ?? []).filter(
    (feature) => !OPTIONAL_FEATURES.includes(feature?.$?.['android:name']),
  );
  for (const name of OPTIONAL_FEATURES) {
    features.push({ $: { 'android:name': name, 'android:required': 'false' } });
  }
  return { ...manifest, 'uses-feature': features };
}

function withOptionalCameraFeatures(config) {
  return withAndroidManifest(config, (mod) => {
    mod.modResults.manifest = withOptionalFeatures(mod.modResults.manifest);
    return mod;
  });
}

module.exports = function camera(config) {
  const withScanner = withPlugin(config, [androidOnly(withCamera, 'expo-camera'), { recordAudioAndroid: false }]);
  return withPlugin(withScanner, withOptionalCameraFeatures);
};

module.exports.OPTIONAL_FEATURES = OPTIONAL_FEATURES;
module.exports.withOptionalFeatures = withOptionalFeatures;
