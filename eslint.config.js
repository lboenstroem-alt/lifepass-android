// ESLint (flat config) for the LifePass Android app.
//
// Base: eslint-config-expo (TypeScript, React, hooks, import). On top:
//
// 1. Copy rules:
//    - `react-native/no-raw-text`, on EVERY source file: text outside a
//      <Text> crashes the app on Android ("Text strings must be rendered
//      within a <Text> component").
//    - `lifepass/no-literal-copy`, on EVERY app source file: any
//      member-facing literal at all; words come from t()/tp() with the
//      generated iOS keys, or from the package's Android pack
//      (eslint/lifepass-plugin.js explains why both).
// 2. `lifepass/feature-boundaries` for src/features: another feature only
//    through its index.ts or a published slot (plan 3.0.3).
// 3. Device runtime: the phone runs Hermes, not Node. `crypto`, `Buffer`,
//    `AbortSignal.timeout` and `AbortSignal.any` do not exist there (Jest
//    removes them too, test/setup/env.ts), so app code may not use them.
//
// NO LEGACY FILES. The first build's files with English literals were exempt
// one by one (plan 3.0.1) until their packages rewrote or deleted them; the
// list is empty now and gone, so the rule applies everywhere. The first line
// many files still carry, `/* eslint lifepass/no-literal-copy: "error" */`,
// was how a rewritten file opted back in; it now only repeats the default.
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
    // Generated.
    'src/api/openapi.d.ts',
  ]),

  expoConfig,

  {
    files: SOURCE,
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
  // ... and no literal copy, in every app file. The first build's files
  // were exempt one by one (plan 3.0.1) until each was rewritten or deleted
  // (QA-1); none is now. A literal that really is the same in both
  // languages, as on iOS, says so where it stands, with an eslint-disable
  // and its reason.
  {
    files: ['**/*.{ts,tsx,jsx}'],
    ignores: NOT_MEMBER_FACING,
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

module.exports.TEXT_COMPONENTS_FILE = TEXT_COMPONENTS_FILE;
module.exports.readTextComponents = readTextComponents;
