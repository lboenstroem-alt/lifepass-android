import { fireEvent, render, screen } from '@testing-library/react-native';

import ConfirmSheet from '../ConfirmSheet';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

function renderConfirm(destructive = true) {
  const order: string[] = [];
  const view = render(
    <ConfirmSheet
      visible
      title="End this plan?"
      body="Your history stays."
      confirmLabel="End plan"
      destructive={destructive}
      onConfirm={() => order.push('confirm')}
      onClose={() => order.push('close')}
    />,
  );
  return { order, view };
}

it('reads as a titled question with its body', async () => {
  await renderConfirm().view;
  expect(screen.getByRole('header', { name: 'End this plan?' })).toBeOnTheScreen();
  expect(screen.getByText('Your history stays.')).toBeOnTheScreen();
});

it('confirm closes the sheet, then runs the action (as iOS)', async () => {
  const { order, view } = renderConfirm();
  await view;
  await fireEvent.press(screen.getByRole('button', { name: 'End plan' }));
  expect(order).toEqual(['close', 'confirm']);
});

it('Cancel only closes', async () => {
  const { order, view } = renderConfirm();
  await view;
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(order).toEqual(['close']);
});
