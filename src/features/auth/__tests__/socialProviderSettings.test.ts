/**
 * Which "Continue with ..." buttons show: the port of iOS SocialSignInTests'
 * gating cases (LifePassTests/APIClientAuthTests.swift, 2.5.4), with owner
 * decision D1 (a) in place of App Review 4.8: Android shows each provider the
 * server has on, so Google alone shows.
 */
import { Reply, supabase as authHost, TEST_SUPABASE_ANON_KEY } from '@test/server';
import { setDev, setEnv } from '@test/harness';

import { env } from '../../../config/env';
import {
  AUTH_SETTINGS_TIMEOUT_MS,
  cachedSocialProviders,
  decodeAuthSettings,
  enabledSocialProviders,
  hasAnySocialProvider,
  loadSocialProviders,
  NO_SOCIAL_PROVIDERS,
  resetSocialProviderSettingsForTests,
  visibleSocialProviders,
} from '../providerSettings';

const BOTH = { apple: true, google: true };
const APPLE_ONLY = { apple: true, google: false };
const GOOGLE_ONLY = { apple: false, google: true };

/** GoTrue's answer, as production sent it (16 Oct 2026), with the providers given. */
function settingsBody(external: Record<string, boolean>) {
  return {
    external: { anonymous_users: false, email: true, phone: false, ...external },
    disable_signup: false,
    mailer_autoconfirm: false,
    phone_autoconfirm: false,
    sms_provider: '',
    saml_enabled: false,
  };
}

beforeEach(() => {
  resetSocialProviderSettingsForTests();
});

describe('which buttons show (the gate)', () => {
  it('shows each provider the server has on, only when the build allows it', () => {
    expect(visibleSocialProviders(true, BOTH)).toEqual(BOTH);
    expect(visibleSocialProviders(true, APPLE_ONLY)).toEqual(APPLE_ONLY);
    // D1 (a): unlike iOS (App Review 4.8), Google alone is offered.
    expect(visibleSocialProviders(true, GOOGLE_ONLY)).toEqual(GOOGLE_ONLY);
    expect(visibleSocialProviders(true, NO_SOCIAL_PROVIDERS)).toEqual(NO_SOCIAL_PROVIDERS);
    // A settings read that failed shows nothing.
    expect(visibleSocialProviders(true, null)).toEqual(NO_SOCIAL_PROVIDERS);
    // A build without the flag shows nothing, whatever the server says.
    for (const server of [BOTH, APPLE_ONLY, GOOGLE_ONLY, NO_SOCIAL_PROVIDERS, null]) {
      expect(visibleSocialProviders(false, server)).toEqual(NO_SOCIAL_PROVIDERS);
    }
  });

  it('knows when there is nothing to draw', () => {
    expect(hasAnySocialProvider(NO_SOCIAL_PROVIDERS)).toBe(false);
    expect(hasAnySocialProvider(APPLE_ONLY)).toBe(true);
    expect(hasAnySocialProvider(GOOGLE_ONLY)).toBe(true);
  });
});

describe('the build flag (EXPO_PUBLIC_SOCIAL_SIGN_IN, iOS LPSocialSignIn)', () => {
  it('is on only for YES, TRUE or 1 in any case', () => {
    for (const on of ['YES', 'yes', 'true', 'TRUE', '1', ' Yes ']) {
      setEnv({ EXPO_PUBLIC_SOCIAL_SIGN_IN: on });
      expect(env.socialSignInBuildEnabled).toBe(true);
    }
    for (const off of ['', 'NO', 'false', '0', '$(LP_SOCIAL_SIGN_IN)', '${SOCIAL}', 'on']) {
      setEnv({ EXPO_PUBLIC_SOCIAL_SIGN_IN: off });
      expect(env.socialSignInBuildEnabled).toBe(false);
    }
    setEnv({ EXPO_PUBLIC_SOCIAL_SIGN_IN: undefined });
    expect(env.socialSignInBuildEnabled).toBe(false);
  });

  it('is set for every EAS profile, so production builds offer the buttons (D1)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const eas = require('../../../../eas.json') as {
      build: Record<string, { extends?: string; env?: Record<string, string> }>;
    };
    const flagFor = (profile: string): string | undefined => {
      const entry = eas.build[profile];
      if (!entry) return undefined;
      return entry.env?.EXPO_PUBLIC_SOCIAL_SIGN_IN ?? (entry.extends ? flagFor(entry.extends) : undefined);
    };
    for (const profile of ['development', 'preview', 'production']) {
      setEnv({ EXPO_PUBLIC_SOCIAL_SIGN_IN: flagFor(profile) });
      expect(env.socialSignInBuildEnabled).toBe(true);
    }
  });

  it('is off in the test build, like the iOS test host built without the Secrets flag', () => {
    expect(env.socialSignInBuildEnabled).toBe(false);
  });
});

describe('the settings answer (GET /auth/v1/settings)', () => {
  it('decodes the external providers as GoTrue sends them', () => {
    const json =
      '{"external":{"anonymous_users":false,"apple":true,"email":true,"google":false,"phone":false},"disable_signup":false,"mailer_autoconfirm":false}';
    expect(decodeAuthSettings(json)).toEqual(APPLE_ONLY);
    expect(decodeAuthSettings('{"external":{}}')).toEqual(NO_SOCIAL_PROVIDERS);
    expect(decodeAuthSettings('{}')).toEqual(NO_SOCIAL_PROVIDERS);
    expect(decodeAuthSettings('{"external":{"apple":"true","google":1}}')).toEqual(NO_SOCIAL_PROVIDERS);
    expect(() => decodeAuthSettings('<html>')).toThrow();
    expect(() => decodeAuthSettings('[]')).toThrow();
    expect(() => decodeAuthSettings('null')).toThrow();
  });
});

describe('the read', () => {
  it('asks with the publishable key only, once per app session', async () => {
    authHost.on('GET', '/auth/v1/settings', Reply.json(200, settingsBody({ apple: true, google: true })));
    await expect(enabledSocialProviders()).resolves.toEqual(BOTH);
    await expect(enabledSocialProviders()).resolves.toEqual(BOTH);
    const reads = authHost.sentAll('/auth/v1/settings', 'GET');
    expect(reads).toHaveLength(1);
    expect(reads[0]!.headers.apikey).toBe(TEST_SUPABASE_ANON_KEY);
    expect(reads[0]!.headers.authorization).toBeUndefined();
    expect(cachedSocialProviders()).toEqual(BOTH);
  });

  it('shares one read between screens asking together', async () => {
    authHost.on('GET', '/auth/v1/settings', Reply.json(200, settingsBody({ apple: true })));
    const [a, b] = await Promise.all([enabledSocialProviders(), enabledSocialProviders()]);
    expect(a).toEqual(APPLE_ONLY);
    expect(b).toEqual(APPLE_ONLY);
    expect(authHost.sentAll('/auth/v1/settings')).toHaveLength(1);
  });

  it('a failed read is null, is not remembered, and the next screen asks again', async () => {
    authHost.once('GET', '/auth/v1/settings', Reply.json(503, { message: 'down' }));
    await expect(enabledSocialProviders()).resolves.toBeNull();
    expect(cachedSocialProviders()).toBeNull();

    authHost.once('GET', '/auth/v1/settings', Reply.raw(200, '<html>gateway</html>'));
    await expect(enabledSocialProviders()).resolves.toBeNull();

    authHost.once('GET', '/auth/v1/settings', Reply.fail());
    await expect(enabledSocialProviders()).resolves.toBeNull();

    authHost.once('GET', '/auth/v1/settings', Reply.json(200, settingsBody({ google: true })));
    await expect(enabledSocialProviders()).resolves.toEqual(GOOGLE_ONLY);
    expect(authHost.sentAll('/auth/v1/settings')).toHaveLength(4);
  });

  it('gives up after 10 seconds, like URLSession', async () => {
    expect(AUTH_SETTINGS_TIMEOUT_MS).toBe(10_000);
    jest.useFakeTimers();
    try {
      authHost.on('GET', '/auth/v1/settings', Reply.hang());
      const read = enabledSocialProviders();
      await jest.advanceTimersByTimeAsync(AUTH_SETTINGS_TIMEOUT_MS + 1);
      await expect(read).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('what the screens show', () => {
  it('a build without the flag shows nothing and never asks the server', async () => {
    authHost.on('GET', '/auth/v1/settings', Reply.json(200, settingsBody({ apple: true, google: true })));
    await expect(loadSocialProviders()).resolves.toEqual(NO_SOCIAL_PROVIDERS);
    expect(authHost.sentAll('/auth/v1/settings')).toHaveLength(0);
  });

  it('with the flag, what the server has on', async () => {
    setEnv({ EXPO_PUBLIC_SOCIAL_SIGN_IN: 'YES' });
    authHost.on('GET', '/auth/v1/settings', Reply.json(200, settingsBody({ google: true })));
    await expect(loadSocialProviders()).resolves.toEqual(GOOGLE_ONLY);
  });

  it('with the flag and a failed read, nothing', async () => {
    setEnv({ EXPO_PUBLIC_SOCIAL_SIGN_IN: 'YES' });
    authHost.on('GET', '/auth/v1/settings', Reply.json(500, { msg: 'boom' }));
    await expect(loadSocialProviders()).resolves.toEqual(NO_SOCIAL_PROVIDERS);
  });

  it('the forceSocialButtons fixture shows both without a read, in development only', async () => {
    setEnv({ EXPO_PUBLIC_FIXTURE: 'forceSocialButtons' });
    await expect(loadSocialProviders()).resolves.toEqual(BOTH);
    expect(authHost.sentAll('/auth/v1/settings')).toHaveLength(0);

    setDev(false);
    await expect(loadSocialProviders()).resolves.toEqual(NO_SOCIAL_PROVIDERS);
  });
});
