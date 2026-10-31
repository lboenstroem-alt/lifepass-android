/**
 * Skeletons (iOS HealthSkeleton): pulse, but sit still under Remove
 * animations, and are never read by TalkBack.
 */
import { act, isHiddenFromAccessibility, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Animated } from 'react-native';

import { readReduceMotion } from '../../../hooks/useReduceMotion';
import { SkeletonBlock, SkeletonCard } from '../Skeleton';

const isReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled as jest.Mock;

afterEach(async () => {
  jest.restoreAllMocks();
  isReduceMotionEnabled.mockImplementation(() => Promise.resolve(false));
  await readReduceMotion();
});

it('pulses with motion on', async () => {
  const loop = jest.spyOn(Animated, 'loop');
  await render(<SkeletonBlock testID="block" />);
  expect(loop).toHaveBeenCalled();
});

it('is static with reduce motion on', async () => {
  isReduceMotionEnabled.mockImplementation(() => Promise.resolve(true));
  await readReduceMotion();
  const loop = jest.spyOn(Animated, 'loop');
  await render(<SkeletonBlock testID="block" />);
  await waitFor(() => expect(isReduceMotionEnabled).toHaveBeenCalled());
  expect(loop).not.toHaveBeenCalled();
  const block = screen.getByTestId('block', { includeHiddenElements: true });
  expect(block).toHaveStyle({ opacity: 1 });
});

it('stops pulsing when the member turns on reduce motion', async () => {
  const stop = jest.fn();
  const start = jest.fn();
  jest.spyOn(Animated, 'loop').mockReturnValue({ start, stop, reset: jest.fn() });
  await render(<SkeletonBlock testID="block" />);
  expect(start).toHaveBeenCalledTimes(1);
  const listener = (AccessibilityInfo.addEventListener as jest.Mock).mock.calls.find(
    ([event]) => event === 'reduceMotionChanged',
  )![1];
  await act(async () => listener(true));
  expect(stop).toHaveBeenCalled();
});

it('is hidden from TalkBack, block and card alike', async () => {
  await render(
    <>
      <SkeletonBlock testID="block" />
      <SkeletonCard testID="card" rows={2} />
    </>,
  );
  expect(isHiddenFromAccessibility(screen.getByTestId('block', { includeHiddenElements: true }))).toBe(true);
  expect(isHiddenFromAccessibility(screen.getByTestId('card', { includeHiddenElements: true }))).toBe(true);
  expect(screen.queryByTestId('block')).toBeNull();
});

describe('a card draws the rows it is asked for, at least one', () => {
  /** Every block in the card: a row is an icon and two lines, the header two more. */
  async function blocksIn(element: React.ReactElement): Promise<number> {
    const view = await render(element);
    const count = screen.getAllByTestId('card.block', { includeHiddenElements: true }).length;
    await view.unmount();
    return count;
  }

  it('rows 0 still draws one row', async () => {
    expect(await blocksIn(<SkeletonCard testID="card" rows={0} showsHeader={false} />)).toBe(3);
  });

  it('rows 2 draws two', async () => {
    expect(await blocksIn(<SkeletonCard testID="card" rows={2} showsHeader={false} />)).toBe(6);
  });

  it('the header adds its two lines', async () => {
    expect(await blocksIn(<SkeletonCard testID="card" rows={2} />)).toBe(8);
  });
});
