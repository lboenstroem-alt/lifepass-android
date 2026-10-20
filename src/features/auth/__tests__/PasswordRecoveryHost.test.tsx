/**
 * Set a new password after a reset link (iOS SetNewPasswordView): shown over
 * everything while the app store says so, closed only by "Later" or a changed
 * password (never by back), at least 12 characters and the same twice, the
 * change made through Supabase, and a sign-out takes it away.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { Reply, supabase as authHost } from '@test/server';

import { lookup, type Lang } from '../../../i18n';
import { freshStorePerTest, MEMBER_A, phoneLanguage, sessionJSON } from '../../../stores/__tests__/storeHarness';
import { resetAppStoreForTests, useAppStore } from '../../../stores/appStore';
import { supabase } from '../../../supabase/lib/client';
import PasswordRecoveryHost from '../PasswordRecoveryHost';
import { RECOVERY_PENDING_KEY } from '../recovery';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

freshStorePerTest();

afterEach(async () => {
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
});

const en = (key: string) => lookup(key, 'en');
const newField = () => screen.getByTestId('auth.setNewPassword.password');
const confirmField = () => screen.getByTestId('auth.setNewPassword.confirm');
const submit = () => fireEvent.press(screen.getByTestId('auth.setNewPassword.submit'));

async function openRecovery(lang: Lang = 'en') {
  phoneLanguage(lang);
  resetAppStoreForTests();
  useAppStore.setState({ isLoading: false, pendingPasswordRecovery: true });
  // As the reset link leaves it: written down for a restart.
  await AsyncStorage.setItem(RECOVERY_PENDING_KEY, JSON.stringify({ userId: MEMBER_A, at: Date.now() }));
  await render(<PasswordRecoveryHost />);
}

/** The reset link's session, live, as the screen expects it. */
async function recoverySession() {
  const session = sessionJSON(MEMBER_A, 3600);
  authHost.on('GET', '/auth/v1/user', Reply.json(200, session.user));
  await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  return session;
}

it('shows nothing unless a reset link asked for it', async () => {
  resetAppStoreForTests();
  await render(<PasswordRecoveryHost />);
  expect(screen.queryByText(en('auth.set_new_title'))).toBeNull();
});

it.each<Lang>(['en', 'is'])('%s: asks for 12 characters, then the same twice', async (lang) => {
  await openRecovery(lang);
  expect(screen.getByRole('header', { name: lookup('auth.set_new_title', lang) })).toBeOnTheScreen();
  expect(screen.getByText(lookup('auth.set_new_body', lang))).toBeOnTheScreen();

  await fireEvent.changeText(newField(), 'short');
  await fireEvent.changeText(confirmField(), 'short');
  await submit();
  expect(screen.getByText(lookup('auth.err.password_short', lang))).toBeOnTheScreen();

  await fireEvent.changeText(newField(), 'a long new password');
  await submit();
  expect(screen.getByText(lookup('auth.err.password_mismatch', lang))).toBeOnTheScreen();
  expect(authHost.requests).toHaveLength(0);
});

it('changes the password, says so, and OK closes it', async () => {
  await recoverySession();
  authHost.on('PUT', '/auth/v1/user', Reply.json(200, sessionJSON(MEMBER_A, 3600).user));
  await openRecovery();

  await fireEvent.changeText(newField(), 'a long new password');
  await fireEvent.changeText(confirmField(), 'a long new password');
  await submit();

  await waitFor(() => expect(screen.getByText(en('auth.password_updated_title'))).toBeOnTheScreen());
  expect((authHost.sent('/auth/v1/user', 'PUT').body as { password: string }).password).toBe('a long new password');
  expect(useAppStore.getState().pendingPasswordRecovery).toBe(true);
  // Changed: a restart before OK must not ask again.
  await waitFor(async () => expect(await AsyncStorage.getItem(RECOVERY_PENDING_KEY)).toBeNull());

  await fireEvent.press(screen.getByRole('button', { name: en('common.ok') }));
  expect(useAppStore.getState().pendingPasswordRecovery).toBe(false);
  expect(screen.queryByText(en('auth.set_new_title'))).toBeNull();
});

it('shows why a change was refused, and stays', async () => {
  await recoverySession();
  authHost.on(
    'PUT',
    '/auth/v1/user',
    Reply.json(422, { code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.' }),
  );
  await openRecovery();
  await fireEvent.changeText(newField(), 'a long new password');
  await fireEvent.changeText(confirmField(), 'a long new password');
  await submit();
  await waitFor(() => expect(screen.getByText('New password should be different from the old password.')).toBeOnTheScreen());
  expect(useAppStore.getState().pendingPasswordRecovery).toBe(true);
});

it('"Later" closes it without a change, and a restart does not bring it back', async () => {
  await openRecovery();
  await fireEvent.press(screen.getByRole('button', { name: en('auth.later') }));
  expect(useAppStore.getState().pendingPasswordRecovery).toBe(false);
  expect(authHost.requests).toHaveLength(0);
  await waitFor(async () => expect(await AsyncStorage.getItem(RECOVERY_PENDING_KEY)).toBeNull());
});

it('back does not close it (only Later does)', async () => {
  await openRecovery();
  const modal = screen.getByTestId('auth.setNewPassword');
  await act(async () => {
    (modal.props as { onRequestClose: () => void }).onRequestClose();
  });
  expect(useAppStore.getState().pendingPasswordRecovery).toBe(true);
  expect(screen.getByText(en('auth.set_new_title'))).toBeOnTheScreen();
});

it('a sign-out takes it away: there is no session left to change', async () => {
  await openRecovery();
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER_A });
  await act(async () => {
    await useAppStore.getState().handleSignOut();
  });
  expect(useAppStore.getState().pendingPasswordRecovery).toBe(false);
});
