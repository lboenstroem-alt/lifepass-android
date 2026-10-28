import { setDev, setEnv } from '@test/harness';
import { TEST_API_BASE, TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_URL } from '@test/server';

import { env, parseBuildFlag, PRODUCTION, resolveBaseUrl, resolveKey } from '../env';

describe('parseBuildFlag (iOS APIClientAuthTests.testTheBuildFlagIsOffUnlessSetToYes)', () => {
  it.each(['YES', 'yes', 'true', '1', ' Yes ', 'TRUE'])('%p switches it on', (raw) => {
    expect(parseBuildFlag(raw)).toBe(true);
  });

  it.each([[''], ['NO'], ['$(LP_SOCIAL_SIGN_IN)'], ['${EXPO_PUBLIC_SOCIAL_SIGN_IN}'], [undefined], [null], [1], ['on']])(
    '%p leaves it off',
    (raw) => {
      expect(parseBuildFlag(raw)).toBe(false);
    },
  );
});

describe('env', () => {
  it('reads the test hosts the harness pins (never production)', () => {
    expect(env.apiBaseUrl).toBe(TEST_API_BASE);
    expect(env.apiHost).toBe('api.lifepass.test');
    expect(env.supabaseUrl).toBe(TEST_SUPABASE_URL);
    expect(env.supabaseAnonKey).toBe(TEST_SUPABASE_ANON_KEY);
  });

  // iOS testThisBuildHasTheFlagOffByDefault: a build without the switch shows no button.
  it('has social sign-in off unless the build sets it', () => {
    expect(env.socialSignInBuildEnabled).toBe(false);
    setEnv({ EXPO_PUBLIC_SOCIAL_SIGN_IN: 'YES' });
    expect(env.socialSignInBuildEnabled).toBe(true);
  });

  it('falls back to production, as iOS APIConfig and SupabaseConfig do', () => {
    setEnv({
      EXPO_PUBLIC_LIFEPASS_API_URL: undefined,
      EXPO_PUBLIC_SUPABASE_URL: undefined,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: undefined,
    });
    expect(env.apiBaseUrl).toBe('https://www.lifepass.is/api/v1');
    expect(env.apiHost).toBe('www.lifepass.is');
    expect(env.supabaseUrl).toBe(PRODUCTION.supabaseUrl);
    expect(env.supabaseAnonKey).toBe(PRODUCTION.supabaseAnonKey);
  });

  it('has no Mapbox token unless one is set', () => {
    setEnv({ EXPO_PUBLIC_MAPBOX_TOKEN: undefined });
    expect(env.mapboxToken).toBeNull();
    setEnv({ EXPO_PUBLIC_MAPBOX_TOKEN: '  pk.abc ' });
    expect(env.mapboxToken).toBe('pk.abc');
  });
});

describe('resolveBaseUrl', () => {
  const fallback = 'https://www.lifepass.is/api/v1';

  it('keeps a usable URL and drops trailing slashes', () => {
    expect(resolveBaseUrl('https://www.lifepass.is/api/v1/', fallback)).toBe(fallback);
    expect(resolveBaseUrl(' http://10.0.2.2:3000/api/v1 ', fallback)).toBe('http://10.0.2.2:3000/api/v1');
  });

  it('falls back on missing, blank, placeholder and non-URL values', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const raw of [undefined, null, '', '   ', '$(LIFEPASS_API_BASE_URL)', '${API}', 'www.lifepass.is', 'ftp://x/y']) {
      expect(resolveBaseUrl(raw, fallback)).toBe(fallback);
    }
    // Only a value that was given but unusable is worth a warning.
    expect(warn).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });

  it('never warns in a release bundle', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    setDev(false);
    expect(resolveBaseUrl('not a url', fallback)).toBe(fallback);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('resolveKey', () => {
  it('trims, and falls back on blank or placeholder', () => {
    expect(resolveKey(' sb_publishable_x ', 'f')).toBe('sb_publishable_x');
    expect(resolveKey('', 'f')).toBe('f');
    expect(resolveKey(undefined, 'f')).toBe('f');
    expect(resolveKey('$(SUPABASE_ANON_KEY)', 'f')).toBe('f');
  });
});
