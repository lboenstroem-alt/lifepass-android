// Camera for the Scan tab, meal photos and barcodes (stub; owner: CHECKIN-1).
//
// expo-camera's own Android manifest already declares CAMERA. CHECKIN-1 adds
// the `expo-camera` plugin entry here if it needs one (set
// `recordAudioAndroid: false`: LifePass never records video, and the plugin
// otherwise adds RECORD_AUDIO).
module.exports = function camera(config) {
  return config;
};
