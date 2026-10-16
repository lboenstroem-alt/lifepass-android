// Camera for the Scan tab, meal photos and barcodes (stub; owner: CHECKIN-1).
//
// expo-camera's own Android manifest declares CAMERA, and RECORD_AUDIO as
// well, so the app has the microphone permission whatever this fragment says.
// That is fine: Coach dictation needs RECORD_AUDIO (config/fragments/speech.js,
// app.json). The plugin's `recordAudioAndroid: false` only stops the plugin
// adding it again; it does not remove the library's declaration. Only
// `blockedPermissions` could, and it must not, because dictation would break.
// CHECKIN-1 adds the `expo-camera` plugin entry here if it needs one.
module.exports = function camera(config) {
  return config;
};
