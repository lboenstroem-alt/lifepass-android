// Photo Picker for meal photos (owner: MEAL-3).
//
// NO PLUGIN, ON PURPOSE. Photo mode's "Choose a photo" opens the system Photo
// Picker through expo-image-picker (on Android 13 and later the system
// picker; on older phones the same picker from Google Play services, which
// the library's own manifest declares). Neither needs a media permission.
//
// expo-image-picker's config plugin would add nothing Android needs and one
// thing it must not touch: it adds RECORD_AUDIO unless told
// `microphonePermission: false`, and that setting BLOCKS RECORD_AUDIO for the
// whole app, which would break Coach dictation (config/fragments/speech.js).
// Its iOS purpose strings are not needed either. So the library is used
// without its plugin.
//
// The library's manifest also asks for READ_EXTERNAL_STORAGE and
// WRITE_EXTERNAL_STORAGE; app.json `android.blockedPermissions` removes both
// (with READ_MEDIA_IMAGES, READ_MEDIA_VIDEO and READ_MEDIA_VISUAL_USER_SELECTED),
// so no library can add them back. Its CAMERA entry is the one the Scan tab
// and the meal camera already hold (config/fragments/camera.js).
module.exports = function imagePicker(config) {
  return config;
};
