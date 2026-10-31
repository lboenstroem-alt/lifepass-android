/**
 * Fixture loading: a shared fixture by name, a package's own by absolute
 * path, always a fresh copy so a test can break it for the malformed case.
 */
import path from 'path';

import { validateResponseData } from '@test/contract';
import { fixturePath, loadFixture } from '@test/server';

type Preview = { venue: { slug: string }; allowed: boolean; blockingReason: string | null };

it('loads a shared fixture by name, and the same file by absolute path', () => {
  const byName = loadFixture<Preview>('harness/walk-in-preview');
  const byPath = loadFixture<Preview>(path.join(__dirname, '..', '..', 'fixtures', 'harness', 'walk-in-preview.json'));
  expect(byName).toEqual(byPath);
  expect(byName.venue.slug).toBe('laugar');
  expect(fixturePath('harness/walk-in-preview')).toMatch(/test\/fixtures\/harness\/walk-in-preview\.json$/);
});

it('hands out a fresh copy every time', () => {
  const first = loadFixture<Preview>('harness/walk-in-preview');
  first.allowed = false;
  expect(loadFixture<Preview>('harness/walk-in-preview').allowed).toBe(true);
});

it('is a response the contract accepts, and a broken copy is not', () => {
  const preview = loadFixture<Preview>('harness/walk-in-preview');
  expect(validateResponseData('GET', '/check-ins/walk-in/preview', 200, preview).errors).toEqual([]);
  // iOS's bare preview fixture predates `charge`, `coveredBy` and friends being
  // required; the decoders stay fail-soft, the contract does not.
  const { blockingReason: _dropped, ...older } = preview;
  expect(validateResponseData('GET', '/check-ins/walk-in/preview', 200, older).valid).toBe(false);
});

it('says which fixture is missing', () => {
  expect(() => loadFixture('harness/nope')).toThrow(/fixture not found: .*harness\/nope\.json/);
});
