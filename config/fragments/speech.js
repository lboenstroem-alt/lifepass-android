// Coach dictation (owner: COACH-1, D12: on-device where supported, else the
// system recognizer, en-US).
//
// The plugin adds RECORD_AUDIO and the <queries> entry Android 11+ needs to
// see Google's speech service. It also writes iOS Info.plist strings, which
// `androidOnly` drops: no iOS build is ever made from this repo.
const { androidOnly, withPlugin } = require('./_plugins');
const withSpeechRecognition = require('expo-speech-recognition/app.plugin');

module.exports = function speech(config) {
  return withPlugin(config, [
    androidOnly(withSpeechRecognition, 'expo-speech-recognition'),
    { androidSpeechServicePackages: ['com.google.android.googlequicksearchbox'] },
  ]);
};
