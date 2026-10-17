/**
 * Cancelling the plan (iOS AccountView `cancelSubscription` and
 * ContractFixtureTests `testSubscriptionCancelSendsALowercaseId`): the wire,
 * the branch-aware confirmation with its date fallback order, the row's
 * rule, and the conversation as the member has it.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { api, Reply } from '@test/server';

import { expectSentToMatchContract, stubApiClientPerTest } from '../../../../api/testing';
import { decodeSubscription } from '../../../../api/subscriptions';
import { DialogHost, dismissAllDialogs } from '../../../../components/ui/Dialog';
import { lookup, setCurrentLanguage } from '../../../../i18n';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { MEMBER_A, PLUS_SUBSCRIPTION } from '../../../../stores/__tests__/storeHarness';
import MembershipActions from '../../slots/MembershipActions';
import {
  CANCELLATION_REQUEST_RECEIVED,
  cancelConfirmationBody,
  cancellationEndDate,
  cancelSubscription,
  decodeCancelResult,
} from '../cancelSubscription';
import { canCancelSubscription } from '../cancelFlow';

// expo-font (behind @expo/vector-icons, the row's chevron) imports expo-asset,
// which npm left nested under expo/ where Jest's resolver cannot see it.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const PERIOD_END = new Date('2026-10-01T10:14:03.512Z');

function signInWith(subscription: Record<string, unknown> | null): void {
  useAppStore.setState({
    isAuthenticated: true,
    isLoading: false,
    userId: MEMBER_A,
    subscription: subscription ? decodeSubscription(subscription) : null,
    subscriptionLoaded: true,
  });
}

/** Lets the request, the re-read and the dialog run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  }
}

beforeEach(() => {
  dismissAllDialogs();
  setCurrentLanguage('en');
});

afterEach(() => {
  dismissAllDialogs();
  resetAppStoreForTests();
});

describe('POST /subscriptions/cancel', () => {
  it('sends a lowercase id (iOS testSubscriptionCancelSendsALowercaseId)', async () => {
    api.on('POST', '/subscriptions/cancel', Reply.ok({ status: 'cancellation_scheduled', endsAt: '2026-10-01T10:14:03.512Z' }));
    await cancelSubscription('5F0C2A6E-8A51-4E0B-9D7E-2B9A1F3C4D10', 'k-0000001');
    const sent = expectSentToMatchContract('POST', '/subscriptions/cancel');
    expect(sent.body).toEqual({ subscriptionId: '5f0c2a6e-8a51-4e0b-9d7e-2b9a1f3c4d10' });
    expect(sent.headers['idempotency-key']).toBe('k-0000001');
  });

  it('reads both branches, with optional dates', () => {
    expect(
      decodeCancelResult({ status: CANCELLATION_REQUEST_RECEIVED, subscriptionId: PLUS_SUBSCRIPTION.id, endsAt: '2027-03-01T00:00:00Z' }),
    ).toEqual({ status: CANCELLATION_REQUEST_RECEIVED, endsAt: new Date('2027-03-01T00:00:00Z'), currentPeriodEndsAt: null });
    expect(decodeCancelResult({ status: 'cancellation_scheduled', currentPeriodEndsAt: '2026-11-01T00:00:00.000Z' })).toEqual({
      status: 'cancellation_scheduled',
      endsAt: null,
      currentPeriodEndsAt: new Date('2026-11-01T00:00:00Z'),
    });
    expect(() => decodeCancelResult({ endsAt: '2027-03-01T00:00:00Z' })).toThrow();
    expect(() => decodeCancelResult({ status: 'cancellation_scheduled', endsAt: 'soon' })).toThrow();
  });
});

describe('the confirmation', () => {
  const committed = { status: CANCELLATION_REQUEST_RECEIVED, endsAt: new Date('2027-03-01T12:00:00Z'), currentPeriodEndsAt: null };
  const scheduled = { status: 'cancellation_scheduled', endsAt: null, currentPeriodEndsAt: new Date('2026-11-01T12:00:00Z') };

  it('the date: endsAt, else currentPeriodEndsAt, else the period end the phone knew', () => {
    expect(cancellationEndDate(committed, PERIOD_END)).toEqual(new Date('2027-03-01T12:00:00Z'));
    expect(cancellationEndDate(scheduled, PERIOD_END)).toEqual(new Date('2026-11-01T12:00:00Z'));
    expect(
      cancellationEndDate({ status: 'cancellation_scheduled', endsAt: new Date('2026-12-01T00:00:00Z'), currentPeriodEndsAt: new Date('2026-11-01T00:00:00Z') }, PERIOD_END),
    ).toEqual(new Date('2026-12-01T00:00:00Z'));
    expect(cancellationEndDate({ status: 'cancellation_scheduled', endsAt: null, currentPeriodEndsAt: null }, PERIOD_END)).toBe(PERIOD_END);
  });

  it('cancellation_request_received is the committed-term copy: billed until the end', () => {
    expect(cancelConfirmationBody(committed, PERIOD_END, 'en')).toBe(
      lookup('account.cancel_committed_body', 'en').replace('{date}', '1 Mar 2027'),
    );
    expect(cancelConfirmationBody(committed, PERIOD_END, 'is')).toBe(
      lookup('account.cancel_committed_body', 'is').replace('{date}', '1. mar. 2027'),
    );
  });

  it('anything else is the scheduled copy: no renewal, access until the end', () => {
    expect(cancelConfirmationBody(scheduled, PERIOD_END, 'en')).toBe(
      lookup('account.cancel_scheduled_body', 'en').replace('{date}', '1 Nov 2026'),
    );
    expect(
      cancelConfirmationBody({ status: 'something_new', endsAt: null, currentPeriodEndsAt: null }, PERIOD_END, 'en'),
    ).toBe(lookup('account.cancel_scheduled_body', 'en').replace('{date}', '1 Oct 2026'));
  });
});

describe('the row', () => {
  it('shows for a plan the member holds that is not already ending', () => {
    expect(canCancelSubscription(decodeSubscription(PLUS_SUBSCRIPTION))).toBe(true);
    expect(canCancelSubscription(decodeSubscription({ ...PLUS_SUBSCRIPTION, status: 'past_due' }))).toBe(true);
    expect(canCancelSubscription(decodeSubscription({ ...PLUS_SUBSCRIPTION, cancelAtPeriodEnd: true }))).toBe(false);
    expect(canCancelSubscription(decodeSubscription({ ...PLUS_SUBSCRIPTION, status: 'cancelled' }))).toBe(false);
    expect(canCancelSubscription(null)).toBe(false);
  });

  it('renders nothing without a plan, and nothing once a cancellation is scheduled', async () => {
    signInWith(null);
    await render(<MembershipActions />);
    expect(screen.queryByTestId('account.row.cancelSubscription')).toBeNull();
    await act(async () => signInWith({ ...PLUS_SUBSCRIPTION, cancelAtPeriodEnd: true }));
    expect(screen.queryByTestId('account.row.cancelSubscription')).toBeNull();
  });

  it('reads the title and the subtitle, in the account language', async () => {
    signInWith(PLUS_SUBSCRIPTION);
    setCurrentLanguage('is');
    await render(<MembershipActions />);
    const row = screen.getByTestId('account.row.cancelSubscription');
    expect(row.props.accessibilityLabel).toBe(`${lookup('account.cancel_sub', 'is')}, ${lookup('account.cancel_sub_keep', 'is')}`);
    expect(screen.getByText(lookup('account.cancel_sub_keep', 'is'))).toBeTruthy();
  });
});

describe('the conversation', () => {
  async function openConfirm(): Promise<void> {
    await render(
      <>
        <MembershipActions />
        <DialogHost />
      </>,
    );
    await fireEvent.press(screen.getByTestId('account.row.cancelSubscription'));
    await settle();
  }

  it('asks first; "Keep subscription" sends nothing', async () => {
    signInWith(PLUS_SUBSCRIPTION);
    await openConfirm();
    expect(screen.getByText(lookup('account.cancel_sub_body', 'en'))).toBeTruthy();
    expect(screen.getByText(lookup('account.cancel_sub_keep_b', 'en'))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('cancelSub.keep'));
    await settle();
    expect(api.sentAll('/subscriptions/cancel')).toHaveLength(0);
    expect(screen.queryByText(lookup('account.cancel_sub_body', 'en'))).toBeNull();
  });

  it('Cancel: the request, the membership read again, the committed copy, and the row gone', async () => {
    signInWith(PLUS_SUBSCRIPTION);
    api.on(
      'POST',
      '/subscriptions/cancel',
      Reply.ok({ status: CANCELLATION_REQUEST_RECEIVED, subscriptionId: PLUS_SUBSCRIPTION.id, endsAt: '2027-03-01T00:00:00.000Z' }),
    );
    api.on('GET', '/subscriptions', Reply.ok({ ...PLUS_SUBSCRIPTION, cancelAtPeriodEnd: true }));
    await openConfirm();
    await fireEvent.press(screen.getByTestId('cancelSub.confirm'));
    await settle();

    expect(api.sentAll('/subscriptions/cancel')).toHaveLength(1);
    expect(api.sentAll('/subscriptions', 'GET')).toHaveLength(1);
    expect(screen.getByText(lookup('account.cancel_done_title', 'en'))).toBeTruthy();
    expect(screen.getByText(lookup('account.cancel_committed_body', 'en').replace('{date}', '1 Mar 2027'))).toBeTruthy();
    expect(screen.queryByTestId('account.row.cancelSubscription')).toBeNull();
  });

  it('a fresh key for each confirmed cancel', async () => {
    signInWith(PLUS_SUBSCRIPTION);
    api.on('POST', '/subscriptions/cancel', Reply.ok({ status: 'cancellation_scheduled', currentPeriodEndsAt: '2026-10-01T10:14:03.512Z' }));
    // The read still shows the plan running (a slow server), so the row stays.
    api.on('GET', '/subscriptions', Reply.ok(PLUS_SUBSCRIPTION));
    await openConfirm();
    await fireEvent.press(screen.getByTestId('cancelSub.confirm'));
    await settle();
    expect(screen.getByText(lookup('account.cancel_scheduled_body', 'en').replace('{date}', '1 Oct 2026'))).toBeTruthy();
    await act(async () => dismissAllDialogs());
    await fireEvent.press(screen.getByTestId('account.row.cancelSubscription'));
    await settle();
    await fireEvent.press(screen.getByTestId('cancelSub.confirm'));
    await settle();
    const keys = api.sentAll('/subscriptions/cancel').map((r) => r.headers['idempotency-key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('a refusal reads "Something went wrong" with the message in the member’s words', async () => {
    signInWith(PLUS_SUBSCRIPTION);
    api.on('POST', '/subscriptions/cancel', Reply.problem(404, 'subscription_not_found'));
    await openConfirm();
    await fireEvent.press(screen.getByTestId('cancelSub.confirm'));
    await settle();
    expect(screen.getByText(lookup('account.cancel_failed_title', 'en'))).toBeTruthy();
    // iOS ErrorFormatter: the server's own sentence for a code the app has no copy for.
    expect(screen.getByText('Server detail for subscription_not_found.')).toBeTruthy();
    expect(screen.queryByText(lookup('account.cancel_done_title', 'en'))).toBeNull();
    expect(screen.getByTestId('account.row.cancelSubscription')).toBeTruthy();
  });

  it('no answer reads as the network sentence, and nothing is re-read', async () => {
    signInWith(PLUS_SUBSCRIPTION);
    api.on('POST', '/subscriptions/cancel', Reply.fail());
    await openConfirm();
    await fireEvent.press(screen.getByTestId('cancelSub.confirm'));
    await settle();
    expect(screen.getByText(lookup('account.cancel_failed_title', 'en'))).toBeTruthy();
    expect(screen.getByText(lookup('error.network', 'en'))).toBeTruthy();
    expect(api.sentAll('/subscriptions', 'GET')).toHaveLength(0);
  });
});
