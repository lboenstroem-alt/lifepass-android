import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { dismissAllDialogs, showDialog } from '../Dialog';
import { dismissToast, showToast } from '../Toast';
import UiKitProvider from '../UiKitProvider';

afterEach(async () => {
  await act(async () => {
    dismissToast();
    dismissAllDialogs();
  });
});

it('hosts the app, toasts and dialogs once for the whole app', async () => {
  await render(
    <UiKitProvider toastBottomOffset={96}>
      <Text>App</Text>
    </UiKitProvider>,
  );
  expect(screen.getByText('App')).toBeOnTheScreen();
  await act(async () => {
    showToast('Saved');
    showDialog({ title: 'Discard this meal?', buttons: [{ label: 'Discard', role: 'destructive' }, { label: 'Cancel', role: 'cancel' }] });
  });
  expect(screen.getByText('Saved')).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'Discard this meal?' })).toBeOnTheScreen();
});
