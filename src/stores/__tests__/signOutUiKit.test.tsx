/**
 * What the UI kit holds above the navigator goes with the member: a confirm
 * queued for them, or a toast about their data, never reaches the sign-in
 * screens and the next person on the phone (the UI kit's reset, run by the
 * sign-out registry).
 */
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { stubApiClientPerTest } from '../../api/testing';
import { registeredHookIds } from '../../app/signOut';
import { dismissAllDialogs, showDialog } from '../../components/ui/Dialog';
import { dismissToast, showToast } from '../../components/ui/Toast';
import UiKitProvider from '../../components/ui/UiKitProvider';
import { useAppStore } from '../appStore';

import { freshStorePerTest, MEMBER_A } from './storeHarness';

stubApiClientPerTest();
freshStorePerTest();

afterEach(async () => {
  await act(async () => {
    dismissToast();
    dismissAllDialogs();
  });
});

it('is registered with the sign-out cleaners', () => {
  expect(registeredHookIds().signOut).toContain('ui-kit');
});

it("a sign-out drops the member's queued dialogs and toast without running a button", async () => {
  const cancelBooking = jest.fn();
  await render(
    <UiKitProvider>
      <Text>App</Text>
    </UiKitProvider>,
  );
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER_A });
  await act(async () => {
    showToast('Meal saved');
    showDialog({
      title: 'Cancel your booking at Laugardalslaug?',
      buttons: [
        { label: 'Cancel booking', role: 'destructive', onPress: cancelBooking },
        { label: 'Keep', role: 'cancel' },
      ],
    });
  });
  expect(screen.getByText('Meal saved')).toBeOnTheScreen();

  await act(async () => {
    await useAppStore.getState().handleSignOut();
  });

  // The toast fades out, then goes.
  await waitFor(() => expect(screen.queryByText('Meal saved')).toBeNull());
  expect(screen.queryByText('Cancel your booking at Laugardalslaug?')).toBeNull();
  expect(cancelBooking).not.toHaveBeenCalled();
});
