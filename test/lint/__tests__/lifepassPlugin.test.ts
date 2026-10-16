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
  // The real CLI in its own process: ESLint loads its config with a dynamic
  // import, which Jest's module system cannot run.
  async function lint(file: string, code: string): Promise<(string | null)[]> {
    let out: string;
    try {
      out = execFileSync(
        path.join(ROOT, 'node_modules', '.bin', 'eslint'),
        ['--format', 'json', '--stdin', '--stdin-filename', path.join(ROOT, file)],
        { cwd: ROOT, input: code, encoding: 'utf8' },
      );
    } catch (error) {
      // Exit code 1 means "problems found"; the JSON is still on stdout.
      out = (error as { stdout: string }).stdout;
    }
    const [result] = JSON.parse(out) as { messages: { ruleId: string | null }[] }[];
    return result!.messages.map((m) => m.ruleId);
  }

  const literal = "import { Text } from 'react-native';\nexport const A = () => <Text>Book now</Text>;\n";

  it('applies the copy rules to new code', async () => {
    expect(await lint('src/features/example/Example.tsx', literal)).toContain('lifepass/no-literal-copy');
  });

  it('applies the RN raw-text rule to new code', async () => {
    const raw = "import { View } from 'react-native';\nexport const A = () => <View>Book now</View>;\n";
    expect(await lint('src/features/example/Example.tsx', raw)).toEqual(
      expect.arrayContaining(['react-native/no-raw-text', 'lifepass/no-literal-copy']),
    );
  });

  it('spares the string tables, where copy belongs', async () => {
    const pack = "export const en = { title: 'Plans', 'plans.title': 'Plans' };\n";
    expect(await lint('src/i18n/android/PLANS-1.ts', pack)).not.toContain('lifepass/no-literal-copy');
    expect(await lint('src/features/example/copy.ts', pack)).toContain('lifepass/no-literal-copy');
  });

  it('spares legacy files until their owner rewrites them, and tests', async () => {
    expect(await lint('src/screens/home/HomeScreen.tsx', literal)).not.toContain('lifepass/no-literal-copy');
    expect(await lint('src/features/example/__tests__/Example.test.tsx', literal)).not.toContain('lifepass/no-literal-copy');
  });

  it('lets a rewritten legacy file opt back in with one comment', async () => {
    const optIn = `/* eslint lifepass/no-literal-copy: "error" */\n${literal}`;
    expect(await lint('src/screens/home/HomeScreen.tsx', optIn)).toContain('lifepass/no-literal-copy');
  });

  it('applies the raw-text rule to legacy files too (raw text crashes the app on Android)', async () => {
    const raw = "import { View } from 'react-native';\nexport const A = () => <View>Book now</View>;\n";
    for (const file of ['src/screens/home/HomeScreen.tsx', 'src/screens/checkin/CheckInScreen.tsx']) {
      const rules = await lint(file, raw);
      expect(rules).toContain('react-native/no-raw-text');
      expect(rules).not.toContain('lifepass/no-literal-copy');
    }
  });

  it('allows punctuation-only text inside a <Text>', async () => {
    const ok = "import { Text } from 'react-native';\nexport const A = ({ n, m }: { n: string; m: string }) => <Text>{`${n} · ${m}`}</Text>;\n";
    expect(await lint('src/features/example/Example.tsx', ok)).toEqual([]);
  });

  it('names an owner for every legacy file (plan 3.0.1)', () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { LEGACY_COPY_OWNERS, LEGACY_COPY_FILES } = require('../../../eslint.config.js');
    /* eslint-enable @typescript-eslint/no-require-imports */
    expect(LEGACY_COPY_FILES).toEqual(Object.keys(LEGACY_COPY_OWNERS));
    for (const owner of Object.values(LEGACY_COPY_OWNERS)) expect(owner).toMatch(/^[A-Z]+\d*(-\d+)?$/);
    expect(LEGACY_COPY_OWNERS).toMatchObject({
      'src/navigation/CustomTabBar.tsx': 'F4',
      'src/hooks/useWeather.ts': 'HOME-1',
      'src/supabase/hooks/useFavourites.ts': 'VENUE-2',
      'src/utils/nationality.ts': 'AUTH-1',
      'src/data/coachQuestions.ts': 'COACH-2',
    });
  });

  it('refuses Node-only globals the phone does not have, in app code', async () => {
    const code = [
      'export const a = crypto.randomUUID();',
      "export const b = Buffer.from('x').toString('base64');",
      'export const c = AbortSignal.timeout(5000);',
      'export const d = AbortSignal.any([]);',
      'export const e = globalThis.crypto;',
      '',
    ].join('\n');
    const rules = await lint('src/features/example/ids.ts', code);
    expect(rules.filter((r) => r === 'no-restricted-globals')).toHaveLength(2);
    expect(rules.filter((r) => r === 'no-restricted-properties')).toHaveLength(3);
    const ok = "import * as Crypto from 'expo-crypto';\nexport const a = Crypto.randomUUID();\n";
    expect(await lint('src/features/example/ids.ts', ok)).toEqual([]);
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
