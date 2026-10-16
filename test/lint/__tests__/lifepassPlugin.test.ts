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
    const optIn = `/* eslint lifepass/no-literal-copy: "error", react-native/no-raw-text: "error" */\n${literal}`;
    expect(await lint('src/screens/home/HomeScreen.tsx', optIn)).toContain('lifepass/no-literal-copy');
  });
});
