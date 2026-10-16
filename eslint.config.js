// ESLint (flat config) for the LifePass Android app.
//
// Base: eslint-config-expo (TypeScript, React, hooks, import). On top:
//
// 1. Copy rules, for every source file outside the legacy list below:
//    - `react-native/no-raw-text`: text outside a <Text> (a crash on RN);
//    - `lifepass/no-literal-copy`: any member-facing literal at all; words come
//      from t()/tp() with the generated iOS keys, or from the package's
//      Android pack (eslint/lifepass-plugin.js explains why both).
// 2. `lifepass/feature-boundaries` for src/features: another feature only
//    through its index.ts or a published slot (plan 3.0.3).
//
// LEGACY FILES. The files listed in LEGACY_COPY_FILES predate the parity
// build and still hold English literals; each belongs to the package named in
// plan 3.0.1, which replaces or rewrites it. A package that rewrites one turns
// the rules back on for it with this first line, without touching this file:
//
//   /* eslint lifepass/no-literal-copy: "error", react-native/no-raw-text: "error" */
//
// QA-1 empties the list (and turns the rules on everywhere) at the end.
const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const reactNative = require('eslint-plugin-react-native');
const globals = require('globals');

const lifepass = require('./eslint/lifepass-plugin');

const SOURCE = ['**/*.{js,jsx,ts,tsx,mjs,cjs}'];

/** Legacy files with English literals (plan 3.0.1 names each owner). */
const LEGACY_COPY_FILES = [
  'src/api/gateRefusal.ts',
  'src/components/AuthField.tsx',
  'src/components/BookItPill.tsx',
  'src/components/CheckInProofBanner.tsx',
  'src/components/CreditPill.tsx',
  'src/components/KenniVerificationModal.tsx',
  'src/components/PopularVenueRow.tsx',
  'src/screens/account/AccountScreen.tsx',
  'src/screens/account/TopUpScreen.tsx',
  'src/screens/auth/LoginScreen.tsx',
  'src/screens/auth/OnboardingScreen.tsx',
  'src/screens/auth/SignUpScreen.tsx',
  'src/screens/booking/BookingFlowScreen.tsx',
  'src/screens/bookings/BookingsScreen.tsx',
  'src/screens/checkin/CheckInScreen.tsx',
  'src/screens/coach/ChatDrawer.tsx',
  'src/screens/coach/CoachScreen.tsx',
  'src/screens/coach/MicButton.tsx',
  'src/screens/coach/QuestionBubbleMessage.tsx',
  'src/screens/coach/VenueCarouselMessage.tsx',
  'src/screens/explore/ExploreScreen.tsx',
  'src/screens/home/HomeScreen.tsx',
  'src/screens/venue/VenueDetailScreen.tsx',
  'src/services/notifications.ts',
];

/** Where the copy rules never apply: tests, dev-only screens, tooling. */
const NOT_MEMBER_FACING = [
  '**/__tests__/**',
  '**/*.test.{ts,tsx}',
  'test/**',
  'src/dev/**',
  'jest.setup.ts',
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

  // 1. Copy rules.
  {
    files: ['**/*.{ts,tsx}'],
    ignores: [...LEGACY_COPY_FILES, ...NOT_MEMBER_FACING],
    rules: {
      'react-native/no-raw-text': 'error',
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
]);

module.exports.LEGACY_COPY_FILES = LEGACY_COPY_FILES;
