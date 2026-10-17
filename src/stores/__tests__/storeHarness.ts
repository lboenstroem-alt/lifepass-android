/**
 * Shared set-up for the app store's tests: a member's profile as the server
 * sends it, a Supabase session written where the app's client stores it, and
 * a clean store per test (a fresh launch, with what is stored kept).
 */
import NetInfo from '@react-native-community/netinfo';
import * as Localization from 'expo-localization';
import { Buffer } from 'node:buffer';

import { secureSessionStorage } from '../../lib/secureSessionStorage';
import { SUPABASE_STORAGE_KEY } from '../../supabase/lib/client';
import { resetAppStoreForTests } from '../appStore';

export const MEMBER_A = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
export const MEMBER_B = '3c4c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c22';

/** `GET /profile`'s data for a member (iOS AccountLanguageTests.profileJSON). */
export function profileJSON(
  options: { id?: string; locale?: string | null; createdAt?: string; kennitalaVerified?: boolean } & Record<
    string,
    unknown
  > = {},
): Record<string, unknown> {
  const { id = MEMBER_A, locale = 'en', ...rest } = options;
  const json: Record<string, unknown> = {
    id,
    email: 'member@example.com',
    kennitalaVerified: false,
    marketingConsent: false,
    ...rest,
  };
  if (locale !== null) json.locale = locale;
  return json;
}

/** Recorded from `GET /subscriptions`. */
export const PLUS_SUBSCRIPTION = {
  id: '5f0c2a6e-8a51-4e0b-9d7e-2b9a1f3c4d10',
  productSlug: 'plan-plus',
  productName: 'Plus',
  status: 'active',
  currentPeriodStartsAt: '2026-09-01T10:14:03.512Z',
  currentPeriodEndsAt: '2026-10-01T10:14:03.512Z',
  cancelAtPeriodEnd: false,
  cancelledAt: null,
};

export function jwt(userId: string, expiresInSeconds: number): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: userId, exp, role: 'authenticated' })}.c2lnbmF0dXJl`;
}

export function sessionJSON(userId: string, expiresInSeconds: number, refreshToken = 'refresh-1') {
  return {
    access_token: jwt(userId, expiresInSeconds),
    refresh_token: refreshToken,
    token_type: 'bearer',
    expires_in: expiresInSeconds,
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
    user: { id: userId, aud: 'authenticated', role: 'authenticated', email: 'member@example.com' },
  };
}

/** A session supabase-js stored on an earlier launch (expired when `expiresInSeconds` is negative). */
export async function storeSession(userId: string, expiresInSeconds = 3600): Promise<void> {
  await secureSessionStorage.setItem(SUPABASE_STORAGE_KEY, JSON.stringify(sessionJSON(userId, expiresInSeconds)));
}

/**
 * What NetInfo answers, cached and on a fresh read: src/api/connectivity
 * confirms a cached "disconnected" with NetInfo.refresh() (the library mock's
 * default is connected).
 */
export function netInfo(state: { isConnected: boolean | null; isInternetReachable: boolean | null }): void {
  jest.mocked(NetInfo.fetch).mockResolvedValue({ type: 'wifi', details: null, ...state } as never);
  jest.mocked(NetInfo.refresh).mockResolvedValue({ type: 'wifi', details: null, ...state } as never);
}

const restores: (() => void)[] = [];

/** The phone's own language for this test (restored after it). */
export function phoneLanguage(code: 'en' | 'is'): void {
  const locales = [{ languageCode: code, languageTag: code === 'is' ? 'is-IS' : 'en-GB' }] as never;
  // jest-expo's own mock of expo-localization is already a jest.fn: give it
  // back its implementation afterwards rather than "restoring" it to none.
  if (jest.isMockFunction(Localization.getLocales)) {
    const mock = jest.mocked(Localization.getLocales);
    const original = mock.getMockImplementation();
    mock.mockImplementation(() => locales);
    restores.push(() => {
      if (original) mock.mockImplementation(original);
    });
    return;
  }
  const spy = jest.spyOn(Localization, 'getLocales').mockReturnValue(locales);
  restores.push(() => spy.mockRestore());
}

/** Lets deferred work (the auth listener runs on the next turn) and promise chains finish. */
export async function settle(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/** Every store test starts from a fresh launch, online. */
export function freshStorePerTest(): void {
  beforeEach(() => {
    resetAppStoreForTests();
    netInfo({ isConnected: true, isInternetReachable: true });
  });
  afterEach(async () => {
    while (restores.length) restores.pop()!();
    resetAppStoreForTests();
    netInfo({ isConnected: true, isInternetReachable: true });
    await settle();
  });
}
