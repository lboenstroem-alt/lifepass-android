/**
 * Reanimated 4 needs the worklets Babel plugin, and babel-preset-expo 54 adds
 * it on its own when react-native-worklets is installed (babel.config.js says
 * why it is not listed there). If a preset upgrade ever stops doing that, a
 * bottom sheet would crash on a phone at first open; this fails CI first.
 */
import { transformSync } from '@babel/core';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');

function compile(source: string): string {
  // The worklets plugin reads the source file itself, so it has to exist.
  const dir = mkdtempSync(path.join(tmpdir(), 'lp-worklet-'));
  const filename = path.join(dir, 'probe.ts');
  writeFileSync(filename, source);
  try {
    return transformWith(filename, source);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function transformWith(filename: string, source: string): string {
  const result = transformSync(source, {
    filename,
    cwd: ROOT,
    root: ROOT,
    babelrc: false,
    configFile: path.join(ROOT, 'babel.config.js'),
    caller: { name: 'metro', bundler: 'metro', platform: 'android' } as never,
  });
  return result?.code ?? '';
}

test('a worklet compiles through the project Babel config', () => {
  const code = compile(`
    export function probe() {
      'worklet';
      return 1;
    }
  `);
  expect(code).toMatch(/__workletHash|__initData|_worklet/);
});

test('ordinary code is left alone', () => {
  const code = compile('export const answer = () => 42;');
  expect(code).not.toMatch(/__workletHash/);
});
