/**
 * The shared states and small pieces: error, empty, estimate, banner, card,
 * primary button.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { setCurrentLanguage } from '../../../i18n';
import { colors } from '../../../theme';
import Card from '../Card';
import EmptyState from '../EmptyState';
import ErrorState from '../ErrorState';
import EstimateChip from '../EstimateChip';
import PrimaryButton from '../PrimaryButton';
import StatusBanner from '../StatusBanner';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

describe('ErrorState (iOS HealthErrorState)', () => {
  it('says something went wrong and offers Try again', async () => {
    const onRetry = jest.fn();
    await render(<ErrorState onRetry={onRetry} />);
    expect(screen.getByText('Something went wrong. Please try again.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('in Icelandic', async () => {
    setCurrentLanguage('is');
    await render(<ErrorState onRetry={jest.fn()} />);
    expect(screen.getByText('Eitthvað fór úrskeiðis. Reyndu aftur.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Reyna aftur' })).toBeOnTheScreen();
  });
});

describe('EmptyState (iOS LPEmptyState)', () => {
  it('shows the message and its action', async () => {
    const onAction = jest.fn();
    await render(<EmptyState icon="search" message="No venues match" actionLabel="Clear filters" onAction={onAction} />);
    expect(screen.getByText('No venues match')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('has no button without an action', async () => {
    await render(<EmptyState icon="calendar-outline" message="No bookings yet" actionLabel="Explore" />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('EstimateChip (iOS EstimateChip)', () => {
  it('wears the word', async () => {
    await render(<EstimateChip />);
    expect(screen.getByText('Estimate')).toBeOnTheScreen();
  });

  it('in the account language', async () => {
    setCurrentLanguage('is');
    await render(<EstimateChip />);
    expect(screen.getByText('Áætlað')).toBeOnTheScreen();
  });
});

describe('StatusBanner (iOS StatusBanner)', () => {
  it('shows one message with its action and a second, quieter one', async () => {
    const retry = jest.fn();
    const discard = jest.fn();
    await render(
      <StatusBanner
        icon="cloud-offline-outline"
        message="One workout has not been sent."
        actionLabel="Send"
        onAction={retry}
        secondaryLabel="Discard"
        onSecondary={discard}
        testID="banner"
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Discard' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(discard).toHaveBeenCalledTimes(1);
    // TalkBack reads it when it appears.
    expect(screen.getByTestId('banner')).toHaveProp('accessibilityLiveRegion', 'polite');
  });

  it('has no buttons without actions', async () => {
    await render(<StatusBanner icon="cloud-offline-outline" message="You are offline." />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

it('Card is the ink2 surface with a hairline', async () => {
  await render(
    <Card testID="card">
      <Text>Inside</Text>
    </Card>,
  );
  expect(screen.getByTestId('card')).toHaveStyle({ backgroundColor: colors.ink2, borderColor: colors.line, borderRadius: 14 });
});

describe('PrimaryButton (iOS LPPrimaryButton)', () => {
  it('presses, and names itself', async () => {
    const onPress = jest.fn();
    await render(<PrimaryButton title="Book" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Book' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('while loading keeps its name, says it is busy, and refuses presses', async () => {
    const onPress = jest.fn();
    await render(<PrimaryButton title="Book" onPress={onPress} loading />);
    const button = screen.getByRole('button', { name: 'Book' });
    expect(button).toBeBusy();
    expect(button).toBeDisabled();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('uses the AA action fill where asked', async () => {
    await render(<PrimaryButton title="Confirm" onPress={jest.fn()} tone="action" testID="cta" />);
    expect(screen.getByTestId('cta')).toHaveStyle({ backgroundColor: colors.actionFill });
  });
});
