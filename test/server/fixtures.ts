/**
 * Recorded server responses for tests.
 *
 * Shared fixtures live in `test/fixtures/<area>/<name>.json` and are loaded by
 * name (`loadFixture('venues/laugar')`). A package's own fixtures can sit next
 * to its tests and be loaded by absolute path
 * (`loadFixture(path.join(__dirname, 'fixtures/preview.json'))`).
 *
 * Every call returns a fresh copy, so a test can mutate what it loaded (drop
 * a key, break a type) to build the malformed variant without affecting the
 * next test.
 */
import { existsSync, readFileSync } from 'fs';
import { isAbsolute, join } from 'path';

const FIXTURE_ROOT = join(__dirname, '..', 'fixtures');

export function fixturePath(name: string): string {
  if (isAbsolute(name)) return name;
  return join(FIXTURE_ROOT, name.endsWith('.json') ? name : `${name}.json`);
}

export function loadFixture<T = unknown>(name: string): T {
  const file = fixturePath(name);
  if (!existsSync(file)) throw new Error(`fixture not found: ${file}`);
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}
