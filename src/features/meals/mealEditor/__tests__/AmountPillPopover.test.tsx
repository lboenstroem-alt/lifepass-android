/**
 * The amount pill's card (iOS `multiplierPopover`): placed by the height it
 * measures, not a fixed one, so a card whose chips wrapped (a larger font
 * scale, a wider "1,25x") stays on screen and clear of the pill; and nothing
 * on it can be pressed before it is placed.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet, View } from 'react-native';

import { mealRecord, photoItemJson } from '../../itemEditor/__tests__/fixtures';
import { draftFromRecord } from '../../types/draftFactory';
import AmountPill, { cardPlacement } from '../AmountPillPopover';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const item = () => draftFromRecord(mealRecord({ items: [photoItemJson()], confirmed: false, source: 'photo' }).items[0]!);

/** The pill sits at this place on screen (the jest View answers no measurement by itself). */
function pillAt(y: number) {
  return jest
    .spyOn(View.prototype as unknown as { measureInWindow: (callback: (x: number, y: number, w: number, h: number) => void) => void }, 'measureInWindow')
    .mockImplementation((callback) => callback(280, y, 64, 44));
}

/** The card, also while it is still hidden from TalkBack (before it is placed). */
const card = () => screen.getByTestId('amountPill.popover', { includeHiddenElements: true });
const cardStyle = () => StyleSheet.flatten(card().props.style) as { top: number; opacity: number };

async function layoutCard(height: number) {
  await act(async () => {
    fireEvent(card(), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 328, height } } });
  });
}

afterEach(() => jest.restoreAllMocks());

describe('cardPlacement', () => {
  const window = { width: 390, height: 844 };
  const measured = { width: 328, height: 176 };

  it('goes under the pill when the measured card fits there', () => {
    expect(cardPlacement({ x: 300, y: 200, width: 64, height: 44 }, measured, window)).toEqual({ top: 248, left: 36 });
  });

  it('goes above it when it does not, by its measured height (two rows of chips)', () => {
    // 122 (one row) would fit under at y 650; 176 does not, and sits 4 above the pill.
    expect(cardPlacement({ x: 300, y: 650, width: 64, height: 44 }, measured, window).top).toBe(650 - 4 - 176);
  });

  it('stays on screen when it fits neither side', () => {
    const tall = { width: 328, height: 600 };
    expect(cardPlacement({ x: 300, y: 300, width: 64, height: 44 }, tall, window).top).toBe(844 - 12 - 600);
  });
});

describe('the card on screen', () => {
  it('is invisible and takes no touch until it is measured, then sits under the pill', async () => {
    pillAt(200);
    const onMultiply = jest.fn();
    await render(<AmountPill item={item()} onMultiply={onMultiply} onExact={jest.fn()} />);
    await act(async () => fireEvent.press(screen.getByTestId('amountPill')));

    expect(cardStyle().opacity).toBe(0);
    expect(card().props.pointerEvents).toBe('none');
    expect(card().props.importantForAccessibility).toBe('no-hide-descendants');
    // A chip can't be reached yet.
    expect(screen.queryByTestId('amountPill.multiplier.2')).toBeNull();

    await layoutCard(176);
    expect(cardStyle().opacity).toBe(1);
    expect(card().props.pointerEvents).toBe('auto');
    expect(cardStyle().top).toBe(200 + 44 + 4);

    await act(async () => fireEvent.press(screen.getByTestId('amountPill.multiplier.2')));
    expect(onMultiply).toHaveBeenCalledWith(2);
  });

  it('near the bottom it goes above the pill by the height it measured', async () => {
    const screenHeight = Dimensions.get('window').height;
    const y = screenHeight - 100;
    pillAt(y);
    await render(<AmountPill item={item()} onMultiply={jest.fn()} onExact={jest.fn()} />);
    await act(async () => fireEvent.press(screen.getByTestId('amountPill')));
    await layoutCard(176);
    expect(cardStyle().top).toBe(y - 4 - 176);
  });
});
