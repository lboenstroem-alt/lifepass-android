/**
 * The first build's hooks now read the one app store: the launch runs once
 * whoever asks, a signed-in member's session is what RootNavigator gates on,
 * and every screen sees one plan that a failed read never takes away.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { useAppStore } from '../../../stores/appStore';
import {
  freshStorePerTest,
  MEMBER_A,
  PLUS_SUBSCRIPTION,
  profileJSON,
  storeSession,
} from '../../../stores/__tests__/storeHarness';
import { fetchRecentCheckIn } from '../../services/profile';
import { useAuth } from '../useAuth';
import { useSubscription } from '../useSubscription';

// The first build's auth service builds its OAuth redirect from the app
// manifest when it loads, which a unit test has none of; these tests never
// sign in through it.
jest.mock('../../services/auth', () => ({ signIn: jest.fn(), signUp: jest.fn() }));

stubApiClientPerTest();
freshStorePerTest();

it('useAuth starts the launch and gates on the restored session', async () => {
  await storeSession(MEMBER_A);
  api.on('GET', '/profile', Reply.ok(profileJSON({ kennitalaVerified: true })));
  api.on('GET', '/subscriptions', Reply.ok(null));
  const loading: boolean[] = [];
  const { result } = await renderHook(() => {
    const auth = useAuth();
    loading.push(auth.loading);
    return auth;
  });
  await waitFor(() => expect(result.current.loading).toBe(false));
  // The launch screen showed first, while the session and profile were read.
  expect(loading[0]).toBe(true);
  expect(result.current.session?.user.id).toBe(MEMBER_A);
  expect(result.current.user?.id).toBe(MEMBER_A);
});

it('useSubscription shows one shared plan and keeps it through a failed read', async () => {
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER_A });
  api.once('GET', '/subscriptions', Reply.ok(PLUS_SUBSCRIPTION));
  const { result } = await renderHook(() => useSubscription());
  await waitFor(() => expect(result.current.subscription?.productSlug).toBe('plan-plus'));
  expect(result.current.loading).toBe(false);

  api.on('GET', '/subscriptions', Reply.problem(503, 'internal_error'));
  await act(async () => result.current.refetch());
  await waitFor(() => expect(api.sentAll('/subscriptions', 'GET')).toHaveLength(2));
  expect(result.current.subscription?.productSlug).toBe('plan-plus');
  expect(result.current.error).toBeNull();
});

it("the check-in banner's read refreshes the store's profile and shows only the short name", async () => {
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER_A });
  api.on(
    'GET',
    '/profile',
    Reply.ok(
      profileJSON({
        recentCheckIn: {
          checkInId: '7c1f2ab3-9d54-4e88-9a01-4f21a0c93b77',
          checkedInAt: '2026-04-23T14:32:00Z',
          memberName: 'Anna Jonsdottir',
          memberShortName: 'Anna J.',
          venue: { id: 'v1', name: 'Laugar Spa' },
          activity: null,
        },
      }),
    ),
  );
  const checkIn = await fetchRecentCheckIn();
  expect(checkIn?.memberName).toBe('Anna J.');
  expect(useAppStore.getState().profile?.recentCheckIn?.checkInId).toBe('7c1f2ab3-9d54-4e88-9a01-4f21a0c93b77');

  // A failed read keeps the proof that was showing.
  api.on('GET', '/profile', Reply.fail());
  expect((await fetchRecentCheckIn())?.memberName).toBe('Anna J.');
});
