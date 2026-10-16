import { fireEvent, render, screen } from '@testing-library/react-native';

import UiKitScreen from '../UiKitScreen';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

it('draws every UI kit piece without throwing', async () => {
  await render(<UiKitScreen />);
  expect(screen.getByRole('header', { name: 'UI KIT' })).toBeOnTheScreen();
  expect(screen.getByRole('adjustable', { name: 'Weight, kilograms' })).toBeOnTheScreen();
  expect(screen.getByRole('checkbox', { name: 'I agree to the health terms' })).toBeOnTheScreen();
  expect(screen.getByRole('switch', { name: 'Weekly check-in' })).toBeOnTheScreen();
});

it('opens its sheet', async () => {
  await render(<UiKitScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Open sheet' }));
  expect(screen.getByText('A sheet')).toBeOnTheScreen();
});
