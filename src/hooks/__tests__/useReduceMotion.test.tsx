import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';

import { readReduceMotion, reduceMotionNow, useReduceMotion } from '../useReduceMotion';

function Probe() {
  return <Text testID="motion">{useReduceMotion() ? 'reduced' : 'full'}</Text>;
}

const isEnabled = AccessibilityInfo.isReduceMotionEnabled as jest.Mock;
const addListener = AccessibilityInfo.addEventListener as jest.Mock;

afterEach(async () => {
  isEnabled.mockImplementation(() => Promise.resolve(false));
  await readReduceMotion();
});

it('follows the system setting', async () => {
  isEnabled.mockImplementation(() => Promise.resolve(true));
  await render(<Probe />);
  expect(await screen.findByText('reduced')).toBeOnTheScreen();
});

it('starts a later screen with the cached answer, so nothing animates for a frame', async () => {
  isEnabled.mockImplementation(() => Promise.resolve(true));
  await readReduceMotion();
  expect(reduceMotionNow()).toBe(true);
  // The next read never answers: the first render already says reduced.
  isEnabled.mockImplementation(() => new Promise(() => undefined));
  await render(<Probe />);
  expect(screen.getByTestId('motion')).toHaveTextContent('reduced');
});

it('updates when the member changes the setting', async () => {
  await render(<Probe />);
  expect(screen.getByTestId('motion')).toHaveTextContent('full');
  const call = addListener.mock.calls.find(([event]) => event === 'reduceMotionChanged');
  expect(call).toBeDefined();
  await act(async () => call![1](true));
  expect(screen.getByTestId('motion')).toHaveTextContent('reduced');
});

it('a failed read keeps the last known value', async () => {
  isEnabled.mockImplementation(() => Promise.reject(new Error('no module')));
  await expect(readReduceMotion()).resolves.toBe(false);
});
