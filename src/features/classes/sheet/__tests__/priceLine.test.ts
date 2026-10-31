/**
 * The line pinned above the class sheet's Confirm, driven through the real
 * booking session against the stub server (iOS ClassBookingSheetTests "The
 * price line above Confirm (2.5.2 polish)", and the line assertions of the
 * card-less section: testTheLineIsTheChargeForEveryKindOfMember,
 * testAnOutOfVisitsTopUpGivesOneReasonOnTheLineAndInTheConsent,
 * testTheCreatesOfferReplacesThePreviewsFigureBeforePaying,
 * testASessionReofferMovesTheLineAndAsksAgain).
 *
 * The line is what Confirm charges: the preview's figure first, the server's
 * own 402 offer from the moment it arrives, none for an included, pass or
 * refused visit, and the row's "Surcharge from" only when the disclosure
 * failed.
 */
import * as WebBrowser from 'expo-web-browser';
import { Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { iskPrefix, setCurrentLanguage, type Lang } from '../../../../i18n';
import { freshPaymentsPerTest, signIn } from '../../../../payments/__tests__/paymentsHarness';
import { ClassSheetHeight, sheetPriceLine } from '../model';
import { bookingCopy, visitChoiceOptions } from '../../../booking';
import {
  ablerOccurrence,
  bodyOf,
  cardlessClassServer,
  classesReply,
  CONFIRMED,
  consent,
  FREE_PREVIEW,
  klass,
  requests,
  respond,
  RUNG_CHOICE_PREVIEW,
  SESSION_REDIRECT,
  sessionPosts,
  slotOccurrence,
  slotsReply,
  START,
  SURCHARGE_PREVIEW,
  testSession,
  type TestSession,
} from './sheetHarness';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

const openAuthSession = jest.mocked(WebBrowser.openAuthSessionAsync);
const DONE = { type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult;

stubApiClientPerTest();
freshPaymentsPerTest();

beforeEach(() => {
  signIn();
  setCurrentLanguage('en');
});

/** The sheet's line for this session, as the sheet draws it (`surchargeFromIsk` from the row). */
function priceLine(session: TestSession, language: Lang, surchargeFromIsk: number | null = null): string | null {
  return sheetPriceLine(session.store.getState(), surchargeFromIsk, language);
}

function classServer(preview: unknown): void {
  respond((request) => {
    if (request.path.endsWith('/classes')) return classesReply([klass(4242, START)]);
    if (request.path.endsWith('/booking-preview')) return Reply.ok(preview);
    return Reply.problem(404, 'not_found');
  });
}

it('a surcharge names its amount above Confirm, in the disclosure money format, in both languages', async () => {
  classServer(SURCHARGE_PREVIEW);
  const session = testSession();
  await session.prepare(ablerOccurrence());

  expect(priceLine(session, 'en')).toBe('ISK 1,990 charged when you confirm');
  expect(priceLine(session, 'is')).toBe('ISK 1,990 gjaldfært þegar þú staðfestir');
  expect(priceLine(session, 'en')?.startsWith(iskPrefix(1_990))).toBe(true);
});

it('a top-up names its amount above Confirm', async () => {
  classServer({ kind: 'topup', topupReason: 'boutique_overflow', priceIsk: 2_490, remainingMonthly: 0, isLastBeforeTopUp: false });
  const session = testSession();
  await session.prepare(ablerOccurrence());
  expect(priceLine(session, 'en')).toBe('ISK 2,490 charged when you confirm');
});

it("a class shows the server's rung with no picker, stays at half height, and never sends a rung", async () => {
  classServer(RUNG_CHOICE_PREVIEW);
  const session = testSession();
  await session.prepare(ablerOccurrence());

  expect(requests('/booking-preview')[0]?.query.visitChoice).toBeUndefined();
  expect(visitChoiceOptions(session.store.getState())).toEqual([]);
  expect(priceLine(session, 'en')).toBe('ISK 1,500 charged when you confirm');
  const s = session.store.getState();
  expect(ClassSheetHeight.expands(s.occurrenceStatus === 'ready', s.gateRefusal !== null, visitChoiceOptions(s).length > 0)).toBe(
    false,
  );

  // A rung left over from anywhere never reaches a class's price.
  session.store.setState({ visitChoice: 'keep_visit' });
  expect(priceLine(session, 'en')).toBe('ISK 1,500 charged when you confirm');
  await session.store.getState().loadPreview();
  expect(requests('/booking-preview').at(-1)?.query.visitChoice).toBeUndefined();
});

it("a slot's line follows the picked rung, and two priced choices open the sheet to full height", async () => {
  respond((request) => {
    if (request.path.endsWith('/availability')) return slotsReply([START]);
    if (request.path.endsWith('/booking-preview')) return Reply.ok(RUNG_CHOICE_PREVIEW);
    return Reply.problem(404, 'not_found');
  });
  const session = testSession();
  await session.prepare(slotOccurrence(new Date(START.getTime() + 2_700_000)));
  expect(priceLine(session, 'en')).toBe('ISK 1,500 charged when you confirm');

  session.store.setState({ visitChoice: 'keep_visit' });
  expect(priceLine(session, 'en')).toBe('ISK 4,900 charged when you confirm');

  const s = session.store.getState();
  expect(ClassSheetHeight.expands(s.occurrenceStatus === 'ready', s.gateRefusal !== null, visitChoiceOptions(s).length > 0)).toBe(
    true,
  );
});

it('an included class has no price line', async () => {
  classServer(FREE_PREVIEW);
  const session = testSession();
  await session.prepare(ablerOccurrence());
  expect(priceLine(session, 'en')).toBeNull();
});

it('a refused class has no price line', async () => {
  respond((request) => {
    if (request.path.endsWith('/classes')) return classesReply([klass(4242, START)]);
    if (request.path.endsWith('/booking-preview')) return Reply.problem(403, 'no_active_plan_or_pass');
    return Reply.problem(404, 'not_found');
  });
  const session = testSession();
  await session.prepare(ablerOccurrence({ surchargeFromIsk: 1_990 }));
  expect(session.store.getState().gateRefusal).not.toBeNull();
  expect(priceLine(session, 'en', 1_990)).toBeNull();
});

it("a failed disclosure falls back to the row's 'from' price; the consent names the exact amount", async () => {
  respond((request) => {
    if (request.path.endsWith('/availability')) return Reply.problem(500, 'internal_error');
    if (request.path.endsWith('/booking-preview')) return Reply.problem(500, 'internal_error');
    return Reply.problem(404, 'not_found');
  });
  const occurrence = slotOccurrence(new Date(START.getTime() + 2_700_000));
  const session = testSession();
  await session.prepare(occurrence);

  expect(session.store.getState().occurrenceStatus).toBe('ready');
  expect(session.store.getState().preview).toBeNull();
  expect(priceLine(session, 'en', occurrence.surchargeFromIsk)).toBe('Surcharge from ISK 1,990');
  expect(priceLine(session, 'is', occurrence.surchargeFromIsk)).toBe('Aukagjald frá ISK 1,990');
});

describe('the line is the charge for every kind of member', () => {
  function preview(
    kind: string,
    price: number | null,
    reasons: { surcharge?: string; topup?: string; remaining?: number } = {},
  ): Record<string, unknown> {
    return {
      kind,
      topupReason: reasons.topup ?? null,
      surchargeReason: reasons.surcharge ?? null,
      priceIsk: price,
      remainingMonthly: reasons.remaining ?? null,
      isLastBeforeTopUp: false,
    };
  }

  const rows: { name: string; preview: Record<string, unknown>; amount: number | null; offerKind?: string; noVisit?: boolean }[] = [
    { name: 'subscriber, visit included', preview: preview('free', null, { remaining: 5 }), amount: null },
    { name: 'trial visit', preview: preview('free', null), amount: null },
    { name: 'pass holder, in-bundle venue', preview: preview('pass', null), amount: null },
    { name: 'subscriber, premium, visit spent', preview: preview('surcharge', 1_500, { surcharge: 'premium_subscriber_visit' }), amount: 1_500 },
    { name: 'pass holder, premium, pass visit spent', preview: preview('surcharge', 1_500, { surcharge: 'premium_pass_visit' }), amount: 1_500 },
    { name: 'subscriber, boutique past its allowance', preview: preview('surcharge', 990, { surcharge: 'boutique_overflow' }), amount: 990 },
    { name: 'subscriber, out of visits (top-up)', preview: preview('topup', 2_990), amount: 2_990, offerKind: 'topup', noVisit: true },
    {
      name: 'subscriber, included venue, out of visits this period (top-up)',
      preview: preview('topup', 2_790, { topup: 'monthly_exhausted' }),
      amount: 2_790,
      offerKind: 'topup',
      noVisit: true,
    },
    {
      name: 'subscriber, premium, out of visits',
      preview: preview('surcharge', 4_900, { surcharge: 'premium_out_of_visits' }),
      amount: 4_900,
      noVisit: true,
    },
    {
      name: 'company-covered, premium, no plan visit',
      preview: preview('surcharge', 6_300, { surcharge: 'premium_no_plan' }),
      amount: 6_300,
      noVisit: true,
    },
    { name: 'no plan, boutique', preview: preview('surcharge', 3_500, { surcharge: 'boutique_access' }), amount: 3_500, noVisit: true },
  ];

  it.each(rows)('$name', async (row) => {
    if (row.amount != null) {
      cardlessClassServer({ preview: row.preview, offer: row.amount, offerKind: row.offerKind ?? 'surcharge' });
    } else {
      respond((request) => {
        if (request.path.endsWith('/classes')) return classesReply([klass(4242, START)]);
        if (request.path.endsWith('/booking-preview')) return Reply.ok(row.preview);
        if (request.method === 'POST' && request.path === '/bookings') return Reply.ok(CONFIRMED);
        return Reply.problem(404, 'not_found');
      });
    }
    const session = testSession();
    await session.prepare(ablerOccurrence());
    await session.store.getState().confirmBooking();

    if (row.amount == null) {
      // Nothing to pay: no line, no consent, booked, and no pay step.
      expect(priceLine(session, 'en')).toBeNull();
      expect(session.store.getState().showChargeConsent).toBe(false);
      expect(session.store.getState().bookingComplete).toBe(true);
      expect(sessionPosts()).toHaveLength(0);
      return;
    }
    expect(session.store.getState().pendingOffer?.amountIsk).toBe(row.amount);
    expect(priceLine(session, 'en')).toBe(`${iskPrefix(row.amount)} charged when you confirm`);

    if (row.noVisit) {
      const p = session.store.getState().preview!;
      for (const language of ['en', 'is'] as const) {
        const copy = bookingCopy(language);
        for (const text of [copy.disclosureText(p), copy.chargeConsentMessage(session.store.getState())]) {
          expect(text.toLowerCase()).not.toContain('surcharge');
          expect(text.toLowerCase()).not.toContain('álag');
          expect(text).toContain(iskPrefix(row.amount));
        }
      }
    }

    openAuthSession.mockResolvedValueOnce(DONE);
    await session.store.getState().acceptCharge();
    const body = bodyOf(sessionPosts()[0]);
    expect(body.acceptedChargeAmountIsk).toBe(row.amount);
    expect(body.eventId).toBe(4242);
    // Paid and booked: the line still names the charge until the sheet closes.
    expect(session.store.getState().bookingComplete).toBe(true);
    expect(priceLine(session, 'en')).toBe(`${iskPrefix(row.amount)} charged when you confirm`);
  });
});

it('out of visits this period gives one reason on the line, in the disclosure and in the consent', async () => {
  cardlessClassServer({
    preview: { kind: 'topup', topupReason: 'monthly_exhausted', priceIsk: 2_790, remainingMonthly: 0, isLastBeforeTopUp: false },
    offer: 2_790,
    offerKind: 'topup',
  });
  const session = testSession();
  await session.prepare(ablerOccurrence());
  await session.store.getState().confirmBooking();
  expect(session.store.getState().showChargeConsent).toBe(true);
  const p = session.store.getState().preview!;
  const en = bookingCopy('en');
  expect(en.disclosureText(p)).toBe("You're out of visits this period, so this visit is ISK 2,790.");
  expect(en.chargeConsentMessage(session.store.getState())).toBe("You're out of visits this period. Continue for ISK 2,790?");
  const ice = bookingCopy('is');
  expect(ice.disclosureText(p)).toBe('Þú hefur klárað heimsóknir tímabilsins, svo þessi heimsókn kostar ISK 2,790.');
  expect(ice.chargeConsentMessage(session.store.getState())).toBe(
    'Þú hefur klárað heimsóknir tímabilsins. Halda áfram fyrir ISK 2,790?',
  );
  expect(priceLine(session, 'en')).toBe('ISK 2,790 charged when you confirm');
});

it("the create's offer replaces the preview's figure before paying, and stays after a declined consent", async () => {
  cardlessClassServer({ preview: SURCHARGE_PREVIEW, offer: 2_490 });
  const session = testSession();
  await session.prepare(ablerOccurrence());
  expect(priceLine(session, 'en')).toBe('ISK 1,990 charged when you confirm');

  await session.store.getState().confirmBooking();
  expect(session.store.getState().showChargeConsent).toBe(true);
  expect(priceLine(session, 'en')).toBe('ISK 2,490 charged when you confirm');
  expect(priceLine(session, 'is')).toBe('ISK 2,490 gjaldfært þegar þú staðfestir');
  expect(bookingCopy('en').consentButtonLabel(session.store.getState())).toContain('ISK 2,490');

  session.store.getState().declineCharge();
  expect(priceLine(session, 'en')).toBe('ISK 2,490 charged when you confirm');

  openAuthSession.mockResolvedValueOnce(DONE);
  await session.store.getState().confirmBooking();
  await session.store.getState().acceptCharge();
  expect(bodyOf(sessionPosts()[0]).acceptedChargeAmountIsk).toBe(2_490);

  // Reading the price again starts from the server's new figure.
  await session.store.getState().loadPreview();
  expect(priceLine(session, 'en')).toBe('ISK 1,990 charged when you confirm');
});

it('a session re-offer moves the line and asks again; the accepted amount re-enters the rail', async () => {
  let sessions = 0;
  respond((request) => {
    if (request.path.endsWith('/classes')) return classesReply([klass(4242, START)]);
    if (request.path.endsWith('/booking-preview')) return Reply.ok(SURCHARGE_PREVIEW);
    if (request.method === 'POST' && request.path === '/bookings/payment-sessions') {
      sessions += 1;
      return sessions === 1 ? consent(2_290) : SESSION_REDIRECT;
    }
    if (request.method === 'POST' && request.path === '/bookings/payment-sessions/confirm') {
      return Reply.ok({ status: 'fulfilled', bookingId: '7a1c2b3d-0000-4000-8000-000000000010' });
    }
    if (request.method === 'POST' && request.path === '/bookings') {
      const body = bodyOf(request);
      if (body.acceptCharge === true && (body.acceptedChargeAmountIsk === 1_990 || body.acceptedChargeAmountIsk === 2_290)) {
        return Reply.problem(402, 'no_payment_method_on_file');
      }
      return consent(1_990);
    }
    return Reply.problem(404, 'not_found');
  });
  const session = testSession();
  await session.prepare(ablerOccurrence());
  await session.store.getState().confirmBooking();
  await session.store.getState().acceptCharge();

  expect(session.store.getState().showChargeConsent).toBe(true);
  expect(session.store.getState().offerWasReoffered).toBe(true);
  expect(priceLine(session, 'en')).toBe('ISK 2,290 charged when you confirm');
  expect(openAuthSession).not.toHaveBeenCalled();

  openAuthSession.mockResolvedValueOnce(DONE);
  await session.store.getState().acceptCharge();
  expect(sessionPosts()).toHaveLength(2);
  expect(bodyOf(sessionPosts()[1]).acceptedChargeAmountIsk).toBe(2_290);
  expect(openAuthSession).toHaveBeenCalledTimes(1);
});
