/**
 * Toasts (iOS HealthToast and MealToastCenter): one at a time, spoken as they
 * appear, gone after their time, with an optional action.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { ACTION_TOAST_MS, TOAST_MS, ToastHost, dismissToast, showToast } from '../Toast';

const announce = AccessibilityInfo.announceForAccessibility as jest.Mock;
const recommended = AccessibilityInfo.getRecommendedTimeoutMillis as jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  recommended.mockImplementation((ms: number) => Promise.resolve(ms));
});

afterEach(async () => {
  await act(async () => dismissToast());
  jest.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

it('shows a message, says it to TalkBack, and is gone after 3.2 s', async () => {
  await render(<ToastHost />);
  await act(async () => showToast('Changed on another device'));
  expect(screen.getByText('Changed on another device')).toBeOnTheScreen();
  expect(announce).toHaveBeenCalledWith('Changed on another device');

  await advance(TOAST_MS - 100);
  expect(screen.getByText('Changed on another device')).toBeOnTheScreen();
  await advance(600);
  expect(screen.queryByText('Changed on another device')).toBeNull();
});

it('a new toast replaces the one on screen', async () => {
  await render(<ToastHost />);
  await act(async () => showToast('First'));
  await act(async () => showToast('Second'));
  expect(screen.queryByText('First')).toBeNull();
  expect(screen.getByText('Second')).toBeOnTheScreen();
});

it('a toast with an action runs it once and goes', async () => {
  const openDiary = jest.fn();
  await render(<ToastHost />);
  await act(async () => showToast('Saved to lunch', { action: { label: 'Food diary', onPress: openDiary } }));
  await fireEvent.press(screen.getByRole('button', { name: 'Food diary' }));
  expect(openDiary).toHaveBeenCalledTimes(1);
  await advance(400);
  expect(screen.queryByText('Saved to lunch')).toBeNull();
});

it("a toast with an action stays 4 s, or longer when the member's Time to take action asks", async () => {
  recommended.mockImplementation(() => Promise.resolve(10000));
  await render(<ToastHost />);
  await act(async () => showToast('Removed', { action: { label: 'Undo', onPress: jest.fn() } }));
  expect(recommended).toHaveBeenCalledWith(ACTION_TOAST_MS);
  await advance(ACTION_TOAST_MS + 500);
  expect(screen.getByText('Removed')).toBeOnTheScreen();
  await advance(10000);
  expect(screen.queryByText('Removed')).toBeNull();
});

it('an explicit duration wins', async () => {
  await render(<ToastHost />);
  await act(async () => showToast('Quick', { durationMs: 1000 }));
  await advance(1500);
  expect(screen.queryByText('Quick')).toBeNull();
});

it('ignores an empty message', async () => {
  await render(<ToastHost />);
  await act(async () => showToast(''));
  expect(screen.queryByTestId('toast')).toBeNull();
  expect(announce).not.toHaveBeenCalled();
});
