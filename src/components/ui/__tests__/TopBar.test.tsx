/**
 * What TalkBack hears on the top bar, ported from NavigationAccessibilityUITests
 * (the person button says where it goes) and the BrandedTopBar contract.
 */
import { fireEvent, isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';

import { setCurrentLanguage } from '../../../i18n';
import TopBar from '../TopBar';

// expo-font (behind @expo/vector-icons) imports expo-asset, which npm left
// nested under expo/ where Jest's resolver cannot see it; Metro resolves it.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const PROFILE = 'Open profile: bookings and saved';

it('the person button that opens Profile says so', async () => {
  const onPress = jest.fn();
  await render(<TopBar title="Explore" trailing={{ kind: 'person', onPress, labelKey: 'a11y.open_profile' }} />);
  await fireEvent.press(screen.getByRole('button', { name: PROFILE }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('the person button says "Open account" by default, as iOS', async () => {
  await render(<TopBar title="Home" trailing={{ kind: 'person', onPress: jest.fn() }} />);
  expect(screen.getByRole('button', { name: 'Open account' })).toBeOnTheScreen();
});

it('a disabled person button stays, says it is disabled and refuses the press (Scan with the camera live)', async () => {
  const onPress = jest.fn();
  await render(
    <TopBar title="Scan" trailing={{ kind: 'person', onPress, labelKey: 'a11y.open_profile', disabled: true }} />,
  );
  const button = screen.getByRole('button', { name: PROFILE });
  expect(button).toBeDisabled();
  await fireEvent.press(button);
  expect(onPress).not.toHaveBeenCalled();
});

it('the gear says Settings, or Body and goals on Plan', async () => {
  await render(<TopBar title="Profile" trailing={{ kind: 'gear', onPress: jest.fn() }} />);
  expect(screen.getByRole('button', { name: 'Settings' })).toBeOnTheScreen();
  await render(<TopBar title="Plan" trailing={{ kind: 'gear', onPress: jest.fn(), labelKey: 'a11y.body_goals' }} />);
  expect(screen.getByRole('button', { name: 'Body and goals' })).toBeOnTheScreen();
});

it('a pushed screen gets a back chevron in place of the wordmark', async () => {
  const onBack = jest.fn();
  await render(<TopBar title="Scan" onBack={onBack} />);
  expect(screen.queryByRole('image', { name: 'LifePass' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
  expect(onBack).toHaveBeenCalledTimes(1);
});

it('shows the wordmark, the title as a header, and no trailing button when none is asked for', async () => {
  await render(<TopBar title="Explore" subtitle="12 venues" />);
  expect(screen.getByRole('image', { name: 'LifePass' })).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'EXPLORE' })).toBeOnTheScreen();
  expect(screen.getByText('12 VENUES')).toBeOnTheScreen();
  expect(screen.queryAllByRole('button')).toHaveLength(0);
});

it('the busy spinner is decoration to TalkBack', async () => {
  await render(<TopBar title="Plan" busy trailing={{ kind: 'gear', onPress: jest.fn() }} />);
  const spinner = screen.getByTestId('topbar.busy', { includeHiddenElements: true });
  expect(isHiddenFromAccessibility(spinner)).toBe(true);
  await render(<TopBar title="Plan" trailing={{ kind: 'gear', onPress: jest.fn() }} />);
  expect(screen.queryByTestId('topbar.busy', { includeHiddenElements: true })).toBeNull();
});

it('speaks Icelandic for an Icelandic account', async () => {
  setCurrentLanguage('is');
  await render(
    <TopBar title="Skoða" onBack={jest.fn()} trailing={{ kind: 'person', onPress: jest.fn(), labelKey: 'a11y.open_profile' }} />,
  );
  expect(screen.getByRole('button', { name: 'Opna prófíl: bókanir og vistað' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Til baka' })).toBeOnTheScreen();
});
