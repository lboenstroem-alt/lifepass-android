// ESLint (flat config) for the LifePass Android app.
//
// Base: eslint-config-expo (TypeScript, React, hooks, import). On top:
//
// 1. Copy rules:
//    - `react-native/no-raw-text`, on EVERY source file (legacy ones too):
//      text outside a <Text> crashes the app on Android ("Text strings must
//      be rendered within a <Text> component").
//    - `lifepass/no-literal-copy`, on every source file outside the legacy
//      list below: any member-facing literal at all; words come from
//      t()/tp() with the generated iOS keys, or from the package's Android
//      pack (eslint/lifepass-plugin.js explains why both).
// 2. `lifepass/feature-boundaries` for src/features: another feature only
//    through its index.ts or a published slot (plan 3.0.3).
// 3. Device runtime: the phone runs Hermes, not Node. `crypto`, `Buffer`,
//    `AbortSignal.timeout` and `AbortSignal.any` do not exist there (Jest
//    removes them too, test/setup/env.ts), so app code may not use them.
//
// LEGACY FILES. The files in LEGACY_COPY_FILES predate the parity build and
// still hold English literals; each belongs to the package named next to it
// (plan 3.0.1), which replaces or rewrites it. A package that rewrites one
// turns the copy rule back on for it with this first line, without touching
// this file:
//
//   /* eslint lifepass/no-literal-copy: "error" */
//
// QA-1 empties the list (and so turns the rule on everywhere) at the end.
//
// TEXT COMPONENTS. Raw text is safe inside a component that renders its
// children in a <Text>. F5 owns the UI kit and lists those components in
// src/components/ui/textComponents.json (a JSON array of JSX names, e.g.
// ["LPText", "Kicker"]); this file reads it, so no package edits the lint
// config to add one. Until the file exists only React Native's own text
// elements count.
const fs = require('fs');
const path = require('path');

const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const reactNative = require('eslint-plugin-react-native');
const globals = require('globals');

const lifepass = require('./eslint/lifepass-plugin');

const SOURCE = ['**/*.{js,jsx,ts,tsx,mjs,cjs}'];

/** Legacy files with English literals, each with its owner (plan 3.0.1). */
const LEGACY_COPY_OWNERS = {
  'src/api/gateRefusal.ts': 'F2',
  'src/components/BookItPill.tsx': 'F5',
  'src/components/CheckInProofBanner.tsx': 'CHECKIN-1',
  'src/components/CreditPill.tsx': 'F5',
  'src/components/KenniVerificationModal.tsx': 'AUTH-3',
  'src/components/PopularVenueRow.tsx': 'HOME-1',
  'src/data/coachCategories.ts': 'COACH-1',
  'src/data/coachQuestions.ts': 'COACH-2',
  'src/data/mockCoach.ts': 'COACH-1',
  'src/hooks/useWeather.ts': 'HOME-1',
  'src/navigation/CustomTabBar.tsx': 'F4',
  'src/screens/account/AccountScreen.tsx': 'ACCT-1',
  'src/screens/account/TopUpScreen.tsx': 'PLANS-1',
  'src/screens/booking/BookingFlowScreen.tsx': 'BOOK-1',
  'src/screens/bookings/BookingsScreen.tsx': 'LIB-1',
  'src/screens/checkin/CheckInScreen.tsx': 'CHECKIN-1',
  'src/screens/coach/ChatDrawer.tsx': 'COACH-1',
  'src/screens/coach/CoachScreen.tsx': 'COACH-1',
  'src/screens/coach/MicButton.tsx': 'COACH-1',
  'src/screens/coach/QuestionBubbleMessage.tsx': 'COACH-2',
  'src/screens/coach/VenueCarouselMessage.tsx': 'COACH-1',
  'src/screens/explore/ExploreScreen.tsx': 'EXPL-1',
  'src/screens/home/HomeScreen.tsx': 'HOME-1',
  'src/screens/venue/VenueDetailScreen.tsx': 'VENUE-1',
  'src/services/notifications.ts': 'F7',
  'src/supabase/hooks/useFavourites.ts': 'VENUE-2',
  'src/utils/nationality.ts': 'AUTH-1',
};
const LEGACY_COPY_FILES = Object.keys(LEGACY_COPY_OWNERS);

/**
 * Where the copy rules never apply: the string tables themselves (generated
 * iOS copy and the Android packs live in src/i18n), tests, dev-only screens.
 */
const NOT_MEMBER_FACING = [
  'src/i18n/**',
  '**/__tests__/**',
  '**/*.test.{ts,tsx}',
  'test/**',
  'src/dev/**',
  'jest.setup.ts',
];

/** Where F5 lists its text components (see TEXT COMPONENTS above). */
const TEXT_COMPONENTS_FILE = 'src/components/ui/textComponents.json';

/**
 * The JSX names that render their children inside a <Text>, from
 * `TEXT_COMPONENTS_FILE` under `root`. A missing file is an empty list; a
 * malformed one fails the lint run rather than silently allowing nothing.
 */
function readTextComponents(root = __dirname) {
  const file = path.join(root, TEXT_COMPONENTS_FILE);
  if (!fs.existsSync(file)) return [];
  const names = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(names) || !names.every((n) => typeof n === 'string' && /^[A-Z][\w.]*$/.test(n))) {
    throw new Error(`${TEXT_COMPONENTS_FILE} must be a JSON array of component names, e.g. ["LPText"]`);
  }
  return names;
}

/** Hermes has none of these (RN's AbortSignal is the abort-controller polyfill). */
const DEVICE_MISSING_GLOBALS = [
  {
    name: 'crypto',
    message:
      'The phone has no global crypto (Hermes). Use expo-crypto (randomUUID, getRandomBytes, digestStringAsync).',
  },
  {
    name: 'Buffer',
    message: 'The phone has no Buffer (Hermes). Use TextEncoder/TextDecoder, or base64 from expo-file-system.',
  },
];
const DEVICE_MISSING_PROPERTIES = [
  ...['timeout', 'any'].map((property) => ({
    object: 'AbortSignal',
    property,
    message:
      `AbortSignal.${property} does not exist on the phone (RN polyfills AbortSignal without it). ` +
      "Use an AbortController with setTimeout, or the API client's own timeout.",
  })),
  ...DEVICE_MISSING_GLOBALS.map(({ name, message }) => ({ object: 'globalThis', property: name, message })),
];

module.exports = defineConfig([
  globalIgnores([
    'node_modules/**',
    'android/**',
    'ios/**',
    'dist/**',
    'web-build/**',
    '.expo/**',
    'coverage/**',
    // Deleted by QA-1; not part of the app (plan 3.0.1).
    'supabase/functions/**',
    // Generated.
    'src/api/openapi.d.ts',
  ]),

  expoConfig,

  {
    files: SOURCE,
    // Registered everywhere so a legacy file can opt back in with an inline comment.
    plugins: { 'react-native': reactNative, lifepass },
    rules: {
      // A web (HTML entity) rule; an apostrophe in RN text is just text.
      'react/no-unescaped-entities': 'off',
    },
  },

  {
    files: ['**/*.{ts,tsx}'],
    settings: {
      // TypeScript paths (`@test/*`) as tsc resolves them.
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
        node: { extensions: ['.js', '.jsx', '.ts', '.tsx', '.d.ts', '.json'] },
      },
    },
  },

  // Node: config, scripts and the lint plugin itself.
  {
    files: [
      '*.config.js',
      'babel.config.js',
      'metro.config.js',
      'jest.config.js',
      'config/**/*.js',
      'scripts/**/*.{js,mjs,cjs}',
      'eslint/**/*.js',
    ],
    languageOptions: { globals: { ...globals.node } },
  },

  // Jest.
  {
    files: ['**/__tests__/**', '**/*.test.{ts,tsx}', 'test/**', 'jest.setup.ts'],
    languageOptions: { globals: { ...globals.jest, ...globals.node } },
    rules: {
      // Tests set and restore variables by name (test/harness setEnv).
      'expo/no-dynamic-env-var': 'off',
    },
  },

  // 1. Copy rules: no raw text anywhere in the app ...
  {
    files: ['**/*.{ts,tsx,jsx}'],
    ignores: NOT_MEMBER_FACING,
    rules: {
      'react-native/no-raw-text': ['error', { skip: readTextComponents() }],
    },
  },
  // ... and no literal copy outside the legacy files.
  {
    files: ['**/*.{ts,tsx,jsx}'],
    ignores: [...LEGACY_COPY_FILES, ...NOT_MEMBER_FACING],
    rules: {
      'lifepass/no-literal-copy': 'error',
    },
  },

  // 2. Feature boundaries.
  {
    files: ['src/features/**/*.{ts,tsx}'],
    rules: {
      'lifepass/feature-boundaries': 'error',
    },
  },

  // 3. Device runtime (app code, and its tests, which run without them too).
  {
    files: ['src/**/*.{js,jsx,ts,tsx}', 'App.tsx', 'index.ts'],
    rules: {
      'no-restricted-globals': ['error', ...DEVICE_MISSING_GLOBALS],
      'no-restricted-properties': ['error', ...DEVICE_MISSING_PROPERTIES],
    },
  },
]);

module.exports.LEGACY_COPY_OWNERS = LEGACY_COPY_OWNERS;
module.exports.LEGACY_COPY_FILES = LEGACY_COPY_FILES;
module.exports.TEXT_COMPONENTS_FILE = TEXT_COMPONENTS_FILE;
module.exports.readTextComponents = readTextComponents;
