// Photo Picker for meal photos (stub; owner: MEAL-3).
//
// LifePass uses the system Photo Picker, which needs no storage permission.
// READ_MEDIA_IMAGES, READ_MEDIA_VIDEO and READ_EXTERNAL_STORAGE are listed in
// app.json `android.blockedPermissions`, so no library can add them back.
// MEAL-3 adds the `expo-image-picker` plugin entry here if it needs one.
module.exports = function imagePicker(config) {
  return config;
};
