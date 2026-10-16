import { fireEvent, render, screen } from '@testing-library/react-native';

import Callout, { CALLOUT_ARROW, calloutPath } from '../Callout';

describe('calloutPath (iOS CalloutBubble)', () => {
  it('rises to an apex 22 in from the trailing edge, half the 44 pt button', () => {
    const path = calloutPath(260, 80);
    // Left base, apex at the top edge, right base, all on one path.
    expect(path).toContain(`L${260 - 22 - 8} ${CALLOUT_ARROW.height}`);
    expect(path).toContain(`L${260 - 22} 0`);
    expect(path).toContain(`L${260 - 22 + 8} ${CALLOUT_ARROW.height}`);
    expect(path.startsWith('M12 8')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
    // One closed outline: a single move.
    expect(path.match(/M/g)).toHaveLength(1);
  });

  it('never rounds a corner past half the card', () => {
    expect(calloutPath(20, 18).startsWith('M5 8')).toBe(true);
  });
});

it('reads its text and dismisses on a tap', async () => {
  const onDismiss = jest.fn();
  await render(<Callout text="Your bookings are here now." onDismiss={onDismiss} />);
  await fireEvent.press(screen.getByText('Your bookings are here now.'));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});
