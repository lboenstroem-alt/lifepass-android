/**
 * A hosted page's return link reaches the payment rails through the app's
 * deep-link router (src/app/deepLinks.ts), every time one arrives, as iOS
 * `LifePassApp.handleIncomingURL` hands each payment-success/canceled and
 * card-setup-* link to its confirm.
 *
 * The case that needs it: Android destroyed the Activity but kept the
 * process, so the once-per-process launch read (./register at the first
 * profile) has already run, and the next return arrives only through the
 * router (the `url` event, or `getInitialURL` when the Activity is
 * recreated). Its leg must not be lost: a cancel link is asked once, as the
 * cancel leg is, not twice as Done.
 */
import { act, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { api, Reply, type StubReply } from '@test/server';

import { stubApiClientPerTest } from '../../api/testing';
import { handleDeepLink, startDeepLinks } from '../../app/deepLinks';
import { runActivationHooks } from '../../app/signOut';
import { DialogHost } from '../../components/ui/Dialog';
import { lookup } from '../../i18n';
import { saveInflight, type NewInflightRecord } from '../inflight';
import RecoveryProgressHost from '../RecoveryProgressHost';

import { flush, freshPaymentsPerTest, MEMBER_A, signIn, storedRecords } from './paymentsHarness';

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

stubApiClientPerTest();
freshPaymentsPerTest();

const walkInAttempt: NewInflightRecord = {
  rail: 'walk_in',
  memberId: MEMBER_A,
  key: 'walkin-key-1',
  amountIsk: 2_700,
  walkIn: {
    venueId: '3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f',
    venueName: 'Sky Lagoon',
    activityId: null,
    party: { adults: 0, children: 2, infants: 0, guestChargeIsk: 2_700 },
  },
};

const unpaid = Reply.ok({ status: 'processing', awaitingPayment: true });
const confirms = () => api.sentAll('/bookings/payment-sessions/confirm', 'POST');

function confirmReplies(...replies: StubReply[]): void {
  let n = 0;
  api.on('POST', '/bookings/payment-sessions/confirm', () => replies[Math.min(n++, replies.length - 1)]);
}

function Hosts() {
  return (
    <>
      <DialogHost />
      <RecoveryProgressHost />
    </>
  );
}

/** The process has launched and its first profile has loaded: the launch link is read. */
async function launched(): Promise<void> {
  signIn();
  await act(async () => {
    await runActivationHooks({ memberId: MEMBER_A, trigger: 'profile' });
  });
  await act(flush);
}

/** The router listening, with a hand on the `url` event. */
function listen(): (url: string) => void {
  let listener: ((event: { url: string }) => void) | undefined;
  jest.spyOn(Linking, 'addEventListener').mockImplementation(((_type: string, handler: (event: { url: string }) => void) => {
    listener = handler;
    return { remove: jest.fn() };
  }) as never);
  startDeepLinks();
  return (url) => listener?.({ url });
}

beforeEach(() => {
  api.on('GET', '/profile', Reply.ok({ id: MEMBER_A, email: 'member@example.com', kennitalaVerified: false, marketingConsent: false, locale: 'en' }));
  api.on('GET', '/subscriptions', Reply.ok(null));
});

describe('a return link the app was not waiting for in memory', () => {
  it('a cancel link that arrives as a `url` event after launch is asked once, as the cancel leg', async () => {
    await launched();
    const arrive = listen();
    await act(flush);
    // The page's payment was saved, then this process lost track of it.
    await saveInflight(walkInAttempt);
    confirmReplies(unpaid);
    await render(<Hosts />);

    await act(async () => {
      arrive('lifepass://payment-canceled');
      await flush();
    });

    expect(confirms()).toHaveLength(1);
    expect(confirms()[0].body).toEqual({ key: 'walkin-key-1' });
    expect(screen.getByText(lookup('booking.pay.not_paid_title', 'en'))).toBeTruthy();
    expect(screen.getByText('No payment was taken. You can try again.')).toBeTruthy();
    expect(await storedRecords()).toEqual([]);
  });

  it('a recreated Activity started by the cancel link routes it, though the launch read has run', async () => {
    await launched();
    await saveInflight(walkInAttempt);
    confirmReplies(unpaid);
    await render(<Hosts />);

    // Android kept the process and started a new Activity with the link.
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValue('lifepass://payment-canceled');
    await act(async () => {
      listen();
      await flush();
    });

    expect(confirms()).toHaveLength(1);
    expect(screen.getByText(lookup('booking.pay.not_paid_title', 'en'))).toBeTruthy();
  });

  it('a card setup return goes to the card setup confirm', async () => {
    await launched();
    await saveInflight({ rail: 'card_setup', memberId: MEMBER_A });
    api.on('POST', '/billing/payment-methods/confirm', Reply.ok({ card: { brand: 'visa', last4: '4242' } }));

    await act(async () => {
      handleDeepLink('lifepass://card-setup-success');
      await flush();
    });

    expect(api.sentAll('/billing/payment-methods/confirm')).toHaveLength(1);
    expect(await storedRecords()).toEqual([]);
  });
});
