/**
 * Account's Delete account row (the ACCT-4 slot): iOS copy in both
 * languages, never the retired web hand-off, and the sheet it opens in the
 * app. Plus the development fixtures, which open the sheet by themselves and
 * stub the one write, and never touch the network for what they fake.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import { Linking } from 'react-native';

import { stubApiClientPerTest } from '../../../../api/testing';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { setCurrentLanguage, translate } from '../../../../i18n';
import { resetAppStoreForTests } from '../../../../stores/appStore';
import DeletionRow from '../../slots/DeletionRow';
import { deletionFixtureRequestResult, deletionFixtureState, opensDeletionFixture } from '../fixtures';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
// @expo/vector-icons loads expo-font, which needs expo-asset (nested under expo).
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const ACTIVE = { accountStatus: 'active', deletionRequestedAt: null, erasureScheduledAt: null, obligations: [] };
const originalFixture = process.env.EXPO_PUBLIC_FIXTURE;

beforeEach(() => {
  bottomSheetMock.reset();
  resetAppStoreForTests();
  setCurrentLanguage('en');
  delete process.env.EXPO_PUBLIC_FIXTURE;
});

afterEach(() => {
  if (originalFixture === undefined) delete process.env.EXPO_PUBLIC_FIXTURE;
  else process.env.EXPO_PUBLIC_FIXTURE = originalFixture;
  setCurrentLanguage('en');
  jest.restoreAllMocks();
});

describe('the row', () => {
  it('reads Delete account with the in-app subtitle, as one button for TalkBack', async () => {
    await render(<DeletionRow />);
    const row = screen.getByRole('button', {
      name: `${translate('account.delete', 'en')}, ${translate('account.delete_sub', 'en')}`,
    });
    expect(row).toBeOnTheScreen();
    expect(screen.getByText('Delete account')).toBeOnTheScreen();
    expect(screen.getByText('Delete your account and everything we store')).toBeOnTheScreen();
    expect(screen.queryByText(translate('account.delete_gdpr', 'en'))).toBeNull();
  });

  it('speaks Icelandic in an Icelandic account', async () => {
    setCurrentLanguage('is');
    await render(<DeletionRow />);
    expect(screen.getByText('Eyða aðgangi')).toBeOnTheScreen();
    expect(screen.getByText(translate('account.delete_sub', 'is'))).toBeOnTheScreen();
  });

  it('opens the deletion sheet in the app, never the website', async () => {
    api.on('GET', '/account/deletion', Reply.ok(ACTIVE));
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(<DeletionRow />);
    expect(api.sentAll('/account/deletion')).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('account.delete'));
    expect(await screen.findByTestId('deletion.active')).toBeOnTheScreen();
    expect(api.sentAll('/account/deletion')).toHaveLength(1);
    expect(open).not.toHaveBeenCalled();
  });

  it('opens a fresh sheet each time, with a fresh read', async () => {
    api.on('GET', '/account/deletion', Reply.ok(ACTIVE));
    await render(<DeletionRow />);
    await fireEvent.press(screen.getByTestId('account.delete'));
    await screen.findByTestId('deletion.active');
    await fireEvent.press(screen.getByTestId('deletion.dismiss'));
    expect(screen.queryByTestId('deletion.active')).toBeNull();
    await fireEvent.press(screen.getByTestId('account.delete'));
    await screen.findByTestId('deletion.active');
    expect(api.sentAll('/account/deletion')).toHaveLength(2);
  });
});

describe('development fixtures', () => {
  it('nothing is faked without one', () => {
    expect(opensDeletionFixture()).toBe(false);
    expect(deletionFixtureState()).toBeNull();
    expect(deletionFixtureRequestResult()).toBeNull();
  });

  it('health=deletion opens the sheet on the active state and stubs the request, sending nothing', async () => {
    process.env.EXPO_PUBLIC_FIXTURE = 'state=active-plan,health=deletion';
    expect(opensDeletionFixture()).toBe(true);
    expect(deletionFixtureRequestResult()?.accountStatus).toBe('deletion_pending');
    await render(<DeletionRow />);
    expect(await screen.findByTestId('deletion.active')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('deletion.confirm'));
    await fireEvent.press(screen.getByTestId('deletion.confirm.delete'));
    expect(await screen.findByTestId('deletion.pending')).toBeOnTheScreen();
    expect(api.requests.filter((r) => r.path.startsWith('/account/deletion'))).toHaveLength(0);
  });

  it('health=deletion-pending opens on the pending state, with its obligations, and stubs no write', async () => {
    process.env.EXPO_PUBLIC_FIXTURE = 'health=deletion-pending';
    expect(deletionFixtureRequestResult()).toBeNull();
    const now = new Date('2026-10-17T10:00:00Z');
    expect(deletionFixtureState(now)?.erasureScheduledAt?.toISOString()).toBe('2026-11-10T10:00:00.000Z');
    await render(<DeletionRow />);
    expect(await screen.findByTestId('deletion.pending')).toBeOnTheScreen();
    expect(screen.getByText(translate('deletion.obligation.pending_charge', 'en'))).toBeOnTheScreen();
    await act(async () => undefined);
    expect(api.requests.filter((r) => r.path.startsWith('/account/deletion'))).toHaveLength(0);
  });
});
