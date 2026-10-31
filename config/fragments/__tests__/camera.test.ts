/**
 * The camera fragment (CHECKIN-1): expo-camera without its microphone ask,
 * no iOS strings left behind, and the camera declared optional so Google
 * Play does not hide the app from devices without one (the Scan tab has an
 * "unavailable" state for them, as iOS has).
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const camera = require('../camera') as ((config: Record<string, unknown>) => Record<string, any>) & {
  OPTIONAL_FEATURES: string[];
  withOptionalFeatures: (manifest: Record<string, any>) => Record<string, any>;
};
/* eslint-enable @typescript-eslint/no-require-imports */

it('registers expo-camera for Android only, without RECORD_AUDIO of its own', () => {
  const config = camera({ name: 'LifePass', slug: 'lifepass-iceland', plugins: [] });
  const entry = (config.plugins as unknown[]).find((p) => Array.isArray(p)) as [{ name: string }, Record<string, unknown>];
  expect(entry[0].name).toBe('androidOnly(expo-camera)');
  expect(entry[1]).toEqual({ recordAudioAndroid: false });
  expect(config.plugins).toHaveLength(2);
});

it('declares the camera and its autofocus optional, replacing any earlier declaration', () => {
  const manifest = camera.withOptionalFeatures({
    'uses-feature': [
      { $: { 'android:name': 'android.hardware.camera', 'android:required': 'true' } },
      { $: { 'android:name': 'android.hardware.location.gps', 'android:required': 'false' } },
    ],
  });
  expect(manifest['uses-feature']).toEqual([
    { $: { 'android:name': 'android.hardware.location.gps', 'android:required': 'false' } },
    { $: { 'android:name': 'android.hardware.camera', 'android:required': 'false' } },
    { $: { 'android:name': 'android.hardware.camera.autofocus', 'android:required': 'false' } },
  ]);
  expect(camera.withOptionalFeatures({})['uses-feature']).toHaveLength(2);
});
