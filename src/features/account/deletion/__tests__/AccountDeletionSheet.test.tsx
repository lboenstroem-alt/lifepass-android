/**
 * The deletion sheet (iOS AccountDeletionSheet): the active and pending
 * states, the confirm alert, the request with no body and one key per
 * presentation (reused on a retry), the answer shown BEFORE the local wipe,
 * the wipe and profile read once the sheet has gone, Keep my account with a
 * fresh key, the error lines, the lock while a request runs, and the web
 * link to /profile.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, Reply, type StubReply } from '@test/server';
import { useState } from 'react';
import { Linking } from 'react-native';

import { decodeProfile } from '../../../../api/profile';
import { stubApiClientPerTest } from '../../../../api/testing';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { useHealthStore } from '../../../../health';
import { translate, type Lang } from '../../../../i18n';
import { setAnalyticsObserver } from '../../../../lib/analytics';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import AccountDeletionSheet from '../AccountDeletionSheet';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
// @expo/vector-icons loads expo-font, which needs expo-asset (nested under expo).
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);

const ACTIVE = { accountStatus: 'active', deletionRequestedAt: null, erasureScheduledAt: null, obligations: [] };
const PENDING = {
  accountStatus: 'deletion_pending',
  deletionRequestedAt: '2026-10-17T09:12:44.120Z',
  erasureScheduledAt: '2026-11-10T00:00:00.000Z',
  obligations: [
    { kind: 'subscription', count: 1, clearsAt: '2026-11-10T00:00:00.000Z' },
    { kind: 'future_booking', count: 2, clearsAt: '2026-10-30T18:00:00.000Z' },
    { kind: 'gift_card', count: 1, clearsAt: null },
  ],
};
const REQUESTED = { ...PENDING, alreadyPending: false, healthDeleted: { bodyMeasurements: 24 } };

function signIn(locale: Lang = 'en') {
  const json = {
    id: MEMBER,
    locale,
    kennitalaVerified: true,
    marketingConsent: false,
    health: {
      access: 'entitled',
      consent: { version: '2026-09-v1', consentedAt: '2026-09-01T09:00:00Z', ageSource: 'kennitala' },
      latest: { weightKg: 72.5, heightCm: 174, measuredAt: '2026-09-14T07:20:00Z' },
      features: [],
    },
  };
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: decodeProfile(json) });
  api.on('GET', '/profile', Reply.ok({ ...json, health: { access: 'entitled', consent: null, features: [] } }));
}

function Harness({ onClosed }: { onClosed?: () => void }) {
  const [visible, setVisible] = useState(true);
  return <AccountDeletionSheet visible={visible} onClose={() => setVisible(false)} onClosed={onClosed} />;
}

/** A reply the test lets go of when it chooses. */
function held(reply: StubReply): { responder: () => Promise<StubReply>; release: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { responder: () => gate.then(() => reply), release: () => release() };
}

const deleteButton = () => screen.getByTestId('deletion.confirm');
const confirmDelete = () => screen.getByTestId('deletion.confirm.delete');

let events: { event: string; params: Record<string, unknown> }[] = [];
const realWipe = useHealthStore.getState().wipeLocal;
let wipe: jest.Mock;

beforeEach(() => {
  bottomSheetMock.reset();
  resetAppStoreForTests();
  events = [];
  setAnalyticsObserver((event, params) => events.push({ event, params: { ...params } }));
  wipe = jest.fn(async () => undefined);
  useHealthStore.setState({ wipeLocal: wipe });
});

afterEach(() => {
  setAnalyticsObserver(null);
  useHealthStore.setState({ wipeLocal: realWipe });
  resetAppStoreForTests();
  jest.restoreAllMocks();
});

describe('the active state', () => {
  it('shows a skeleton, then what deletion does, the red button, Cancel and the web line', async () => {
    signIn();
    const read = held(Reply.ok(ACTIVE));
    api.on('GET', '/account/deletion', read.responder);
    await render(<Harness />);
    // The skeleton is decoration to TalkBack, so it is looked up among hidden elements.
    expect(screen.getByTestId('deletion.loading', { includeHiddenElements: true })).toBeOnTheScreen();
    await act(async () => read.release());
    expect(await screen.findByRole('header', { name: en('deletion.title') })).toBeOnTheScreen();
    expect(screen.queryByTestId('deletion.loading', { includeHiddenElements: true })).toBeNull();
    for (const key of ['deletion.body', 'deletion.health_line', 'deletion.web_alt']) {
      expect(screen.getByText(en(key))).toBeOnTheScreen();
    }
    expect(deleteButton().props.accessibilityLabel).toBe(en('deletion.confirm'));
    expect(deleteButton().props.accessibilityHint).toBe(en('deletion.health_line'));
    expect(screen.getByRole('button', { name: en('common.cancel') })).toBeOnTheScreen();
    expect(events.map((e) => e.event)).toContain('account_deletion_viewed');
  });

  it('asks once more in an alert; Cancel there sends nothing', async () => {
    signIn();
    api.on('GET', '/account/deletion', Reply.ok(ACTIVE));
    await render(<Harness />);
    await screen.findByTestId('deletion.active');
    await fireEvent.press(deleteButton());
    expect(screen.getByRole('header', { name: en('deletion.confirm_title') })).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('deletion.confirm.cancel'));
    expect(screen.queryByRole('header', { name: en('deletion.confirm_title') })).toBeNull();
    expect(api.sentAll('/account/deletion').filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  it('a failed read still offers the deletion, with the error line', async () => {
    signIn();
    api.on('GET', '/account/deletion', Reply.problem(500, 'internal_error'));
    await render(<Harness />);
    expect(await screen.findByTestId('deletion.error')).toHaveTextContent(en('common.error_body'));
    expect(screen.getByTestId('deletion.active')).toBeOnTheScreen();
  });

  it('offline reads "This needs a connection."', async () => {
    signIn();
    api.on('GET', '/account/deletion', Reply.fail());
    await render(<Harness />);
    expect(await screen.findByTestId('deletion.error')).toHaveTextContent(en('health.offline.action_hint'));
  });

  it('Cancel closes the sheet; nothing is wiped', async () => {
    signIn();
    api.on('GET', '/account/deletion', Reply.ok(ACTIVE));
    const closed = jest.fn();
    await render(<Harness onClosed={closed} />);
    await screen.findByTestId('deletion.active');
    await fireEvent.press(screen.getByTestId('deletion.dismiss'));
    await waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
    expect(wipe).not.toHaveBeenCalled();
  });
});

describe('requesting the deletion', () => {
  it('sends no body and a key, SHOWS the answer, hides health data, and wipes only once the sheet has gone', async () => {
    signIn();
    api.on('GET', '/account/deletion', Reply.ok(ACTIVE));
    api.on('POST', '/account/deletion', Reply.ok(REQUESTED));
    const closed = jest.fn();
    await render(<Harness onClosed={closed} />);
    await screen.findByTestId('deletion.active');
    await fireEvent.press(deleteButton());
    await fireEvent.press(confirmDelete());

    // The answer, first: the pending state with the date and the known obligations.
    expect(await screen.findByTestId('deletion.pending')).toBeOnTheScreen();
    expect(screen.getByText(en('deletion.pending', { date: '10 November' }))).toBeOnTheScreen();
    expect(screen.getByText(en('deletion.obligation.subscription'))).toBeOnTheScreen();
    expect(screen.getByText('2 upcoming bookings are cancelled')).toBeOnTheScreen();
    expect(screen.queryByText(/gift_card/)).toBeNull();
    expect(screen.getByRole('button', { name: en('deletion.cancel') })).toBeOnTheScreen();
    expect(screen.getByText(en('deletion.cancel_note'))).toBeOnTheScreen();

    const sent = api.sent('/account/deletion', 'POST');
    expect(sent.body).toBeUndefined();
    expect(sent.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(events.map((e) => e.event)).toContain('account_deletion_requested');

    // Health data leaves every screen at once; the phone's cache waits.
    expect(useAppStore.getState().profile?.health?.consent).toBeNull();
    expect(useAppStore.getState().profile?.health?.latest).toBeNull();
    expect(wipe).not.toHaveBeenCalled();
    const profileReadsBeforeClose = api.sentAll('/profile').length;

    // Closed: the wipe runs for this member, then the profile is read again.
    await act(async () => bottomSheetMock.latest()?.onDismiss?.());
    await waitFor(() => expect(wipe).toHaveBeenCalledWith({ profileId: MEMBER, reason: 'account_deletion' }));
    expect(wipe).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.sentAll('/profile').length).toBeGreaterThan(profileReadsBeforeClose));
  });

  it('a retry in the same presentation reuses the key; the error line says what went wrong', async () => {
    signIn();
    api.on('GET', '/account/deletion', Reply.ok(ACTIVE));
    api.once('POST', '/account/deletion', Reply.problem(500, 'internal_error'));
    await render(<Harness />);
    await screen.findByTestId('deletion.active');
    await fireEvent.press(deleteButton());
    await fireEvent.press(confirmDelete());
    expect(await screen.findByTestId('deletion.error')).toHaveTextContent(en('common.error_body'));
    const first = api.sent('/account/deletion', 'POST').headers['idempotency-key'];

    api.on('POST', '/account/deletion', Reply.ok(REQUESTED));
    await fireEvent.press(deleteButton());
    await fireEvent.press(confirmDelete());
    await screen.findByTestId('deletion.pending');
    const posts = api.sentAll('/account/deletion').filter((r) => r.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[1]!.headers['idempotency-key']).toBe(first);
    expect(screen.queryByTestId('deletion.error')).toBeNull();
  });

  it('an offline request says so and wipes nothing', async () => {
    signIn();
    api.on('GET', '/account/deletion', Reply.ok(ACTIVE));
    api.on('POST', '/account/deletion', Reply.fail());
    await render(<Harness />);
    await screen.findByTestId('deletion.active');
    await fireEvent.press(deleteButton());
    await fireEvent.press(confirmDelete());
    expect(await screen.findByTestId('deletion.error')).toHaveTextContent(en('health.offline.action_hint'));
    expect(useAppStore.getState().profile?.health?.consent).not.toBeNull();
    await act(async () => bottomSheetMock.latest()?.onDismiss?.());
    expect(wipe).not.toHaveBeenCalled();
  });

  it('nothing closes the sheet while the request runs', async () => {
    signIn();
    api.on('GET', '/account/deletion', Reply.ok(ACTIVE));
    const post = held(Reply.ok(REQUESTED));
    api.on('POST', '/account/deletion', post.responder);
    await render(<Harness />);
    await screen.findByTestId('deletion.active');
    expect(bottomSheetMock.latest()?.enablePanDownToClose).toBe(true);
    await fireEvent.press(deleteButton());
    await fireEvent.press(confirmDelete());
    await waitFor(() => expect(bottomSheetMock.latest()?.enablePanDownToClose).toBe(false));
    expect(screen.getByTestId('deletion.dismiss')).toBeDisabled();
    expect(deleteButton().props.accessibilityState).toEqual(expect.objectContaining({ busy: true }));
    await act(async () => post.release());
    await screen.findByTestId('deletion.pending');
    expect(bottomSheetMock.latest()?.enablePanDownToClose).toBe(true);
  });

  it('a second request in the same sheet, after Keep my account, is a new request with a new key', async () => {
    signIn();
    api.on('GET', '/account/deletion', Reply.ok(ACTIVE));
    api.on('POST', '/account/deletion', Reply.ok(REQUESTED));
    api.on('POST', '/account/deletion/cancel', Reply.ok(ACTIVE));
    await render(<Harness />);
    await screen.findByTestId('deletion.active');
    await fireEvent.press(deleteButton());
    await fireEvent.press(confirmDelete());
    await fireEvent.press(await screen.findByTestId('deletion.keep'));
    await screen.findByTestId('deletion.active');
    await fireEvent.press(deleteButton());
    await fireEvent.press(confirmDelete());
    await screen.findByTestId('deletion.pending');
    const keys = api
      .sentAll('/account/deletion')
      .filter((r) => r.method === 'POST')
      .map((r) => r.headers['idempotency-key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe('the pending state', () => {
  it('shows the date in the account language and Keep my account cancels with a fresh key', async () => {
    signIn('is');
    api.on('GET', '/account/deletion', Reply.ok(PENDING));
    api.on('POST', '/account/deletion/cancel', Reply.ok(ACTIVE));
    await render(<Harness />);
    await screen.findByTestId('deletion.pending');
    expect(screen.getByText('Aðganginum verður eytt þann 10. nóvember.')).toBeOnTheScreen();
    expect(screen.getByText('2 bókunum fram í tímann er aflýst')).toBeOnTheScreen();
    const reads = api.sentAll('/profile').length;

    await fireEvent.press(screen.getByTestId('deletion.keep'));
    await screen.findByTestId('deletion.active');
    const sent = api.sent('/account/deletion/cancel', 'POST');
    expect(sent.body).toBeUndefined();
    expect(sent.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(api.sentAll('/profile').length).toBeGreaterThan(reads);
    expect(events.map((e) => e.event)).toContain('account_deletion_cancelled');
  });

  it('each Keep my account tap mints its own key, as iOS does', async () => {
    signIn();
    api.on('GET', '/account/deletion', Reply.ok(PENDING));
    api.once('POST', '/account/deletion/cancel', Reply.problem(500, 'internal_error'));
    await render(<Harness />);
    await fireEvent.press(await screen.findByTestId('deletion.keep'));
    expect(await screen.findByTestId('deletion.error')).toHaveTextContent(en('common.error_body'));
    api.on('POST', '/account/deletion/cancel', Reply.ok(ACTIVE));
    await fireEvent.press(screen.getByTestId('deletion.keep'));
    await screen.findByTestId('deletion.active');
    const keys = api.sentAll('/account/deletion/cancel').map((r) => r.headers['idempotency-key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('shows a spinner in place of the button while the cancel runs, and locks the sheet', async () => {
    signIn();
    api.on('GET', '/account/deletion', Reply.ok(PENDING));
    const cancel = held(Reply.ok(ACTIVE));
    api.on('POST', '/account/deletion/cancel', cancel.responder);
    await render(<Harness />);
    await fireEvent.press(await screen.findByTestId('deletion.keep'));
    expect(screen.getByTestId('deletion.keep.working').props.accessibilityState).toEqual({ busy: true, disabled: true });
    expect(screen.queryByTestId('deletion.keep')).toBeNull();
    expect(bottomSheetMock.latest()?.enablePanDownToClose).toBe(false);
    await act(async () => cancel.release());
    await screen.findByTestId('deletion.active');
  });

  it('a pending state with no obligations draws no card', async () => {
    signIn();
    api.on('GET', '/account/deletion', Reply.ok({ ...PENDING, obligations: [] }));
    await render(<Harness />);
    await screen.findByTestId('deletion.pending');
    expect(screen.queryByTestId('deletion.obligations')).toBeNull();
  });
});

describe('the web link', () => {
  it('opens the web account page, never the sign-in form', async () => {
    signIn();
    api.on('GET', '/account/deletion', Reply.ok(ACTIVE));
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(<Harness />);
    await screen.findByTestId('deletion.active');
    expect(screen.getByRole('link', { name: en('deletion.web_alt') })).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('deletion.web'));
    expect(open).toHaveBeenCalledWith('https://www.lifepass.is/profile');
  });
});
