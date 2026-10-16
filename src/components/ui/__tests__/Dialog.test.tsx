/**
 * The dialog that carries more buttons than Android's Alert (plan 5.6): the
 * runner's Leave dialog has five.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { Dialog, DialogHost, dismissAllDialogs, orderButtons, showDialog, type DialogButton } from '../Dialog';

afterEach(async () => {
  await act(async () => dismissAllDialogs());
});

const leaveButtons = (spy: jest.Mock): DialogButton[] => [
  { label: 'Save and finish', onPress: () => spy('save') },
  { label: 'Save as done so far', onPress: () => spy('partial') },
  { label: 'Keep for later', onPress: () => spy('later') },
  { label: 'Discard workout', role: 'destructive', onPress: () => spy('discard') },
  { label: 'Keep going', role: 'cancel', onPress: () => spy('cancel') },
];

it('renders five buttons, stacked, with the cancel one last', async () => {
  const spy = jest.fn();
  await render(<Dialog visible onClose={jest.fn()} title="Leave the workout?" buttons={leaveButtons(spy)} />);
  const buttons = screen.getAllByRole('button');
  expect(buttons.map((b) => b.props.accessibilityLabel)).toEqual([
    'Save and finish',
    'Save as done so far',
    'Keep for later',
    'Discard workout',
    'Keep going',
  ]);
  expect(screen.getByRole('header', { name: 'Leave the workout?' })).toBeOnTheScreen();
});

it('puts two short buttons side by side, cancel first, as iOS and Material do', () => {
  const { stacked, ordered } = orderButtons([
    { label: 'Delete', role: 'destructive' },
    { label: 'Cancel', role: 'cancel' },
  ]);
  expect(stacked).toBe(false);
  expect(ordered.map((b) => b.label)).toEqual(['Cancel', 'Delete']);
});

it('stacks two buttons whose labels do not fit side by side', () => {
  expect(orderButtons([{ label: 'Save it as an extra workout' }, { label: 'Cancel', role: 'cancel' }]).stacked).toBe(true);
});

it('a press closes the dialog, then runs the action', async () => {
  const order: string[] = [];
  await render(
    <Dialog
      visible
      onClose={() => order.push('close')}
      title="Discard?"
      buttons={[
        { label: 'Discard', role: 'destructive', onPress: () => order.push('discard') },
        { label: 'Cancel', role: 'cancel' },
      ]}
    />,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Discard' }));
  expect(order).toEqual(['close', 'discard']);
});

it('hardware back presses the cancel button', async () => {
  const spy = jest.fn();
  const onClose = jest.fn();
  await render(<Dialog visible onClose={onClose} title="Leave the workout?" buttons={leaveButtons(spy)} testID="dialog" />);
  await fireEvent(screen.getByTestId('dialog'), 'requestClose');
  expect(spy).toHaveBeenCalledWith('cancel');
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('a question with no way out ignores back until it is answered', async () => {
  const onClose = jest.fn();
  await render(<Dialog visible onClose={onClose} title="Changed elsewhere" buttons={[{ label: 'Reload' }]} testID="dialog" />);
  await fireEvent(screen.getByTestId('dialog'), 'requestClose');
  expect(onClose).not.toHaveBeenCalled();
});

it('a cancelable dialog without a cancel button closes on back and reports it', async () => {
  const onClose = jest.fn();
  const onDismiss = jest.fn();
  await render(
    <Dialog visible cancelable onClose={onClose} onDismiss={onDismiss} title="Note" buttons={[{ label: 'OK' }]} testID="dialog" />,
  );
  await fireEvent(screen.getByTestId('dialog'), 'requestClose');
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it('draws nothing while hidden', async () => {
  await render(<Dialog visible={false} onClose={jest.fn()} title="Hidden" buttons={[{ label: 'OK' }]} />);
  expect(screen.queryByText('Hidden')).toBeNull();
});

describe('showDialog and the host', () => {
  it('shows a dialog from anywhere, one at a time, in order', async () => {
    const answers: string[] = [];
    await render(<DialogHost />);
    await act(async () => {
      showDialog({ title: 'First', buttons: [{ label: 'OK', onPress: () => answers.push('first') }] });
      showDialog({ title: 'Second', message: 'Then this', buttons: [{ label: 'Fine', onPress: () => answers.push('second') }] });
    });
    expect(screen.getByText('First')).toBeOnTheScreen();
    expect(screen.queryByText('Second')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByText('First')).toBeNull();
    expect(screen.getByText('Then this')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Fine' }));
    expect(answers).toEqual(['first', 'second']);
    expect(screen.queryByText('Second')).toBeNull();
  });

  it('dismissAllDialogs clears the queue (sign-out)', async () => {
    await render(<DialogHost />);
    await act(async () => {
      showDialog({ title: 'Stale', buttons: [{ label: 'OK' }] });
    });
    expect(screen.getByText('Stale')).toBeOnTheScreen();
    await act(async () => dismissAllDialogs());
    expect(screen.queryByText('Stale')).toBeNull();
  });
});
