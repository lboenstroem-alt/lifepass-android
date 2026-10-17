/**
 * iOS Plan's ConfirmSheet: a titled question with a body, Confirm closes and
 * then acts, Cancel only closes. One answer per showing, and the buttons stay
 * reachable at the largest text.
 *
 * Run on the kit's stand-in for the sheet library, which has the footer slot
 * the buttons live in on a phone.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { useState } from 'react';

import { restoreTestFontScale, setTestFontScale } from '../../../hooks/testing';
import ConfirmSheet from '../ConfirmSheet';
import { bottomSheetMock } from '../testing/bottomSheetMock';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

beforeEach(() => {
  bottomSheetMock.reset();
  setTestFontScale(1);
});
afterEach(() => restoreTestFontScale());

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
      testID="confirm"
    />,
  );
  return { order, view };
}

/** A parent that closes the sheet when asked, as every caller does. */
function Parent({ onConfirm, onShown }: { onConfirm: () => void; onShown?: (reopen: () => void) => void }) {
  const [visible, setVisible] = useState(true);
  onShown?.(() => setVisible(true));
  return (
    <ConfirmSheet
      visible={visible}
      title="End this plan?"
      body="Your history stays."
      confirmLabel="End plan"
      destructive
      onConfirm={onConfirm}
      onClose={() => setVisible(false)}
    />
  );
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

describe('one answer per showing', () => {
  it('a double tap on Confirm while the sheet slides away ends the plan once', async () => {
    // The slide-out takes a moment on a phone: hold it there.
    bottomSheetMock.settleDismiss = false;
    const onConfirm = jest.fn();
    await render(<Parent onConfirm={onConfirm} />);
    const confirm = screen.getByRole('button', { name: 'End plan' });
    await fireEvent.press(confirm);
    await fireEvent.press(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('even a parent that keeps it up gets one answer: Confirm, then Cancel or Confirm again, do nothing more', async () => {
    const { order, view } = renderConfirm();
    await view;
    await fireEvent.press(screen.getByRole('button', { name: 'End plan' }));
    await fireEvent.press(screen.getByRole('button', { name: 'End plan' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(order).toEqual(['close', 'confirm']);
  });

  it('shown again, it takes a new answer', async () => {
    const onConfirm = jest.fn();
    let reopen = () => {};
    await render(
      <Parent
        onConfirm={onConfirm}
        onShown={(open) => {
          reopen = open;
        }}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'End plan' }));
    expect(screen.queryByRole('button', { name: 'End plan' })).toBeNull();
    await act(async () => reopen());
    await fireEvent.press(screen.getByRole('button', { name: 'End plan' }));
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });
});

it('at the largest text, Confirm and Cancel sit in the pinned footer, never pushed off the sheet', async () => {
  setTestFontScale(2);
  await renderConfirm().view;
  const footer = screen.getByTestId('confirm.footer');
  expect(within(footer).getByRole('button', { name: 'End plan' })).toBeOnTheScreen();
  expect(within(footer).getByRole('button', { name: 'Cancel' })).toBeOnTheScreen();
  // The title and body scroll above them.
  expect(within(screen.getByTestId('confirm.content')).getByRole('header', { name: 'End this plan?' })).toBeOnTheScreen();
});
