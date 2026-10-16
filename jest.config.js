// Jest for the LifePass Android app.
//
// `jest-expo/android` resolves `.android.tsx` files first and inlines
// `Platform.OS === 'android'`, so tests see the platform the app ships on.
//
// TIME ZONE. LifePass shows Reykjavik time, which is UTC with no daylight
// saving, whatever the phone's own zone is. Suites run in UTC by default so a
// test that forgets a zone still reads like an Icelandic phone, and
// `scripts/ci.sh` runs the whole suite again under America/New_York and
// Asia/Tokyo to catch code that leaks the device zone. `process.env.TZ` has
// to be set here, before the workers start, because Node reads it once per
// process.
process.env.TZ = process.env.TZ || 'UTC';

/** Packages that ship untranspiled ESM or Flow and must go through Babel. */
const transpiledPackages = [
  '(jest-)?react-native',
  '@react-native(-community)?',
  'expo(nent)?',
  '@expo(nent)?/.*',
  '@expo-google-fonts/.*',
  'react-navigation',
  '@react-navigation/.*',
  'react-native-svg',
  'react-native-reanimated',
  'react-native-worklets',
  'react-native-gesture-handler',
  '@gorhom/.*',
  '@rnmapbox/.*',
  '@supabase/.*',
  // ESM-only helpers msw's CommonJS build requires; Jest 29 cannot load them as is.
  'until-async',
  'rettime',
  '@open-draft/.*',
  '@inquirer/.*',
];

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo/android',
  setupFiles: [
    '<rootDir>/test/setup/env.ts',
    'react-native-gesture-handler/jestSetup.js',
    '@rnmapbox/maps/setup-jest',
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/', '/e2e/', '/supabase/'],
  // Every `.mjs` file is transformed too (the preset's rule covers `.js`).
  transformIgnorePatterns: [`node_modules/(?!(${transpiledPackages.join('|')})).*(?<!\\.mjs)$`],
  transform: {
    '\\.mjs$': ['babel-jest', { caller: { name: 'metro', bundler: 'metro', platform: 'android' } }],
  },
  moduleNameMapper: {
    '^@test/(.*)$': '<rootDir>/test/$1',
  },
  clearMocks: true,
};
