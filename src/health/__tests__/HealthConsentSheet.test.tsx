/**
 * The health consent sheet (iOS HealthConsentSheet): nothing pre-ticked, a
 * legible held button until the boxes are ticked, `ageAttested` sent only
 * when the 18+ row was shown, the server's attestation request turning the
 * row on, the under-18 card with the wipe after it closes, the
 * pending-deletion and offline lines, the version that follows
 * `meal_describe`, and no Apple Health lines on Android.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { fileSystemState } from '@test/mocks/expoFileSystem';
import { api, Reply } from '@test/server';
import { useState } from 'react';

import { stubApiClientPerTest } from '../../api/testing';
import { decodeProfile } from '../../api/profile';
import { bottomSheetMock } from '../../components/ui/testing/bottomSheetMock';
import { restoreTestFontScale, setTestFontScale } from '../../hooks/testing';
import { translate } from '../../i18n';
import { resetAppStoreForTests, useAppStore } from '../../stores/appStore';
import * as localStore from '../localStore';
import HealthConsentSheet from '../consent/HealthConsentSheet';
import { consentGrantBody, HealthConsentVersion } from '../consent/consent';
import { resetHealthStoreForTests, useHealthStore } from '../store';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const en = (key: string) => translate(key, 'en');

function signIn(kennitalaVerified: boolean, features: string[] = []) {
  const json = {
    id: MEMBER,
    locale: 'en',
    kennitalaVerified,
    marketingConsent: false,
    health: { access: 'entitled', consent: null, features },
  };
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: decodeProfile(json), serverFeatures: features });
  api.on('GET', '/profile', Reply.ok(json));
}

function Harness({ onGranted, onOpenAccount }: { onGranted?: () => void; onOpenAccount?: () => void }) {
  const [visible, setVisible] = useState(true);
  return (
    <HealthConsentSheet
      visible={visible}
      entry="plan"
      onClose={() => setVisible(false)}
      onGranted={onGranted}
      onOpenAccount={onOpenAccount}
    />
  );
}

const consentBox = () => screen.getByRole('checkbox', { name: en('healthconsent.check.consent') });
const ageBox = () => screen.queryByRole('checkbox', { name: en('healthconsent.check.age') });
const turnOn = () => screen.getByRole('button', { name: en('healthconsent.cta') });

beforeEach(() => {
  bottomSheetMock.reset();
  setTestFontScale(1);
  resetAppStoreForTests();
  resetHealthStoreForTests();
});

afterEach(async () => {
  restoreTestFontScale();
  resetAppStoreForTests();
  await localStore.settled();
});

it('says what is stored and what the AI never sees, with no Apple Health line on Android', async () => {
  signIn(true);
  await render(<Harness />);
  expect(screen.getByRole('header', { name: en('healthconsent.title') })).toBeOnTheScreen();
  for (const key of ['healthconsent.store.body', 'healthconsent.store.meals', 'healthconsent.ai.never_identity', 'healthconsent.ai.photo', 'healthconsent.promise.no_marketing', 'health.disclaimer', 'healthconsent.optional']) {
    expect(screen.getByText(en(key))).toBeOnTheScreen();
  }
  expect(screen.queryByText(en('healthconsent.store.apple_health'))).toBeNull();
  expect(screen.queryByText(en('ah.use.ai'))).toBeNull();
  expect(screen.queryByText(en('healthconsent.ai.describe'))).toBeNull();
});

it('nothing is pre-ticked: the button is held, legible, and says why', async () => {
  signIn(true);
  await render(<Harness />);
  expect(consentBox()).not.toBeChecked();
  const held = turnOn();
  expect(held).toBeDisabled();
  expect(held.props.accessibilityHint).toBe(en('healthconsent.a11y.tick_first'));
  expect(ageBox()).toBeNull();
});

it('a verified member: no age row, no ageAttested, the grant applied at once, then the profile, then what was asked', async () => {
  signIn(true);
  api.on('POST', '/profile/health-consent', Reply.ok({ optedIn: true, version: '2026-09-v1', consentedAt: '2026-10-17T10:00:00Z', ageSource: 'kennitala' }));
  const granted = jest.fn();
  await render(<Harness onGranted={granted} />);
  await fireEvent.press(consentBox());
  await fireEvent.press(turnOn());
  await waitFor(() => expect(granted).toHaveBeenCalledTimes(1));
  const sent = api.sent('/profile/health-consent', 'POST');
  expect(sent.body).toEqual({ optedIn: true, version: '2026-09-v1', source: 'coach_intake' });
  expect(sent.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  expect(api.sentAll('/profile').length).toBeGreaterThan(0);
});

it('the granted consent stands on the profile even when the read after it fails', async () => {
  signIn(true);
  api.on('POST', '/profile/health-consent', Reply.ok({ optedIn: true, version: '2026-09-v1', consentedAt: '2026-10-17T10:00:00Z', ageSource: 'kennitala' }));
  api.on('GET', '/profile', Reply.problem(500, 'internal_error'));
  await render(<Harness />);
  await fireEvent.press(consentBox());
  await fireEvent.press(turnOn());
  await waitFor(() => expect(useAppStore.getState().profile?.health?.consent?.version).toBe('2026-09-v1'));
  expect(useAppStore.getState().profile?.health?.consent?.ageSource).toBe('kennitala');
});

it('an unverified account must attest, and the grant says so', async () => {
  signIn(false, ['meal_describe']);
  api.on('POST', '/profile/health-consent', Reply.ok({ optedIn: true, version: '2026-09-v3', consentedAt: null, ageSource: 'attestation' }));
  await render(<Harness />);
  expect(screen.getByText(en('healthconsent.ai.describe'))).toBeOnTheScreen();
  await fireEvent.press(consentBox());
  expect(turnOn()).toBeDisabled();
  await fireEvent.press(ageBox()!);
  await fireEvent.press(turnOn());
  await waitFor(() => expect(api.sentAll('/profile/health-consent')).toHaveLength(1));
  expect(api.sent('/profile/health-consent').body).toEqual({
    optedIn: true,
    version: HealthConsentVersion.withMealDescribe,
    source: 'coach_intake',
    ageAttested: true,
  });
});

it("the server's attestation request draws the row a verified account never had", async () => {
  signIn(true);
  api.once('POST', '/profile/health-consent', Reply.problem(400, 'health_age_attestation_required'));
  await render(<Harness />);
  await fireEvent.press(consentBox());
  await fireEvent.press(turnOn());
  await waitFor(() => expect(ageBox()).not.toBeNull());
  expect(screen.getByText(en('healthconsent.err.attest'))).toBeOnTheScreen();
  expect(turnOn()).toBeDisabled();

  api.on('POST', '/profile/health-consent', Reply.ok({ optedIn: true, version: '2026-09-v1', ageSource: 'attestation' }));
  await fireEvent.press(ageBox()!);
  await fireEvent.press(turnOn());
  await waitFor(() => expect(api.sentAll('/profile/health-consent')).toHaveLength(2));
  const [first, second] = api.sentAll('/profile/health-consent');
  expect(second.body).toEqual(expect.objectContaining({ ageAttested: true }));
  // One presentation, one key: the retry is the same action.
  expect(second.headers['idempotency-key']).toBe(first.headers['idempotency-key']);
});

it('a verified member under 18 sees the card; the phone forgets only once it is closed', async () => {
  signIn(true);
  useHealthStore.setState({ profileId: MEMBER });
  fileSystemState.seed(`health/${MEMBER}/today.json`, '{}');
  api.on('POST', '/profile/health-consent', Reply.problem(403, 'health_minor_blocked'));
  await render(<Harness />);
  await fireEvent.press(consentBox());
  await fireEvent.press(turnOn());
  await waitFor(() => expect(screen.getByRole('header', { name: en('health.minor.title') })).toBeOnTheScreen());
  expect(screen.getByText(en('health.minor.body'))).toBeOnTheScreen();
  await localStore.settled();
  expect(fileSystemState.files()).toEqual([`files/health/${MEMBER}/today.json`]);

  const reads = api.sentAll('/profile').length;
  await fireEvent.press(screen.getByRole('button', { name: en('common.done') }));
  await waitFor(() => expect(api.sentAll('/profile').length).toBeGreaterThan(reads));
  await act(async () => {
    await localStore.settled();
  });
  expect(fileSystemState.files()).toEqual([]);
});

it('an account waiting to be deleted is told so, with Open Account', async () => {
  signIn(true);
  api.on('POST', '/profile/health-consent', Reply.problem(409, 'account_pending_deletion'));
  const openAccount = jest.fn();
  await render(<Harness onOpenAccount={openAccount} />);
  await fireEvent.press(consentBox());
  await fireEvent.press(turnOn());
  await waitFor(() => expect(screen.getByText(en('health.err.pending_deletion'))).toBeOnTheScreen());
  await fireEvent.press(screen.getByRole('button', { name: en('health.err.open_account') }));
  expect(openAccount).toHaveBeenCalledTimes(1);
});

it('offline and rate limited say so; nothing is granted', async () => {
  signIn(true);
  api.once('POST', '/profile/health-consent', Reply.fail());
  const granted = jest.fn();
  await render(<Harness onGranted={granted} />);
  await fireEvent.press(consentBox());
  await fireEvent.press(turnOn());
  await waitFor(() => expect(screen.getByText(en('health.offline.action_hint'))).toBeOnTheScreen());
  api.once('POST', '/profile/health-consent', Reply.problem(429, 'rate_limited'));
  await fireEvent.press(turnOn());
  await waitFor(() => expect(screen.getByText(en('health.err.rate_limited'))).toBeOnTheScreen());
  expect(granted).not.toHaveBeenCalled();
});

it('a re-opened sheet is a fresh presentation: no old error or card, nothing ticked, a new key', async () => {
  signIn(true);
  api.once('POST', '/profile/health-consent', Reply.problem(429, 'rate_limited'));
  const close = jest.fn();
  const sheet = (visible: boolean) => <HealthConsentSheet visible={visible} entry="plan" onClose={close} />;
  const view = await render(sheet(true));
  await fireEvent.press(consentBox());
  await fireEvent.press(turnOn());
  await waitFor(() => expect(screen.getByText(en('health.err.rate_limited'))).toBeOnTheScreen());

  await act(async () => view.rerender(sheet(false)));
  await act(async () => view.rerender(sheet(true)));
  expect(screen.queryByText(en('health.err.rate_limited'))).toBeNull();
  expect(consentBox()).not.toBeChecked();

  api.once('POST', '/profile/health-consent', Reply.problem(403, 'health_minor_blocked'));
  await fireEvent.press(consentBox());
  await fireEvent.press(turnOn());
  await waitFor(() => expect(screen.getByRole('header', { name: en('health.minor.title') })).toBeOnTheScreen());
  const [first, second] = api.sentAll('/profile/health-consent');
  expect(second.headers['idempotency-key']).not.toBe(first.headers['idempotency-key']);

  await act(async () => view.rerender(sheet(false)));
  await act(async () => view.rerender(sheet(true)));
  expect(screen.queryByRole('header', { name: en('health.minor.title') })).toBeNull();
  expect(screen.getByRole('header', { name: en('healthconsent.title') })).toBeOnTheScreen();
});

it('Not now closes without a grant or a request', async () => {
  signIn(true);
  await render(<Harness />);
  await fireEvent.press(screen.getByRole('button', { name: en('healthconsent.not_now') }));
  expect(api.sentAll('/profile/health-consent')).toHaveLength(0);
});

it('at the largest text the panel is part of the page, and still works', async () => {
  setTestFontScale(2);
  signIn(true);
  await render(<Harness />);
  expect(consentBox()).toBeOnTheScreen();
  expect(turnOn()).toBeDisabled();
});

it('the version follows meal_describe, and source follows the entry', () => {
  expect(consentGrantBody({ entry: 'account', ageRowShown: false, supportsMealDescribe: false })).toEqual({
    optedIn: true,
    version: '2026-09-v1',
    source: 'account',
  });
  expect(consentGrantBody({ entry: 'scan', ageRowShown: true, supportsMealDescribe: true })).toEqual({
    optedIn: true,
    version: '2026-09-v3',
    source: 'coach_intake',
    ageAttested: true,
  });
});
