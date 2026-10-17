/**
 * Shared set-up for the money rail tests: a signed-in member, every rail's
 * memory reset per test, the waits at zero, and a way to kill the "process"
 * (forget everything in memory, keep what is stored), as Android does behind
 * a Custom Tab.
 *
 * Each test file still mocks expo-web-browser itself (jest hoists the mock
 * into the file that declares it):
 *
 *   jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';

import { decodeProfile } from '../../api/profile';
import { dismissAllDialogs } from '../../components/ui/Dialog';
import { resetAppStoreForTests, useAppStore } from '../../stores/appStore';
import { MEMBER_A, profileJSON } from '../../stores/__tests__/storeHarness';
import { resetAttemptsForTests } from '../attempts';
import { resetPaymentSessionsForTests } from '../bookingPaymentSession';
import { resetRecoveryForTests } from '../coldStartRecovery';
import { resetHostedPageForTests } from '../hostedPage';
import { inflightStorageKey, resetInflightMemoryForTests, type InflightRecord } from '../inflight';
import { resetPresentersForTests } from '../presenters';
import { NO_WAITS, setPaymentTimingForTests } from '../timing';

export { MEMBER_A };
export const MEMBER_B = '3c4c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c22';

/** `usage` as `GET /profile` sends it, with these passes. */
export function usageJSON(passes: { id: string; type?: string }[] = []): Record<string, unknown> {
  return {
    tier: null,
    network: null,
    pools: null,
    daily: null,
    concurrent: { open: 0, cap: null },
    topup: { available: false, prices: { gym: null, studio: null, pool: null } },
    passes: passes.map((pass) => ({
      id: pass.id,
      type: pass.type ?? 'day',
      visitsLeft: 1,
      expiresAt: '2026-12-31T23:59:59.000Z',
    })),
    block: { until: null },
    strikes: { active: 0, threshold: 3 },
  };
}

/** The member signed in with their profile loaded, as after launch. */
export function signIn(memberId: string = MEMBER_A, profile: Record<string, unknown> = {}): void {
  useAppStore.setState({
    isAuthenticated: true,
    isLoading: false,
    userId: memberId,
    profile: decodeProfile(profileJSON({ id: memberId, ...profile })),
  });
}

/** Everything a process keeps in memory, gone; storage kept. */
export function killProcess(): void {
  resetInflightMemoryForTests();
  resetHostedPageForTests();
  resetRecoveryForTests();
  resetAttemptsForTests();
  resetPaymentSessionsForTests();
  resetAppStoreForTests();
}

/** The link the app was (cold-)started with. */
export function launchedWith(url: string | null): void {
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(url as string);
}

/** The member's stored in-flight records, as saved. */
export async function storedRecords(memberId: string = MEMBER_A): Promise<InflightRecord[]> {
  const raw = await AsyncStorage.getItem(inflightStorageKey(memberId));
  return raw ? (JSON.parse(raw) as InflightRecord[]) : [];
}

/** A fresh phone per test: rails' memory, presenters, dialogs and the store reset; no waits. */
export function freshPaymentsPerTest(): void {
  beforeEach(() => {
    killProcess();
    resetPresentersForTests();
    dismissAllDialogs();
    setPaymentTimingForTests(NO_WAITS);
    launchedWith(null);
  });
  afterEach(() => {
    dismissAllDialogs();
    setPaymentTimingForTests(null);
    jest.restoreAllMocks();
    resetAppStoreForTests();
  });
}

/** Lets promise chains and zero-length waits run. */
export async function flush(turns = 10): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
