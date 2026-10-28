/**
 * The dialog that carries more buttons than Android's Alert (plan 5.6): the
 * runner's Leave dialog has five.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';

import { restoreTestFontScale, setTestFontScale } from '../../../hooks/testing';
import { Dialog, DialogHost, dismissAllDialogs, orderButtons, showDialog, type DialogButton } from '../Dialog';

afterEach(async () => {
  await act(async () => dismissAllDialogs());
  restoreTestFontScale();
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

it('a question with two answers and no way out ignores back until it is answered', async () => {
  const onClose = jest.fn();
  await render(
    <Dialog
      visible
      onClose={onClose}
      title="Changed elsewhere"
      buttons={[{ label: 'Reload' }, { label: 'Keep mine' }]}
      testID="dialog"
    />,
  );
  await fireEvent(screen.getByTestId('dialog'), 'requestClose');
  expect(onClose).not.toHaveBeenCalled();
});

it('a one-button notice is acknowledged by back, which presses its button (iOS "Email sent", OK)', async () => {
  const onClose = jest.fn();
  const ok = jest.fn();
  await render(
    <Dialog visible onClose={onClose} title="Email sent" message="Check your inbox." buttons={[{ label: 'OK', onPress: ok }]} testID="dialog" />,
  );
  await fireEvent(screen.getByTestId('dialog'), 'requestClose');
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(ok).toHaveBeenCalledTimes(1);
});

it('a one-button notice that must not be closed by hand keeps ignoring back', async () => {
  const onClose = jest.fn();
  await render(<Dialog visible cancelable={false} onClose={onClose} title="Update" buttons={[{ label: 'OK' }]} testID="dialog" />);
  await fireEvent(screen.getByTestId('dialog'), 'requestClose');
  expect(onClose).not.toHaveBeenCalled();
});

describe('large text', () => {
  it('at a font scale of 2, every button of the five-button dialog sits in a scroll view the card bounds', async () => {
    setTestFontScale(2);
    await render(
      <Dialog
        visible
        onClose={jest.fn()}
        title="Leave the workout?"
        message="Your sets so far are saved on this phone until you choose what to do with them."
        buttons={leaveButtons(jest.fn())}
        testID="dialog"
      />,
    );
    const scroll = screen.getByTestId('dialog.scroll');
    for (const label of ['Save and finish', 'Save as done so far', 'Keep for later', 'Discard workout', 'Keep going']) {
      expect(within(scroll).getByRole('button', { name: label })).toBeOnTheScreen();
    }
    expect(within(scroll).getByRole('header', { name: 'Leave the workout?' })).toBeOnTheScreen();
    // The card never grows past the window, less a margin (zero system bars here).
    const card = scroll.parent!;
    const { maxHeight } = StyleSheet.flatten(card.props.style) as { maxHeight: number };
    expect(maxHeight).toBe(Dimensions.get('window').height - 48);
  });
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

describe("presentation 'actionSheet' (iOS .confirmationDialog)", () => {
  const discard = (spy: jest.Mock): DialogButton[] => [
    { label: 'Cancel', role: 'cancel', onPress: () => spy('cancel') },
    { label: 'Discard', role: 'destructive', onPress: () => spy('discard') },
  ];

  it('sits at the bottom: title and message on top, the answers, then Cancel in its own block', async () => {
    await render(
      <Dialog
        visible
        onClose={jest.fn()}
        presentation="actionSheet"
        titleVisibility="visible"
        title="Discard this workout?"
        message="It was not saved."
        buttons={discard(jest.fn())}
        testID="dialog"
      />,
    );
    const scrim = screen.getByTestId('dialog.sheet').parent!;
    expect(StyleSheet.flatten(scrim.props.style)).toMatchObject({ justifyContent: 'flex-end' });
    const group = screen.getByTestId('dialog.scroll');
    expect(within(group).getByRole('header', { name: 'Discard this workout?' })).toBeOnTheScreen();
    expect(within(group).getByText('It was not saved.')).toBeOnTheScreen();
    expect(within(group).getByRole('button', { name: 'Discard' })).toBeOnTheScreen();
    // Cancel is declared first, but drawn apart, below the group.
    expect(within(group).queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(within(screen.getByTestId('dialog.cancel')).getByRole('button', { name: 'Cancel' })).toBeOnTheScreen();
  });

  it("keeps the answers in iOS's declared order", async () => {
    await render(
      <Dialog
        visible
        onClose={jest.fn()}
        presentation="actionSheet"
        title="Language"
        buttons={[
          { label: 'English' },
          { label: 'Íslenska' },
          { label: 'Cancel', role: 'cancel' },
        ]}
      />,
    );
    expect(screen.getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual(['English', 'Íslenska', 'Cancel']);
  });

  it("hides the title unless asked, as iOS's default titleVisibility does on a phone", async () => {
    await render(
      <Dialog
        visible
        onClose={jest.fn()}
        presentation="actionSheet"
        title="Get directions"
        buttons={[{ label: 'Google Maps' }, { label: 'Cancel', role: 'cancel' }]}
      />,
    );
    expect(screen.queryByText('Get directions')).toBeNull();
    expect(screen.getByRole('button', { name: 'Google Maps' })).toBeOnTheScreen();
  });

  it('a press closes it, then runs the answer', async () => {
    const spy = jest.fn();
    const onClose = jest.fn(() => spy('close'));
    await render(
      <Dialog visible onClose={onClose} presentation="actionSheet" title="Discard?" buttons={discard(spy)} />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Discard' }));
    expect(spy.mock.calls.map(([what]) => what)).toEqual(['close', 'discard']);
  });

  it('back presses Cancel', async () => {
    const spy = jest.fn();
    await render(
      <Dialog visible onClose={jest.fn()} presentation="actionSheet" title="Discard?" buttons={discard(spy)} testID="dialog" />,
    );
    await fireEvent(screen.getByTestId('dialog'), 'requestClose');
    expect(spy).toHaveBeenCalledWith('cancel');
    expect(spy).not.toHaveBeenCalledWith('discard');
  });

  it('without a cancel button, back still closes it with no answer, as a tap outside does on iOS', async () => {
    const onClose = jest.fn();
    const onDismiss = jest.fn();
    const pick = jest.fn();
    await render(
      <Dialog
        visible
        onClose={onClose}
        onDismiss={onDismiss}
        presentation="actionSheet"
        title="Get directions"
        buttons={[{ label: 'Google Maps', onPress: pick }]}
        testID="dialog"
      />,
    );
    await fireEvent(screen.getByTestId('dialog'), 'requestClose');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(pick).not.toHaveBeenCalled();
  });

  it('showDialog takes the presentation too', async () => {
    await render(<DialogHost />);
    await act(async () => {
      showDialog({
        presentation: 'actionSheet',
        titleVisibility: 'visible',
        title: 'Delete meal?',
        buttons: [
          { label: 'Delete', role: 'destructive' },
          { label: 'Cancel', role: 'cancel' },
        ],
        testID: 'dialog',
      });
    });
    expect(screen.getByTestId('dialog.cancel')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Delete meal?' })).toBeOnTheScreen();
  });
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
