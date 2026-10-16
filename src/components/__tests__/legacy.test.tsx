/**
 * The legacy component paths still work for the screens that import them,
 * now drawn by the UI kit, with words from the iOS tables.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { setCurrentLanguage } from '../../i18n';
import BookItPill from '../BookItPill';
import BrandedTopBar from '../BrandedTopBar';
import EmptyState from '../EmptyState';
import Kicker from '../Kicker';
import PrimaryButton from '../PrimaryButton';
import Wordmark from '../Wordmark';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

it('BookItPill says "Book it" from the iOS table, in Icelandic too', async () => {
  await render(<BookItPill />);
  expect(screen.getByText('Book it')).toBeOnTheScreen();
});

it('BookItPill in Icelandic', async () => {
  setCurrentLanguage('is');
  await render(<BookItPill fullWidth />);
  expect(screen.getByText('Bóka')).toBeOnTheScreen();
});

it('BrandedTopBar opens Account and says so', async () => {
  await render(<BrandedTopBar title="Check-in" />);
  await fireEvent.press(screen.getByRole('button', { name: 'Open account' }));
  expect(mockNavigate).toHaveBeenCalledWith('Account');
});

it('BrandedTopBar with a gear says Settings', async () => {
  await render(<BrandedTopBar title="Profile" trailing="settings" />);
  expect(screen.getByRole('button', { name: 'Settings' })).toBeOnTheScreen();
});

it('the moved components still render through their old paths', async () => {
  await render(
    <>
      <Kicker text="Nearby" />
      <Wordmark height={18} />
      <EmptyState icon="search" message="Nothing here" />
      <PrimaryButton title="Go" onPress={jest.fn()} />
    </>,
  );
  expect(screen.getByText('NEARBY')).toBeOnTheScreen();
  expect(screen.getByRole('image', { name: 'LifePass' })).toBeOnTheScreen();
  expect(screen.getByText('Nothing here')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Go' })).toBeOnTheScreen();
});
