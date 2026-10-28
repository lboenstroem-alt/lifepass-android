import { fireEvent, render, screen, within } from '@testing-library/react-native';

import UiKitScreen from '../UiKitScreen';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
// The kit's stand-in for the sheet library, with the footer slot.
jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);

it('draws every UI kit piece without throwing', async () => {
  await render(<UiKitScreen />);
  expect(screen.getByRole('header', { name: 'UI KIT' })).toBeOnTheScreen();
  expect(screen.getByRole('adjustable', { name: 'Weight, kilograms' })).toBeOnTheScreen();
  expect(screen.getByRole('checkbox', { name: 'I agree to the health terms' })).toBeOnTheScreen();
  expect(screen.getByRole('switch', { name: 'Weekly check-in' })).toBeOnTheScreen();
});

it('opens its sheet, with the footer pinned in the slot', async () => {
  await render(<UiKitScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Open sheet' }));
  expect(screen.getByText('A sheet')).toBeOnTheScreen();
  expect(within(screen.getByTestId('sheet.footer')).getByRole('button', { name: 'Lock for 3 s' })).toBeOnTheScreen();
});
