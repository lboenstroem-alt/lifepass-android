/**
 * `openAccountDeletion` (F4's contract for a refusal's "Cancel deletion") and
 * the host the tabs shell mounts: false with no host, one sheet at a time,
 * `onClose` once after the sheet has gone, and the refusal step's
 * `deletionSheet` outcome end to end.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { takeRefusalStep } from '../../../../navigation/refusalSteps';
import type { SharedRouteNavigation } from '../../../../navigation/sharedSheet';
import { resetAppStoreForTests } from '../../../../stores/appStore';
import { isAccountDeletionHostMounted, openAccountDeletion } from '..';
import { AccountDeletionHost } from '../ui';
import { resetAccountDeletionPresenterForTests, useAccountDeletionPresenter } from '../presenter';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
// @expo/vector-icons loads expo-font, which needs expo-asset (nested under expo).
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const ACTIVE = { accountStatus: 'active', deletionRequestedAt: null, erasureScheduledAt: null, obligations: [] };

beforeEach(() => {
  bottomSheetMock.reset();
  resetAppStoreForTests();
  resetAccountDeletionPresenterForTests();
  api.on('GET', '/account/deletion', Reply.ok(ACTIVE));
});

afterEach(() => {
  resetAccountDeletionPresenterForTests();
});

it('answers false, and leaves nothing pending, when no host is mounted', () => {
  const onClose = jest.fn();
  expect(isAccountDeletionHostMounted()).toBe(false);
  expect(openAccountDeletion({ onClose })).toBe(false);
  expect(useAccountDeletionPresenter.getState().request).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
});

it('opens the sheet through the host, one at a time, and reports the close once', async () => {
  await render(<AccountDeletionHost />);
  expect(isAccountDeletionHostMounted()).toBe(true);
  const onClose = jest.fn();
  let opened = false;
  await act(async () => {
    opened = openAccountDeletion({ onClose });
  });
  expect(opened).toBe(true);
  expect(await screen.findByTestId('deletion.active')).toBeOnTheScreen();
  expect(api.sentAll('/account/deletion')).toHaveLength(1);

  // A second request while one is up opens nothing.
  const second = jest.fn();
  expect(openAccountDeletion({ onClose: second })).toBe(false);

  await fireEvent.press(screen.getByTestId('deletion.dismiss'));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(second).not.toHaveBeenCalled();
  expect(screen.queryByTestId('deletion.active')).toBeNull();

  // Gone: the next request opens a fresh sheet with a fresh read.
  await act(async () => {
    opened = openAccountDeletion({ onClose: second });
  });
  expect(opened).toBe(true);
  expect(await screen.findByTestId('deletion.active')).toBeOnTheScreen();
  expect(api.sentAll('/account/deletion')).toHaveLength(2);
});

it('a host that goes away (a sign-out takes the tabs) takes its sheet with it', async () => {
  const view = await render(<AccountDeletionHost />);
  await act(async () => {
    openAccountDeletion({ onClose: jest.fn() });
  });
  await screen.findByTestId('deletion.active');
  await view.unmount();
  expect(isAccountDeletionHostMounted()).toBe(false);
  expect(useAccountDeletionPresenter.getState()).toEqual(expect.objectContaining({ request: null, visible: false }));
  expect(openAccountDeletion({ onClose: jest.fn() })).toBe(false);
});

it("a refusal's Cancel deletion opens the sheet over the screen and re-checks when it closes", async () => {
  await render(<AccountDeletionHost />);
  const navigate = jest.fn();
  const navigation = { navigate, push: jest.fn(), getState: jest.fn(), getParent: jest.fn() } as unknown as SharedRouteNavigation;
  const onClosed = jest.fn();
  let outcome: string | undefined;
  await act(async () => {
    outcome = takeRefusalStep('cancelDeletion', { navigation }, { onClosed });
  });
  expect(outcome).toBe('deletionSheet');
  expect(navigate).not.toHaveBeenCalled();
  await screen.findByTestId('deletion.active');
  await fireEvent.press(screen.getByTestId('deletion.dismiss'));
  await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
});
