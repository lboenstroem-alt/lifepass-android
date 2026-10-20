/**
 * The account row primitives (iOS AccountRows.swift): what a row says to
 * TalkBack, when it draws a chevron, a disabled row, and the card that hides
 * the first row's divider.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { hairline } from '../../../theme';
import { AccountCard, AccountRowButton, AccountRowLabel, AccountSection, accountRowLabel } from '../rows';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const chevrons = () => screen.queryAllByTestId('account.row.chevron', { includeHiddenElements: true });

it('reads the title, then the subtitle', () => {
  expect(accountRowLabel('Language', 'English')).toBe('Language, English');
  expect(accountRowLabel('Receipts & invoices')).toBe('Receipts & invoices');
  expect(accountRowLabel('Receipts & invoices', null)).toBe('Receipts & invoices');
});

it('a row is one button with its words, and the whole row presses', async () => {
  const onPress = jest.fn();
  await render(<AccountRowButton title="Language" subtitle="English" onPress={onPress} />);
  const row = screen.getByRole('button', { name: 'Language, English' });
  expect(screen.getByText('English')).toBeOnTheScreen();
  await fireEvent.press(row);
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(chevrons()).toHaveLength(1);
});

it('a dim row (Log out) has no chevron', async () => {
  await render(<AccountRowButton title="Log out" dim onPress={jest.fn()} />);
  expect(chevrons()).toHaveLength(0);
});

it('the chevron can be forced off, or replaced by an accessory', async () => {
  await render(
    <AccountCard>
      <AccountRowButton title="A" showsChevron={false} onPress={jest.fn()} />
      <AccountRowButton title="B" accessory={<Text testID="share-icon">↑</Text>} onPress={jest.fn()} />
    </AccountCard>,
  );
  expect(chevrons()).toHaveLength(0);
  expect(screen.getByTestId('share-icon', { includeHiddenElements: true })).toBeOnTheScreen();
});

it('a disabled row says so and does not press', async () => {
  const onPress = jest.fn();
  await render(<AccountRowButton title="Body and goals" isEnabled={false} onPress={onPress} />);
  const row = screen.getByRole('button', { name: 'Body and goals' });
  expect(row).toBeDisabled();
  await fireEvent.press(row);
  expect(onPress).not.toHaveBeenCalled();
});

/** Whether this view, or any view it sits in, is drawn below full opacity. */
function dimmed(element: { props: { style?: unknown }; parent: unknown } | null): boolean {
  for (let node = element; node; node = node.parent as typeof element) {
    const opacity = (StyleSheet.flatten(node.props.style as never) as { opacity?: number } | undefined)?.opacity;
    if (typeof opacity === 'number' && opacity < 1) return true;
  }
  return false;
}

it('a dimmed row keeps the hairline above it at full strength (iOS dims the row, not the divider)', async () => {
  await render(
    <AccountCard>
      <AccountRowButton title="Language" isEnabled={false} onPress={jest.fn()} />
      <AccountRowButton title="Help" opacity={0.55} onPress={jest.fn()} />
      <AccountRowLabel title="Body and goals" subtitle="Not for under 18s" showsChevron={false} opacity={0.55} />
    </AccountCard>,
  );
  const dividers = screen.getAllByTestId('account.divider', { includeHiddenElements: true });
  expect(dividers).toHaveLength(3);
  for (const divider of dividers) expect(dimmed(divider as never)).toBe(false);
  expect(dimmed(screen.getByRole('button', { name: 'Language' }) as never)).toBe(true);
  expect(dimmed(screen.getByRole('button', { name: 'Help' }) as never)).toBe(true);
  expect(dimmed(screen.getByLabelText('Body and goals, Not for under 18s') as never)).toBe(true);
});

it('a label row is text, not a button', async () => {
  await render(<AccountRowLabel title="Identity" subtitle="Verified" showsChevron={false} opacity={0.55} />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByLabelText('Identity, Verified')).toBeOnTheScreen();
});

it('a section is a kicker heading over a card', async () => {
  await render(
    <AccountSection kicker="Account">
      <AccountRowButton title="Language" onPress={jest.fn()} />
    </AccountSection>,
  );
  expect(screen.getByRole('header', { name: 'ACCOUNT' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Language' })).toBeOnTheScreen();
});

it('the card lifts its rows one hairline, under its clipped top edge, so the first divider never shows', async () => {
  await render(
    <AccountCard testID="card">
      <AccountRowButton title="Language" onPress={jest.fn()} />
    </AccountCard>,
  );
  expect(StyleSheet.flatten(screen.getByTestId('card').props.style).overflow).toBe('hidden');
  expect(StyleSheet.flatten(screen.getByTestId('card.content').props.style).marginTop).toBe(-hairline);
});
