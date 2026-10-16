// Native build properties (owner: F0).
//
// The SDK levels are Expo SDK 54's own defaults, written out so a change is a
// visible diff and CI can hold the line Google Play enforces: the target API
// must stay at or above 35 (Android 15). `test/config` asserts it.
// Health Connect would need minSdkVersion 26; per the owner's decision there
// is no Health Connect in this build, so the minimum stays at the default.
const { withPlugin } = require('./_plugins');

const ANDROID_SDK = {
  minSdkVersion: 24,
  compileSdkVersion: 36,
  targetSdkVersion: 36,
};

module.exports = function buildProperties(config) {
  return withPlugin(config, ['expo-build-properties', { android: { ...ANDROID_SDK } }]);
};

module.exports.ANDROID_SDK = ANDROID_SDK;
