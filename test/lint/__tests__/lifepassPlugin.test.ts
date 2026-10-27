/**
 * The project's own lint rules (eslint/lifepass-plugin.js) and where
 * eslint.config.js applies them.
 */
import { execFileSync } from 'child_process';
import { RuleTester } from 'eslint';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/* eslint-disable @typescript-eslint/no-require-imports */
const plugin = require('../../../eslint/lifepass-plugin');
const tsParser = require('@typescript-eslint/parser');
/* eslint-enable @typescript-eslint/no-require-imports */

const ROOT = path.join(__dirname, '..', '..', '..');

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe('lifepass/no-literal-copy', () => {
  tester.run('no-literal-copy', plugin.rules['no-literal-copy'], {
    valid: [
      { code: "<Text>{t('home.title')}</Text>" },
      { code: "<Text>{tp('plans.visits', count)}</Text>" },
      { code: "<Text>{' · '}{price}</Text>" },
      { code: '<Text>42 %</Text>' },
      { code: '<Text>LifePass</Text>' },
      { code: "<Pressable accessibilityLabel={t('a11y.close')} testID=\"close-button\" />" },
      { code: '<Icon name="chevron-back" color="#fff" />' },
      { code: "const route = { name: 'Home' };" },
      { code: "Alert.alert(t('x.title'), t('x.body'))" },
      { code: "<Text>Kenni</Text>", options: [{ allow: ['Kenni'] }] },
      { code: "scheduleNotificationAsync({ content: { title: t('rest.title'), body: t('rest.body') }, trigger })" },
      { code: "const tabs = [{ routeName: 'Home', label: t('tab.home'), icon: 'home-outline' }];" },
      { code: "Share.share({ message: t('referral.share', { code }) })" },
      { code: 'setError(e instanceof Error ? e.message : null)' },
      { code: "settings({ mode: 'dark' })" },
      { code: "fetch(url, { method: 'POST', body: JSON.stringify(payload) })" },
    ],
    invalid: [
      { code: '<Text>Book now</Text>', errors: [{ messageId: 'literal' }] },
      { code: "<Text>{'Book now'}</Text>", errors: [{ messageId: 'literal' }] },
      { code: '<Text>{`Hi ${name}`}</Text>', errors: [{ messageId: 'literal' }] },
      { code: "<Text>{busy ? 'Saving' : t('save')}</Text>", errors: [{ messageId: 'literal' }] },
      { code: "<Text>{loading && 'Hleð…'}</Text>", errors: [{ messageId: 'literal' }] },
      { code: '<Pressable accessibilityLabel="Close" />', errors: [{ messageId: 'literal' }] },
      { code: "<TextInput placeholder={'Email'} />", errors: [{ messageId: 'literal' }] },
      { code: "<Stack.Screen options={{ title: 'Plans' }} />", errors: [{ messageId: 'literal' }] },
      { code: "Alert.alert('Error', 'Something went wrong')", errors: [{ messageId: 'literal' }, { messageId: 'literal' }] },
      { code: "ToastAndroid.show('Saved', ToastAndroid.SHORT)", errors: [{ messageId: 'literal' }] },
      // Notification content: the rest timer, reminders.
      {
        code: "scheduleNotificationAsync({ content: { body: 'Time for your next set', subtitle: 'Workout' }, trigger: null })",
        errors: [{ messageId: 'literal' }, { messageId: 'literal' }],
      },
      // Tab and menu tables (the legacy CustomTabBar shape).
      { code: "const tabs = [{ routeName: 'Home', label: 'Home', icon: 'home-outline' }];", errors: [{ messageId: 'literal' }] },
      { code: "Share.share({ message: 'Join me on LifePass', title: 'Invite' })", errors: [{ messageId: 'literal' }, { messageId: 'literal' }] },
      { code: "const empty = { text: 'No bookings yet', cta: 'Explore' };", errors: [{ messageId: 'literal' }, { messageId: 'literal' }] },
      { code: "<Stack.Screen options={{ tabBarAccessibilityLabel: 'Profile' }} />", errors: [{ messageId: 'literal' }] },
      // A state setter whose text ends up on screen.
      { code: "setError(e instanceof Error ? e.message : 'Weather unavailable')", errors: [{ messageId: 'literal' }] },
      { code: "setErrorMessage('Could not update favourites')", errors: [{ messageId: 'literal' }] },
    ],
  });
});

describe('lifepass/feature-boundaries', () => {
  // A throwaway tree, because a folder import resolves to the folder's index.
  const root = mkdtempSync(path.join(tmpdir(), 'lp-boundaries-'));
  const features = path.join(root, 'src', 'features');
  for (const dir of ['home', 'favourites', 'body/sheets', 'plan/proposal', 'booking/party']) {
    mkdirSync(path.join(features, dir), { recursive: true });
  }
  writeFileSync(path.join(features, 'body/sheets/index.ts'), 'export {};');
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const file = (rel: string) => path.join(features, rel);
  const options = [{ root }];

  tester.run('feature-boundaries', plugin.rules['feature-boundaries'], {
    valid: [
      { code: "import { useFavourite } from '../favourites';", filename: file('home/Card.tsx'), options },
      { code: "import { useFavourite } from '../favourites/index';", filename: file('home/Card.tsx'), options },
      { code: "import { openBodySheet } from '../body/sheets';", filename: file('home/Card.tsx'), options },
      { code: "import Card from '../plan/proposal/ProgramProposalCard';", filename: file('home/Card.tsx'), options },
      { code: "import Row from '../plan/HomeTodayRow';", filename: file('home/Card.tsx'), options },
      { code: "import { x } from './internal/thing';", filename: file('home/Card.tsx'), options },
      { code: "import Party from '../party/GroupPartySection';", filename: file('booking/flow/Screen.tsx'), options },
      { code: "import { t } from '../../../i18n';", filename: file('home/Card.tsx'), options },
      { code: "import { useNavigation } from '@react-navigation/native';", filename: file('home/Card.tsx'), options },
      // Outside src/features nothing is restricted (navigation mounts slots directly).
      { code: "import X from '../features/booking/party/GroupPartySection';", filename: path.join(root, 'src/navigation/x.ts'), options },
    ],
    invalid: [
      {
        code: "import { store } from '../favourites/store';",
        filename: file('home/Card.tsx'),
        options,
        errors: [{ messageId: 'internal' }],
      },
      {
        code: "export { Party } from '../booking/party/GroupPartySection';",
        filename: file('home/Card.tsx'),
        options,
        errors: [{ messageId: 'internal' }],
      },
      {
        code: "jest.mock('../../favourites/api');",
        filename: file('home/__tests__/Card.test.tsx'),
        options,
        errors: [{ messageId: 'internal' }],
      },
    ],
  });
});

describe('eslint.config.js', () => {
  const literal = "import { Text } from 'react-native';\nexport const A = () => <Text>Book now</Text>;\n";
  const raw = "import { View } from 'react-native';\nexport const A = () => <View>Book now</View>;\n";
  const pack = "export const en = { title: 'Plans', 'plans.title': 'Plans' };\n";
  const optIn = `/* eslint lifepass/no-literal-copy: "error" */\n${literal}`;
  const punctuation =
    "import { Text } from 'react-native';\nexport const A = ({ n, m }: { n: string; m: string }) => <Text>{`${n} · ${m}`}</Text>;\n";
  const nodeOnly = [
    'export const a = crypto.randomUUID();',
    "export const b = Buffer.from('x').toString('base64');",
    'export const c = AbortSignal.timeout(5000);',
    'export const d = AbortSignal.any([]);',
    'export const e = globalThis.crypto;',
    '',
  ].join('\n');
  const expoCrypto = "import * as Crypto from 'expo-crypto';\nexport const a = Crypto.randomUUID();\n";

  /** Every (file, code) pair the tests below lint. */
  const CASES: [string, string][] = [
    ['src/features/example/Example.tsx', literal],
    ['src/features/example/Example.tsx', raw],
    ['src/i18n/android/PLANS-1.ts', pack],
    ['src/features/example/copy.ts', pack],
    ['src/screens/home/HomeScreen.tsx', literal],
    ['src/utils/nationality.ts', pack],
    ['src/features/example/__tests__/Example.test.tsx', literal],
    ['src/screens/home/HomeScreen.tsx', optIn],
    ['src/screens/home/HomeScreen.tsx', raw],
    ['src/features/example/Example.tsx', punctuation],
    ['src/features/example/ids.ts', nodeOnly],
    ['src/features/example/ids.ts', expoCrypto],
  ];

  // The real ESLint in its own process (it loads its config with a dynamic
  // import, which Jest's module system cannot run), once for all the cases.
  const LINT_ALL = `
    const { ESLint } = require('eslint');
    (async () => {
      const cases = JSON.parse(require('fs').readFileSync(0, 'utf8'));
      const eslint = new ESLint({ cwd: process.cwd() });
      const out = [];
      for (const [filePath, code] of cases) {
        const [result] = await eslint.lintText(code, { filePath });
        out.push(result.messages.map((m) => m.ruleId));
      }
      process.stdout.write(JSON.stringify(out));
    })().catch((error) => { console.error(error); process.exit(2); });
  `;
  const results = new Map<string, (string | null)[]>();
  beforeAll(() => {
    const input = JSON.stringify(CASES.map(([file, code]) => [path.join(ROOT, file), code]));
    const out = execFileSync(process.execPath, ['-e', LINT_ALL], { cwd: ROOT, input, encoding: 'utf8' });
    (JSON.parse(out) as (string | null)[][]).forEach((rules, i) => results.set(CASES[i]!.join('\0'), rules));
  }, 60_000);

  function lint(file: string, code: string): (string | null)[] {
    const rules = results.get(`${file}\0${code}`);
    if (!rules) throw new Error(`lint case not in CASES: ${file}`);
    return rules;
  }

  it('applies the copy rules to new code', () => {
    expect(lint('src/features/example/Example.tsx', literal)).toContain('lifepass/no-literal-copy');
  });

  it('applies the RN raw-text rule to new code', () => {
    expect(lint('src/features/example/Example.tsx', raw)).toEqual(
      expect.arrayContaining(['react-native/no-raw-text', 'lifepass/no-literal-copy']),
    );
  });

  it('spares the string tables, where copy belongs', () => {
    expect(lint('src/i18n/android/PLANS-1.ts', pack)).not.toContain('lifepass/no-literal-copy');
    expect(lint('src/features/example/copy.ts', pack)).toContain('lifepass/no-literal-copy');
  });

  it('applies the copy rules to every app file, first-build paths too (no legacy list), but not to tests', () => {
    for (const file of ['src/screens/home/HomeScreen.tsx', 'src/utils/nationality.ts']) {
      const code = file.endsWith('.tsx') ? literal : pack;
      expect([file, lint(file, code)]).toEqual([file, expect.arrayContaining(['lifepass/no-literal-copy'])]);
    }
    expect(lint('src/features/example/__tests__/Example.test.tsx', literal)).not.toContain('lifepass/no-literal-copy');
  });

  it('still accepts the old opt-in first line, which now repeats the default', () => {
    expect(lint('src/screens/home/HomeScreen.tsx', optIn)).toContain('lifepass/no-literal-copy');
  });

  it('applies the raw-text rule everywhere (raw text crashes the app on Android)', () => {
    expect(lint('src/screens/home/HomeScreen.tsx', raw)).toContain('react-native/no-raw-text');
  });

  it('allows punctuation-only text inside a <Text>', () => {
    expect(lint('src/features/example/Example.tsx', punctuation)).toEqual([]);
  });

  it('refuses Node-only globals the phone does not have, in app code', () => {
    const rules = lint('src/features/example/ids.ts', nodeOnly);
    expect(rules.filter((r) => r === 'no-restricted-globals')).toHaveLength(2);
    expect(rules.filter((r) => r === 'no-restricted-properties')).toHaveLength(3);
    expect(lint('src/features/example/ids.ts', expoCrypto)).toEqual([]);
  });
});

describe('text components for the raw-text rule (F5 manifest)', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { readTextComponents, TEXT_COMPONENTS_FILE } = require('../../../eslint.config.js');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const root = mkdtempSync(path.join(tmpdir(), 'lp-text-components-'));
  const manifest = path.join(root, TEXT_COMPONENTS_FILE);
  mkdirSync(path.dirname(manifest), { recursive: true });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('is empty until F5 publishes the file', () => {
    expect(readTextComponents(path.join(root, 'nowhere'))).toEqual([]);
  });

  it('reads the names F5 lists', () => {
    writeFileSync(manifest, '["LPText", "Kicker", "Animated.Text"]');
    expect(readTextComponents(root)).toEqual(['LPText', 'Kicker', 'Animated.Text']);
  });

  it('fails loudly on a malformed file instead of allowing nothing', () => {
    writeFileSync(manifest, '{"LPText": true}');
    expect(() => readTextComponents(root)).toThrow(/JSON array of component names/);
    writeFileSync(manifest, '["<Text>"]');
    expect(() => readTextComponents(root)).toThrow(/JSON array/);
  });
});
