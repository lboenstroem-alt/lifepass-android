/**
 * The proof full screen (iOS `fullScreenCover` around `CheckInProofDisplay`):
 * the proof stays drawn while the cover slides out, as iOS clears its
 * snapshot only in `onDismiss`, once the cover has gone; and Done and
 * hardware back are the ways out.
 *
 * Jest's Modal draws nothing once it is closed, so the closing frames cannot
 * be seen through it. This file stands a Modal in that keeps drawing and says
 * whether it is open, which is what the slide-out shows.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { restoreTestFontScale, setTestFontScale } from '../../../../hooks/testing';
import { setCurrentLanguage } from '../../../../i18n';
import CheckInProofCover from '../CheckInProofCover';
import type { CheckInProofDisplayProps } from '../CheckInProofDisplay';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  function ModalDouble({
    visible,
    onRequestClose,
    children,
  }: {
    visible?: boolean;
    onRequestClose?: () => void;
    children?: React.ReactNode;
  }) {
    // Back reaches the stand-in as the Modal's own onRequestClose.
    const props = { testID: 'modal', accessibilityState: { expanded: visible === true }, onRequestClose };
    return React.createElement(View, props as React.ComponentProps<typeof View>, children);
  }
  return { __esModule: true, default: ModalDouble };
});

/** Thursday 23 April 2026, 14:32 in Reykjavík. */
const AT = new Date('2026-04-23T14:32:00Z');

function proof(venueName: string): CheckInProofDisplayProps {
  return {
    checkedInAt: AT,
    venueName,
    memberShortName: 'Anna J.',
    activityName: null,
    confirmationCode: null,
    party: null,
    hint: null,
    mark: <Text>mark</Text>,
  };
}

function isOpen(): boolean {
  return screen.getByTestId('modal').props.accessibilityState.expanded;
}

beforeEach(() => {
  setCurrentLanguage('en');
  setTestFontScale(1);
});

afterEach(() => restoreTestFontScale());

it('keeps the proof it showed drawn while it slides out, not an empty page with Done', async () => {
  const onDone = jest.fn();
  const view = await render(<CheckInProofCover visible proof={proof('World Class Laugar')} onDone={onDone} />);
  expect(isOpen()).toBe(true);
  expect(screen.getByText('World Class Laugar')).toBeOnTheScreen();

  // The caller closes it by dropping both together (the banner on Done).
  await view.rerender(<CheckInProofCover visible={false} proof={null} onDone={onDone} />);
  expect(isOpen()).toBe(false);
  expect(screen.getByText('World Class Laugar')).toBeOnTheScreen();
  expect(screen.getByText('14:32')).toBeOnTheScreen();
});

it('opens on the new proof, never the one it last closed on', async () => {
  const onDone = jest.fn();
  const view = await render(<CheckInProofCover visible proof={proof('World Class Laugar')} onDone={onDone} />);
  await view.rerender(<CheckInProofCover visible={false} proof={null} onDone={onDone} />);
  await view.rerender(<CheckInProofCover visible proof={proof('Sundhöllin')} onDone={onDone} />);
  expect(isOpen()).toBe(true);
  expect(screen.getByText('Sundhöllin')).toBeOnTheScreen();
  expect(screen.queryByText('World Class Laugar')).toBeNull();
});

it('is not open without a proof, even when asked to be', async () => {
  await render(<CheckInProofCover visible proof={null} onDone={jest.fn()} />);
  expect(isOpen()).toBe(false);
});

it('closes with Done and with hardware back', async () => {
  const onDone = jest.fn();
  await render(<CheckInProofCover visible proof={proof('World Class Laugar')} onDone={onDone} testID="cover" />);
  await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
  expect(onDone).toHaveBeenCalledTimes(1);
  // Android's back button reaches the Modal as onRequestClose.
  await fireEvent(screen.getByTestId('modal'), 'requestClose');
  expect(onDone).toHaveBeenCalledTimes(2);
});
