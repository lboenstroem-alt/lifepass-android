/**
 * The Account identity row (iOS AccountView's kennitala row): nothing until
 * the profile has loaded, an informational row once verified, and a row that
 * opens the Kenni sheet (default body, no visitor passes) while not; closing
 * the sheet re-reads the profile.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { decodeProfile } from '../../../../api/profile';
import { setCurrentLanguage, translate, type Lang } from '../../../../i18n';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { closeKenniSheetRequest, useKenniSheetRequest } from '../../../kenni';
import IdentityRow from '../IdentityRow';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const label = (lang: Lang, subtitleKey: string) =>
  `${translate('account.identity', lang)}, ${translate(subtitleKey, lang)}`;

function signIn(kennitalaVerified: boolean) {
  const json = { id: MEMBER, locale: 'en', kennitalaVerified, marketingConsent: false };
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: decodeProfile(json) });
  api.on('GET', '/profile', Reply.ok(json));
}

/** The open sheet request, as the host would read it. */
let request: ReturnType<typeof useKenniSheetRequest> = null;
function RequestProbe() {
  request = useKenniSheetRequest();
  return null;
}

beforeEach(() => {
  resetAppStoreForTests();
  request = null;
});

afterEach(() => {
  // A test that opens the sheet closes it itself (the request store is the kenni feature's).
  resetAppStoreForTests();
});

it('draws nothing until the profile has loaded, so the wrong state never flashes', async () => {
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: null });
  await render(<IdentityRow />);
  expect(screen.toJSON()).toBeNull();
});

it('verified: an informational row with the seal, no button, no chevron', async () => {
  signIn(true);
  await render(<IdentityRow />);
  expect(screen.getByText(translate('account.identity', 'en'))).toBeOnTheScreen();
  expect(screen.getByText(translate('account.identity_verified', 'en'))).toBeOnTheScreen();
  expect(screen.getByTestId('account.identity.verified').props.accessibilityLabel).toBe(
    label('en', 'account.identity_verified'),
  );
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByTestId('account.identity.divider', { includeHiddenElements: true })).toBeOnTheScreen();
});

it('unverified: opens the Kenni sheet with the membership body and no visitor passes; closing re-reads the profile', async () => {
  signIn(false);
  await render(
    <>
      <IdentityRow />
      <RequestProbe />
    </>,
  );
  const row = screen.getByRole('button', { name: label('en', 'account.identity_needed') });
  await fireEvent.press(row);
  expect(request).not.toBeNull();
  expect(request?.bodyKey).toBe('kenni.body');
  expect(request?.onSeePasses).toBeUndefined();

  // A second tap while the sheet is up asks for nothing more.
  const asked = request;
  await fireEvent.press(row);
  expect(request).toBe(asked);

  api.on('GET', '/profile', Reply.ok({ id: MEMBER, locale: 'en', kennitalaVerified: true, marketingConsent: false }));
  const reads = api.sentAll('/profile').length;
  await act(async () => closeKenniSheetRequest());
  await waitFor(() => expect(api.sentAll('/profile').length).toBe(reads + 1));
  await waitFor(() => expect(screen.getByText(translate('account.identity_verified', 'en'))).toBeOnTheScreen());
  expect(screen.queryByRole('button')).toBeNull();
});

it('speaks Icelandic, and leaves the hairline out when told', async () => {
  signIn(false);
  setCurrentLanguage('is');
  await render(<IdentityRow divider={false} />);
  expect(screen.getByRole('button', { name: label('is', 'account.identity_needed') })).toBeOnTheScreen();
  expect(screen.getByText(translate('account.identity', 'is'))).toBeOnTheScreen();
  expect(screen.queryByTestId('account.identity.divider', { includeHiddenElements: true })).toBeNull();
});
