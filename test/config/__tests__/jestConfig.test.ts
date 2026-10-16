/**
 * Which test files Jest collects (jest.config.js).
 *
 * `testPathIgnorePatterns` are regexes over the ABSOLUTE path of each test
 * file. An unanchored '/supabase/' or '/android/' silently drops every test
 * under src/supabase/** (the legacy session, payment, check-in and booking
 * services the iOS money and privacy tests are ported next to) and under
 * src/i18n/android/** (every package's copy pack), while the gate stays green.
 */
import path from 'path';

/* eslint-disable @typescript-eslint/no-require-imports */
const jestConfig = require('../../../jest.config.js') as { testPathIgnorePatterns: string[] };
/* eslint-enable @typescript-eslint/no-require-imports */

const ROOT = path.join(__dirname, '..', '..', '..');

/** Jest's own reading of the option: `<rootDir>` replaced, then one alternation. */
function ignoredUnder(rootDir: string): (relative: string) => boolean {
  const patterns = jestConfig.testPathIgnorePatterns.map((p) => p.replace(/<rootDir>/g, rootDir));
  const regex = new RegExp(patterns.join('|'));
  return (relative) => regex.test(path.join(rootDir, relative));
}

describe('jest.config.js testPathIgnorePatterns', () => {
  const collected = [
    'src/supabase/services/__tests__/payments.test.ts',
    'src/supabase/lib/__tests__/client.test.ts',
    'src/i18n/android/__tests__/packs.test.ts',
    'src/features/checkin/android/__tests__/x.test.ts',
    'src/features/e2e/__tests__/x.test.ts',
    'src/api/__tests__/client.test.ts',
    'test/harness/__tests__/mocks.test.ts',
  ];
  const ignored = [
    'node_modules/some-lib/__tests__/x.test.js',
    'android/app/src/test/x.test.ts',
    'ios/Pods/x.test.ts',
    'e2e/maestro/x.test.ts',
    'supabase/functions/coach/__tests__/x.test.ts',
  ];

  it.each(collected)('collects %s', (file) => {
    expect(ignoredUnder(ROOT)(file)).toBe(false);
  });

  it.each(ignored)('ignores %s', (file) => {
    expect(ignoredUnder(ROOT)(file)).toBe(true);
  });

  it('collects every test in a checkout that sits under a folder named android or supabase', () => {
    for (const rootDir of ['/home/ci/android/lifepass', '/work/supabase/app']) {
      const isIgnored = ignoredUnder(rootDir);
      for (const file of collected) expect(isIgnored(file)).toBe(false);
      for (const file of ignored) expect(isIgnored(file)).toBe(true);
    }
  });
});
