/**
 * The links this phone has already tried (./spentLinks.ts): a link with
 * credentials is claimed once, a link without (a failure) is never claimed,
 * only its hash is kept, the list stays short, and storage that fails never
 * blocks a fresh link.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  authLinkCarriesCredentials,
  authLinkFingerprint,
  claimAuthLink,
  SPENT_AUTH_LINKS_KEPT,
  SPENT_AUTH_LINKS_KEY,
} from '../spentLinks';

const LINK = 'lifepass://auth/callback#access_token=secret-access&refresh_token=secret-refresh&type=signup';

it('fingerprints a link as its SHA-256 in hex', () => {
  // The FIPS 180-2 test vector.
  expect(authLinkFingerprint('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

it('claims a link once', async () => {
  expect(await claimAuthLink(LINK)).toBe(true);
  expect(await claimAuthLink(LINK)).toBe(false);
  expect(await claimAuthLink(`${LINK}x`)).toBe(true);
});

it.each([
  ['a token pair', 'lifepass://auth/callback#access_token=a&refresh_token=r&type=signup', true],
  ['a PKCE code', 'lifepass://auth/callback?code=abc', true],
  ['a code in the App Link form', 'https://www.lifepass.is/app/auth-callback?type=recovery&code=abc', true],
  ['an access token alone', 'lifepass://auth/callback#access_token=a', false],
  ['nothing', 'lifepass://auth/callback', false],
  ['an error', 'lifepass://auth/callback#error=access_denied&error_code=otp_expired', false],
  ['an error beside a code', 'lifepass://auth/callback?code=abc#error=server_error', false],
  ['an error description only', 'lifepass://auth/callback?type=recovery#error_description=Expired', false],
])('a link with %s carries credentials: %s', (_label, url, expected) => {
  expect(authLinkCarriesCredentials(url)).toBe(expected);
});

it('never claims a link that failed: Supabase sends the same one for every expired link', async () => {
  const expired =
    'lifepass://auth/callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
  expect(await claimAuthLink(expired)).toBe(true);
  expect(await claimAuthLink(expired)).toBe(true);
  expect(await claimAuthLink('lifepass://auth/callback')).toBe(true);
  expect(await claimAuthLink('lifepass://auth/callback')).toBe(true);
  expect(await AsyncStorage.getItem(SPENT_AUTH_LINKS_KEY)).toBeNull();
});

it('keeps only the hash, never the tokens', async () => {
  await claimAuthLink(LINK);
  const stored = (await AsyncStorage.getItem(SPENT_AUTH_LINKS_KEY)) ?? '';
  expect(stored).not.toContain('secret');
  expect(JSON.parse(stored)).toEqual([authLinkFingerprint(LINK)]);
});

it('remembers the newest links only', async () => {
  for (let n = 0; n <= SPENT_AUTH_LINKS_KEPT; n += 1) await claimAuthLink(`lifepass://auth/callback?code=${n}`);
  const stored = JSON.parse((await AsyncStorage.getItem(SPENT_AUTH_LINKS_KEY)) ?? '[]') as string[];
  expect(stored).toHaveLength(SPENT_AUTH_LINKS_KEPT);
  expect(stored[0]).toBe(authLinkFingerprint(`lifepass://auth/callback?code=${SPENT_AUTH_LINKS_KEPT}`));
  // The oldest fell off, so it would run again; the newest would not.
  expect(await claimAuthLink('lifepass://auth/callback?code=0')).toBe(true);
  expect(await claimAuthLink(`lifepass://auth/callback?code=${SPENT_AUTH_LINKS_KEPT}`)).toBe(false);
});

it('reads a damaged list as empty', async () => {
  await AsyncStorage.setItem(SPENT_AUTH_LINKS_KEY, '{not json');
  expect(await claimAuthLink(LINK)).toBe(true);
  expect(await claimAuthLink(LINK)).toBe(false);
});

it('lets a link through when storage fails', async () => {
  // Once each. No mockRestore: the storage mock's methods are jest.fn themselves, and restoring one would empty it.
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
  expect(await claimAuthLink(LINK)).toBe(true);

  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk'));
  expect(await claimAuthLink(LINK)).toBe(true);
  // Neither was remembered, so the link still runs.
  expect(await claimAuthLink(LINK)).toBe(true);
});
