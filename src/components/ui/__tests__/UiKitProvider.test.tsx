import { act, isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { dismissAllDialogs, showDialog } from '../Dialog';
import Sheet from '../Sheet';
import { dismissToast, showToast } from '../Toast';
import UiKitProvider from '../UiKitProvider';

afterEach(async () => {
  await act(async () => {
    dismissToast();
    dismissAllDialogs();
  });
});

it('hosts the app, toasts and dialogs once for the whole app', async () => {
  await render(
    <UiKitProvider toastBottomOffset={96}>
      <Text>App</Text>
    </UiKitProvider>,
  );
  expect(screen.getByText('App')).toBeOnTheScreen();
  await act(async () => {
    showToast('Saved');
    showDialog({ title: 'Discard this meal?', buttons: [{ label: 'Discard', role: 'destructive' }, { label: 'Cancel', role: 'cancel' }] });
  });
  expect(screen.getByText('Saved')).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'Discard this meal?' })).toBeOnTheScreen();
});

describe('a sheet is modal to TalkBack, as an iOS sheet is to VoiceOver', () => {
  // On a phone the sheet renders into the provider's portal host, a sibling
  // drawn after the screens; the test stand-in renders it where it is
  // declared, so it is declared beside the provider here.
  function App({ sheetOpen }: { sheetOpen: boolean }) {
    return (
      <>
        <UiKitProvider>
          <Text>Book</Text>
        </UiKitProvider>
        <Sheet visible={sheetOpen} onClose={jest.fn()} busy>
          <Text>Confirm and pay</Text>
        </Sheet>
      </>
    );
  }

  const page = () => screen.getByText('Book', { includeHiddenElements: true });

  it('hides the screens underneath while a sheet is up, and gives them back once it closes', async () => {
    const view = await render(<App sheetOpen={false} />);
    expect(isHiddenFromAccessibility(page())).toBe(false);

    await view.rerender(<App sheetOpen />);
    expect(isHiddenFromAccessibility(page())).toBe(true);
    expect(screen.queryByText('Book')).toBeNull();
    // The sheet itself stays reachable.
    expect(screen.getByText('Confirm and pay')).toBeOnTheScreen();

    await view.rerender(<App sheetOpen={false} />);
    expect(isHiddenFromAccessibility(page())).toBe(false);
  });

  it('a toast shown while a sheet is up is still read', async () => {
    await render(<App sheetOpen />);
    await act(async () => showToast('Saved'));
    expect(screen.getByText('Saved')).toBeOnTheScreen();
  });
});
