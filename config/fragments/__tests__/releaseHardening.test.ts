/**
 * The release-hardening fragment (REL-1): unused exported or foreground
 * components come out of the merged manifest, microphone and location
 * hardware are optional for Google Play, and large screens keep the portrait
 * phone layout while the app targets API 36.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const releaseHardening = require('../releaseHardening') as ((config: Record<string, unknown>) => Record<string, any>) & {
  REMOVED_COMPONENTS: { tag: string; name: string }[];
  OPTIONAL_FEATURES: string[];
  RESTRICTED_RESIZABILITY: string;
  harden: (manifest: Record<string, any>) => Record<string, any>;
};
const buildProperties = require('../buildProperties') as { ANDROID_SDK: { targetSdkVersion: number } };
/* eslint-enable @typescript-eslint/no-require-imports */

const BASE = {
  $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
  'uses-feature': [{ $: { 'android:name': 'android.hardware.camera', 'android:required': 'false' } }],
  application: [
    {
      $: { 'android:name': '.MainApplication' },
      activity: [{ $: { 'android:name': '.MainActivity', 'android:exported': 'true' } }],
      'meta-data': [{ $: { 'android:name': 'expo.modules.updates.ENABLED', 'android:value': 'false' } }],
    },
  ],
};

it('registers one plugin and leaves the rest of the config alone', () => {
  const config = releaseHardening({ name: 'LifePass', plugins: ['expo-font'] });
  expect(config.plugins).toHaveLength(2);
  expect(config.plugins[0]).toBe('expo-font');
  expect(config.name).toBe('LifePass');
});

it('removes the unused location service, the cropper and the Compose preview activity', () => {
  const manifest = releaseHardening.harden(BASE);
  expect(manifest.$['xmlns:tools']).toBe('http://schemas.android.com/tools');
  const application = manifest.application[0];
  expect(application.service).toEqual([
    { $: { 'android:name': 'expo.modules.location.services.LocationTaskService', 'tools:node': 'remove' } },
  ]);
  expect(application.activity).toEqual([
    { $: { 'android:name': '.MainActivity', 'android:exported': 'true' } },
    { $: { 'android:name': 'com.canhub.cropper.CropImageActivity', 'tools:node': 'remove' } },
    { $: { 'android:name': 'androidx.compose.ui.tooling.PreviewActivity', 'tools:node': 'remove' } },
  ]);
  expect(application['meta-data']).toEqual(BASE.application[0]['meta-data']);
  expect(application.$).toEqual(BASE.application[0].$);
});

it('declares microphone and location hardware optional, keeping the camera entries', () => {
  const features = releaseHardening.harden(BASE)['uses-feature'];
  expect(features).toEqual([
    { $: { 'android:name': 'android.hardware.camera', 'android:required': 'false' } },
    ...releaseHardening.OPTIONAL_FEATURES.map((name) => ({ $: { 'android:name': name, 'android:required': 'false' } })),
  ]);
});

it('keeps the portrait phone layout on large screens, which Android honours only at target API 36', () => {
  const application = releaseHardening.harden(BASE).application[0];
  expect(application.property).toEqual([{ $: { 'android:name': releaseHardening.RESTRICTED_RESIZABILITY, 'android:value': 'true' } }]);
  // Raising the target ends the opt-out: that change needs a large-screen layout first.
  expect(buildProperties.ANDROID_SDK.targetSdkVersion).toBe(36);
});

it('is idempotent, so a second prebuild adds nothing twice', () => {
  const once = releaseHardening.harden(BASE);
  expect(releaseHardening.harden(once)).toEqual(once);
});
