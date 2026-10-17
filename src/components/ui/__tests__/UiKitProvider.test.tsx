import { act, isHiddenFromAccessibility, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { dismissAllDialogs, showDialog } from '../Dialog';
import { resetUiKit } from '../reset';
import Sheet from '../Sheet';
import { dismissToast, showToast } from '../Toast';
import { bottomSheetMock } from '../testing/bottomSheetMock';
import UiKitProvider from '../UiKitProvider';

// The kit's stand-in for the sheet library: inside the provider a sheet is
// drawn in the provider's host, after the screens, as on a phone.
jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../testing/bottomSheetMock').bottomSheetModule,
);

beforeEach(() => bottomSheetMock.reset());

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

it("sign-out's reset drops queued dialogs and the toast without running a button", async () => {
  const deleteMeal = jest.fn();
  await render(
    <UiKitProvider>
      <Text>App</Text>
    </UiKitProvider>,
  );
  await act(async () => {
    showToast('Meal saved');
    showDialog({ title: 'Delete this meal?', buttons: [{ label: 'Delete', role: 'destructive', onPress: deleteMeal }, { label: 'Cancel', role: 'cancel' }] });
    showDialog({ title: 'Discard the draft?', buttons: [{ label: 'Discard', role: 'destructive', onPress: deleteMeal }] });
  });
  await act(async () => resetUiKit());
  // The toast fades out, then goes.
  await waitFor(() => expect(screen.queryByText('Meal saved')).toBeNull());
  expect(screen.queryByText('Delete this meal?')).toBeNull();
  expect(screen.queryByText('Discard the draft?')).toBeNull();
  expect(deleteMeal).not.toHaveBeenCalled();
});

describe('a sheet is modal to TalkBack, as an iOS sheet is to VoiceOver', () => {
  // The sheet is declared on the screen, as an app screen declares it, and
  // drawn in the provider's host, a sibling after the screens' layer.
  function App({ sheetOpen }: { sheetOpen: boolean }) {
    return (
      <UiKitProvider>
        <Text>Book</Text>
        <Sheet visible={sheetOpen} onClose={jest.fn()} busy>
          <Text>Confirm and pay</Text>
        </Sheet>
      </UiKitProvider>
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
