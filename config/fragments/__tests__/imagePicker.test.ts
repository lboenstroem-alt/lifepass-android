/**
 * The image picker fragment (MEAL-3): expo-image-picker is used without its
 * config plugin, so it never adds (or blocks) RECORD_AUDIO, and the storage
 * and media permissions its library manifest asks for stay blocked by
 * app.json, since the system Photo Picker needs none of them.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const imagePicker = require('../imagePicker') as (config: Record<string, unknown>) => Record<string, unknown>;
const appJson = require('../../../app.json') as { expo: { android: { blockedPermissions: string[]; permissions: string[] } } };
/* eslint-enable @typescript-eslint/no-require-imports */

it('adds no plugin and changes nothing', () => {
  const config = { name: 'LifePass', slug: 'lifepass-iceland', plugins: [] as unknown[] };
  const result = imagePicker(config);
  expect(result).toBe(config);
  expect(result.plugins).toEqual([]);
});

it('leaves the microphone to dictation and keeps the storage and media permissions blocked', () => {
  const { blockedPermissions, permissions } = appJson.expo.android;
  expect(permissions).toContain('android.permission.RECORD_AUDIO');
  expect(blockedPermissions).not.toContain('android.permission.RECORD_AUDIO');
  for (const blocked of [
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
    'android.permission.READ_MEDIA_IMAGES',
    'android.permission.READ_MEDIA_VIDEO',
    'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
  ]) {
    expect(blockedPermissions).toContain(blocked);
  }
});
