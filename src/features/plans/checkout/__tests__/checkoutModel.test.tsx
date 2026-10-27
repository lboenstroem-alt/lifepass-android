/**
 * The plan and pass checkout's rules (../checkoutModel.ts) against the stub
 * server: the ports of iOS PlansDiscountCodeTests (every case) and
 * PlansCheckoutTests (the checkout and return cases), plus the Android
 * return: the hosted page through the money rails, a pass confirmed from the
 * profile, a membership by the pull, the status poll and the profile, the
 * web-first chip, and a page that never opened.
 *
 * Nothing here reaches a real server: `POST /payments/checkout-sessions` and
 * every read are answered by the stub, and the Custom Tab is a mock.
 */
import { act, render, screen } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { api, Reply, type StubReply } from '@test/server';

import { refusalDestination } from '../../../../navigation/refusalSteps';
import { DialogHost } from '../../../../components/ui/Dialog';
import { lookup, setCurrentLanguage, translate } from '../../../../i18n';
import { MerchantInfo } from '../../../../config/merchantInfo';
import { expectSentToMatchContract, stubApiClientPerTest } from '../../../../api/testing';
import { recoverPayments } from '../../../../payments';
import {
  flush,
  freshPaymentsPerTest,
  signIn,
  storedRecords,
  usageJSON,
} from '../../../../payments/__tests__/paymentsHarness';
import { openHostedPage } from '../../../../payments/hostedPage';
import { useAppStore } from '../../../../stores/appStore';
import { MEMBER_A, PLUS_SUBSCRIPTION } from '../../../../stores/__tests__/storeHarness';
import { planForSlug } from '../../plans';
import { PlanCheckoutModel, resetPlanChecksForTests } from '../checkoutModel';
import {
  discountCodeMessageKey,
  isWellFormedDiscountCode,
  normaliseDiscountCode,
  type DiscountCodeProblem,
} from '../discountCode';
import { plansOffersRefusalStep } from '../refusalSteps';

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
// The refusal steps reach the Kenni sheet, whose icons load fonts through expo-asset.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();
freshPaymentsPerTest();

const explorer = planForSlug('pass-explorer')!;
const plus = planForSlug('plan-plus')!;
const openPage = jest.mocked(WebBrowser.openAuthSessionAsync);
const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);

const PASS_A = '11111111-1111-4111-8111-111111111111';
const PASS_B = '22222222-2222-4222-8222-222222222222';

function profileBody(passes: string[] = []): Record<string, unknown> {
  return {
    id: MEMBER_A,
    email: 'member@example.com',
    kennitalaVerified: true,
    marketingConsent: false,
    locale: 'en',
    usage: usageJSON(passes.map((id) => ({ id }))),
  };
}

beforeEach(() => {
  setCurrentLanguage('en');
  signIn();
  resetPlanChecksForTests();
  openPage.mockReset();
  // What refreshCredits reads after money moved.
  api.on('GET', '/profile', Reply.ok(profileBody()));
  api.on('GET', '/subscriptions', Reply.ok(null));
});

afterEach(() => setCurrentLanguage('en'));

const model = (inAppCheckout = true) => new PlanCheckoutModel({ inAppCheckout });
const checkouts = () => api.sentAll('/payments/checkout-sessions', 'POST');
const OPENED = Reply.ok({ checkoutUrl: 'https://pay.kling.is/c/cs_1', externalSessionId: 'cs_1' }, 201);

function answerCheckout(reply: StubReply): void {
  api.on('POST', '/payments/checkout-sessions', reply);
}

function query(url: string | null): Record<string, string> {
  if (!url) return {};
  const out: Record<string, string> = {};
  new URL(url).searchParams.forEach((value, name) => {
    out[name] = value;
  });
  return out;
}

/** Lets the rails run until `condition` holds (or gives up after a while). */
async function until(condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 200 && !condition(); turn += 1) await flush(1);
}

/** The member comes back from the page by `link` (or closes the tab: no link). */
function returnFromPage(link: 'lifepass://payment-success' | 'lifepass://payment-canceled' | null): void {
  openPage.mockResolvedValue(
    (link ? { type: 'success', url: link } : { type: 'dismiss' }) as WebBrowser.WebBrowserAuthSessionResult,
  );
}

// ---------------------------------------------------------------------------
// PlansDiscountCodeTests

describe('what is sent (PlansDiscountCodeTests)', () => {
  it('a pass checkout carries the code, normalised the server’s way (testAPassCheckoutSendsTheNormalisedCode)', async () => {
    answerCheckout(OPENED);
    const vm = model();
    await vm.purchasePlan(explorer, { saveCard: false, promotionCode: '  partner 10\n' });

    expect(checkouts()).toHaveLength(1);
    const body = checkouts()[0].body as Record<string, unknown>;
    expect(body.productSlug).toBe('pass-explorer');
    expect(body.promotionCode).toBe('PARTNER10');
    expect(body.saveCard).toBe(false);
    expect(vm.checkoutUrl).toBe('https://pay.kling.is/c/cs_1');
    expect(vm.state.checkoutReady).toBe(true);
    expect(vm.state.discountCodeProblem).toBeNull();
    expect(vm.state.error).toBeNull();
    expectSentToMatchContract('POST', '/payments/checkout-sessions');
  });

  it('the web-first fallback carries the pass code as ?promo= and asks the API nothing', async () => {
    const vm = model(false);
    await vm.purchasePlan(explorer, { promotionCode: ' partner10 ' });
    expect(checkouts()).toHaveLength(0);
    const url = new URL(vm.checkoutUrl!);
    expect(url.host).toBe('www.lifepass.is');
    expect(query(vm.checkoutUrl)).toEqual({ completePurchase: 'pass-explorer', promo: 'PARTNER10' });
  });

  it('no code, or only whitespace, sends nothing on either rail (testAnEmptyCodeSendsNothing)', async () => {
    answerCheckout(OPENED);
    for (const typed of [null, '', '   ', '\n\t']) {
      api.requests.length = 0;
      const vm = model();
      await vm.purchasePlan(explorer, { saveCard: true, promotionCode: typed });
      expect(checkouts()).toHaveLength(1);
      expect(checkouts()[0].body).not.toHaveProperty('promotionCode');
      // The key is omitted, not sent empty or null.
      expect(checkouts()[0].rawBody).not.toContain('promotionCode');
      expect(vm.state.discountCodeProblem).toBeNull();

      const web = model(false);
      await web.purchasePlan(explorer, { promotionCode: typed });
      expect(query(web.checkoutUrl)).toEqual({ completePurchase: 'pass-explorer' });
    }
  });

  it('a membership still sends its coupon, normalised, with no save-card flag (testAMembershipStillSendsItsCoupon)', async () => {
    answerCheckout(OPENED);
    const vm = model();
    await vm.purchasePlan(plus, { promotionCode: ' samplecode10 ' });
    const body = checkouts()[0].body as Record<string, unknown>;
    expect(body.productSlug).toBe('plan-plus');
    expect(body.promotionCode).toBe('SAMPLECODE10');
    expect(body).not.toHaveProperty('saveCard');
    expect(vm.checkoutUrl).toBe('https://pay.kling.is/c/cs_1');

    const web = model(false);
    await web.purchasePlan(plus, { promotionCode: 'samplecode10' });
    expect(query(web.checkoutUrl)).toEqual({ completePurchase: 'plan-plus', promo: 'SAMPLECODE10' });
  });
});

describe('refusals under the box (PlansDiscountCodeTests)', () => {
  it('each refusal reads as its own line, keeps the code and is never retried (testEachRefusalShowsItsMessageAndKeepsTheCode)', async () => {
    const cases: [string, Record<string, unknown>, typeof explorer, DiscountCodeProblem][] = [
      ['discount_code_invalid', {}, explorer, 'invalid'],
      ['discount_code_invalid', { reason: 'no_discount_configured' }, explorer, 'invalid'],
      ['discount_code_expired', {}, explorer, 'expired'],
      ['discount_code_not_valid_for_product', {}, explorer, 'notValidForProduct'],
      ['discount_code_not_valid_for_memberships', {}, plus, 'notValidForMemberships'],
    ];
    for (const [slug, extra, plan, expected] of cases) {
      api.requests.length = 0;
      answerCheckout(Reply.problem(400, slug, extra));
      const vm = model();
      vm.setDiscountCode('partner10');
      await vm.purchasePlan(plan, {
        saveCard: plan.mode === 'subscription' ? null : true,
        promotionCode: vm.state.discountCode,
      });
      expect([slug, vm.state.discountCodeProblem]).toEqual([slug, expected]);
      // Answered under the box, not in the payment alert.
      expect(vm.state.error).toBeNull();
      expect(vm.state.checkoutReady).toBe(false);
      expect(vm.state.isLoading).toBe(false);
      expect(vm.state.discountCode).toBe('partner10');
      expect(checkouts()).toHaveLength(1);
      expect((checkouts()[0].body as Record<string, unknown>).promotionCode).toBe('PARTNER10');
    }
  });

  it('the hyphenated spelling of a refusal reads the same (testAHyphenatedRefusalSlugReadsTheSame)', async () => {
    answerCheckout(Reply.problem(400, 'discount-code-expired'));
    const vm = model();
    await vm.purchasePlan(explorer, { promotionCode: 'PARTNER10' });
    expect(vm.state.discountCodeProblem).toBe('expired');
  });

  it('a malformed code is caught on the phone before any request, on either rail (testAMalformedCodeIsCaughtBeforeAnyRequest)', async () => {
    answerCheckout(OPENED);
    for (const typed of ['PARTNER10%', 'kóði', 'A'.repeat(65)]) {
      const vm = model();
      vm.setDiscountCode(typed);
      await vm.purchasePlan(explorer, { promotionCode: typed });
      expect([typed, vm.state.discountCodeProblem]).toEqual([typed, 'format']);
      expect(vm.state.checkoutReady).toBe(false);
      expect(vm.checkoutUrl).toBeNull();
      expect(vm.state.isLoading).toBe(false);
      expect(vm.state.discountCode).toBe(typed);

      const web = model(false);
      await web.purchasePlan(explorer, { promotionCode: typed });
      expect(web.state.discountCodeProblem).toBe('format');
      // The web page is not opened with a code it would refuse.
      expect(web.checkoutUrl).toBeNull();
    }
    expect(checkouts()).toHaveLength(0);
  });

  it('the server’s own format refusal on the field is the format line; on another field it is the alert (testTheServerFormatRefusalReadsAsTheFormatLine)', async () => {
    answerCheckout(
      Reply.problem(400, 'invalid-checkout-session', {
        errors: [{ field: 'promotionCode', message: 'Invalid promotion code' }],
      }),
    );
    const vm = model();
    await vm.purchasePlan(explorer, { promotionCode: 'PARTNER10' });
    expect(vm.state.discountCodeProblem).toBe('format');
    expect(vm.state.error).toBeNull();

    answerCheckout(Reply.problem(400, 'invalid-checkout-session', { errors: [{ field: 'successUrl', message: 'Invalid URL' }] }));
    const other = model();
    await other.purchasePlan(explorer, { promotionCode: 'PARTNER10' });
    expect(other.state.discountCodeProblem).toBeNull();
    expect(other.state.error).not.toBeNull();
  });

  it('an error that is not about the code stays the payment alert, and a code refusal with no code is never pinned on the box (testAnErrorUnrelatedToTheCodeStaysThePaymentAlert)', async () => {
    answerCheckout(Reply.problem(404, 'product_not_on_sale'));
    api.on('GET', '/catalog/plans', Reply.problem(503, 'internal_error'));
    const vm = model();
    await vm.purchasePlan(explorer, { promotionCode: 'PARTNER10' });
    expect(vm.state.discountCodeProblem).toBeNull();
    expect(vm.state.error).toEqual({ message: en('plans.err.not_on_sale'), cta: null });
    // The catalogue re-read it starts is done before the next attempt runs.
    expect(vm.catalogRefresh).not.toBeNull();
    await vm.catalogRefresh;

    answerCheckout(Reply.problem(400, 'discount_code_invalid'));
    const empty = model();
    await empty.purchasePlan(explorer, { promotionCode: '' });
    expect(empty.state.discountCodeProblem).toBeNull();
    expect(empty.state.error).not.toBeNull();
  });

  it('editing the code withdraws the refusal; Clear code empties it and the next checkout sends none (testEditingOrClearingTheCodeWithdrawsTheRefusal)', async () => {
    answerCheckout(Reply.problem(400, 'discount_code_invalid'));
    const vm = model();
    vm.setDiscountCode('PARTNER1O');
    await vm.purchasePlan(explorer, { promotionCode: vm.state.discountCode });
    expect(vm.state.discountCodeProblem).toBe('invalid');

    vm.setDiscountCode('PARTNER10');
    expect(vm.state.discountCodeProblem).toBeNull();

    // The same code again leaves a refusal standing.
    await vm.purchasePlan(explorer, { promotionCode: vm.state.discountCode });
    expect(vm.state.discountCodeProblem).toBe('invalid');
    vm.setDiscountCode('PARTNER10');
    expect(vm.state.discountCodeProblem).toBe('invalid');

    vm.clearDiscountCode();
    expect(vm.state.discountCode).toBe('');
    expect(vm.state.discountCodeProblem).toBeNull();

    api.requests.length = 0;
    answerCheckout(OPENED);
    await vm.purchasePlan(explorer, { saveCard: true, promotionCode: vm.state.discountCode });
    expect(checkouts()).toHaveLength(1);
    expect(checkouts()[0].body).not.toHaveProperty('promotionCode');
    expect(vm.state.checkoutReady).toBe(true);
  });

  it('Clear code asks for the focus to move to the box; a code typed by hand does not', () => {
    const vm = model();
    vm.setDiscountCode('X');
    expect(vm.state.codeFieldFocusRequest).toBe(0);
    vm.clearCodeTapped();
    expect(vm.state.codeFieldFocusRequest).toBe(1);
    expect(vm.state.discountCode).toBe('');
  });
});

describe('Continue (PlansDiscountCodeTests)', () => {
  it('a second tap before the first checkout has run is turned away (testASecondTapBeforeTheFirstCheckoutHasRunIsTurnedAway)', async () => {
    answerCheckout(OPENED);
    const vm = model();
    expect(vm.claimCheckout()).toBe(true);
    // Continue shows the spinner from the tap on, before the request has started.
    expect(vm.isCreatingCheckout).toBe(true);
    expect(vm.state.isLoading).toBe(false);
    expect(vm.claimCheckout()).toBe(false);

    await vm.purchasePlan(explorer, { saveCard: true, promotionCode: 'PARTNER10' });
    expect(checkouts()).toHaveLength(1);
    expect(vm.isCreatingCheckout).toBe(false);
    // A finished checkout hands Continue back.
    expect(vm.claimCheckout()).toBe(true);
  });

  it('a refusal hands Continue back, a malformed code too (testARefusalHandsContinueBack)', async () => {
    answerCheckout(Reply.problem(400, 'discount_code_invalid'));
    const vm = model();
    expect(vm.claimCheckout()).toBe(true);
    await vm.purchasePlan(explorer, { promotionCode: 'NOSUCHCODE' });
    expect(vm.state.discountCodeProblem).toBe('invalid');
    expect(vm.isCreatingCheckout).toBe(false);

    expect(vm.claimCheckout()).toBe(true);
    await vm.purchasePlan(explorer, { promotionCode: 'PARTNER10%' });
    expect(vm.state.discountCodeProblem).toBe('format');
    expect(vm.isCreatingCheckout).toBe(false);
    expect(vm.claimCheckout()).toBe(true);
  });
});

describe('the rule itself (PlansDiscountCodeTests)', () => {
  it('normalises as the server does (testNormalisationMatchesTheServer)', () => {
    expect(normaliseDiscountCode(' sam ple\tcode10\n')).toBe('SAMPLECODE10');
    expect(normaliseDiscountCode('﻿partner-10_b')).toBe('PARTNER-10_B');
    // No-break and thin spaces too.
    expect(normaliseDiscountCode(' abc ')).toBe('ABC');
    expect(normaliseDiscountCode('   ')).toBe('');

    expect(isWellFormedDiscountCode('PARTNER-10_B')).toBe(true);
    expect(isWellFormedDiscountCode('A'.repeat(64))).toBe(true);
    expect(isWellFormedDiscountCode('A'.repeat(65))).toBe(false);
    expect(isWellFormedDiscountCode('')).toBe(false);
    expect(isWellFormedDiscountCode('PARTNER10%')).toBe(false);
    // Ó is not A-Z.
    expect(isWellFormedDiscountCode(normaliseDiscountCode('kóði'))).toBe(false);
    // Checked after normalising, as the server does.
    expect(isWellFormedDiscountCode('partner10')).toBe(false);
  });

  it('says each refusal in the owner’s words, in both languages (testTheRefusalCopyInBothLanguages)', () => {
    const copy: [DiscountCodeProblem, string, string][] = [
      [
        'invalid',
        "We don't recognise this code. Check it, or clear it to pay the full price.",
        'Við þekkjum ekki þennan kóða. Athugaðu hann eða hreinsaðu hann til að greiða fullt verð.',
      ],
      [
        'expired',
        'This code has expired. Clear it to pay the full price.',
        'Þessi kóði er útrunninn. Hreinsaðu hann til að greiða fullt verð.',
      ],
      ['notValidForProduct', "This code can't be used for this pass.", 'Ekki er hægt að nota þennan kóða fyrir þennan passa.'],
      [
        'notValidForMemberships',
        'This code is for passes only, not memberships.',
        'Þessi kóði gildir aðeins fyrir passa, ekki áskriftir.',
      ],
      ['format', 'Codes use letters, numbers, - and _ only.', 'Kóðar innihalda aðeins bókstafi, tölustafi, - og _.'],
    ];
    for (const [problem, english, icelandic] of copy) {
      expect(lookup(discountCodeMessageKey(problem), 'en')).toBe(english);
      expect(lookup(discountCodeMessageKey(problem), 'is')).toBe(icelandic);
    }
  });
});

// ---------------------------------------------------------------------------
// PlansCheckoutTests

describe('the checkout and its return (PlansCheckoutTests)', () => {
  it('a confirmed checkout completes the purchase, naming the session the member paid on (testAConfirmedCheckoutCompletesThePurchase)', async () => {
    answerCheckout(OPENED);
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'fulfilled' }));
    returnFromPage('lifepass://payment-success');
    const vm = model();
    await vm.purchasePlan(plus);
    expect(vm.checkoutUrl).toBe('https://pay.kling.is/c/cs_1');

    await vm.openCheckout();

    expect(openPage).toHaveBeenCalledWith('https://pay.kling.is/c/cs_1', 'lifepass://payment-', { createTask: false });
    expect(vm.state.welcome).toEqual({ name: 'Plus', isPass: false });
    expect(vm.state.error).toBeNull();
    expect(vm.state.isVerifying).toBe(false);
    expect(api.sent('/payments/checkout-sessions/confirm').body).toEqual({ externalSessionId: 'cs_1' });
  });

  it('a gateway’s page on the status check is our side’s failure in words, never an HTTP code (testAGatewayPageOnTheReturnsStatusCheckIsNeverAnHTTPCode)', async () => {
    answerCheckout(OPENED);
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.raw(504, '<html><body><h1>504 Gateway Timeout</h1></body></html>'));
    api.on('GET', '/payments/status', Reply.raw(504, '<html><body><h1>504 Gateway Timeout</h1></body></html>'));
    returnFromPage(null);
    const vm = model();
    await vm.purchasePlan(plus);
    await vm.openCheckout();

    expect(api.sentAll('/payments/status').length).toBeGreaterThan(0);
    expect(vm.state.welcome).toBeNull();
    expect(vm.state.isVerifying).toBe(false);
    expect(vm.state.error?.message).toBe(en('error.server'));
    expect(vm.state.error?.message).not.toMatch(/504|HTTP/);
    // No step: the payment may have gone through.
    expect(vm.state.error?.cta).toBeNull();
  });

  it('a cancelled checkout verifies nothing and says nothing (testACancelledCheckoutVerifiesNothing)', async () => {
    answerCheckout(OPENED);
    returnFromPage('lifepass://payment-canceled');
    const vm = model();
    await vm.purchasePlan(plus);
    await vm.openCheckout();

    expect(api.sentAll('/payments/checkout-sessions/confirm')).toHaveLength(0);
    expect(vm.state.welcome).toBeNull();
    expect(vm.state.error).toBeNull();
    expect(vm.state.pageOpen).toBe(false);
    expect(vm.state.isVerifying).toBe(false);
  });

  it('an unverified member is sent to Kenni, not shown an error (testAnUnverifiedMemberIsSentToKenniNotShownAnError)', async () => {
    answerCheckout(Reply.problem(403, 'kennitala_verification_required'));
    const vm = model();
    await vm.purchasePlan(plus);
    expect(vm.state.needsKennitalaVerification).toBe(true);
    expect(vm.state.kennitalaBlockedPlan?.id).toBe('plan-plus');
    expect(vm.state.error).toBeNull();
    expect(vm.state.checkoutReady).toBe(false);
    // The screen takes it once.
    expect(vm.takeKennitalaRefusal()?.id).toBe('plan-plus');
    expect(vm.takeKennitalaRefusal()).toBeNull();
  });

  it('a purchase refusal keeps the next step its row defines, and the step goes with its alert (testAPurchaseRefusalKeepsItsNextStep)', async () => {
    const cases: [string, string, string][] = [
      ['subscription_already_exists_for_profile', 'refusal.has_membership', 'manageMembership'],
      ['account_deletion_scheduled', 'refusal.deletion', 'cancelDeletion'],
      ['account_pending_deletion', 'refusal.deletion', 'cancelDeletion'],
      ['trial_no_longer_available', 'refusal.trial_gone', 'seePlans'],
    ];
    const vm = model();
    for (const [code, key, cta] of cases) {
      answerCheckout(Reply.problem(409, code, { detail: `Server English for ${code}.` }));
      await vm.purchasePlan(plus);
      expect([code, vm.state.error]).toEqual([code, { message: en(key), cta }]);
      expect(vm.state.checkoutReady).toBe(false);
      vm.dismissError();
      expect(vm.state.error).toBeNull();
    }
    // A refusal with no row of its own has no step, and a new attempt starts
    // without the last one's.
    answerCheckout(Reply.problem(409, 'order_create_failed'));
    await vm.purchasePlan(plus);
    expect(vm.state.error).toEqual({ message: en('error.refusal_fallback'), cta: null });
  });

  it('the plans screen offers the steps it can take (testThePlansScreenOffersTheStepsItCanTake)', () => {
    expect(plansOffersRefusalStep('manageMembership')).toBe(true);
    expect(plansOffersRefusalStep('resumeMembership')).toBe(true);
    expect(plansOffersRefusalStep('cancelDeletion')).toBe(true);
    expect(plansOffersRefusalStep('contactSupport')).toBe(true);
    expect(plansOffersRefusalStep('seePlans')).toBe(false);
    expect(plansOffersRefusalStep('tryAgain')).toBe(false);
    expect(plansOffersRefusalStep('chooseAnotherTime')).toBe(false);
    expect(refusalDestination('manageMembership', null)).toEqual({ kind: 'account' });
    expect(refusalDestination('cancelDeletion', null)).toEqual({ kind: 'deletion' });
  });

  it('the checkout body is the contract’s (ContractFixtureTests.testPlanCheckoutReturnsToTheApp)', async () => {
    answerCheckout(OPENED);
    await model().purchasePlan(explorer, { saveCard: true, promotionCode: 'PARTNER10' });
    const sent = expectSentToMatchContract('POST', '/payments/checkout-sessions');
    expect(Object.keys(sent.body as object).sort()).toEqual([
      'cancelUrl',
      'productSlug',
      'promotionCode',
      'saveCard',
      'successUrl',
      'terms',
    ]);
    const body = sent.body as Record<string, unknown>;
    expect(body.successUrl).toBe('lifepass://payment-success');
    expect(body.cancelUrl).toBe('lifepass://payment-canceled');
    expect(Object.keys(body.terms as object).sort()).toEqual(['acceptedAt', 'privacyVersion', 'termsVersion']);
    expect(sent.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('the return on Android', () => {
  it('a pass is confirmed by a NEW pass on the profile, never by the status endpoint', async () => {
    signIn(MEMBER_A, { usage: usageJSON([{ id: PASS_A }]) });
    answerCheckout(OPENED);
    // The pull answered ambiguously; the profile shows the new pass on the third read.
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'processing' }));
    let reads = 0;
    api.on('GET', '/profile', () => {
      reads += 1;
      return Reply.ok(profileBody(reads < 3 ? [PASS_A] : [PASS_A, PASS_B]));
    });
    returnFromPage(null);
    const vm = model();
    await vm.purchasePlan(explorer, { saveCard: true });
    await vm.openCheckout();

    expect(api.sentAll('/payments/checkout-sessions/confirm')).toHaveLength(3);
    expect(api.sentAll('/payments/status')).toHaveLength(0);
    expect(vm.state.welcome).toEqual({ name: 'Explorer', isPass: true });
  });

  it('a pass that never shows up is the timeout copy naming the support address, never "processing"', async () => {
    signIn(MEMBER_A, { usage: usageJSON([{ id: PASS_A }]) });
    answerCheckout(OPENED);
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'fulfilled' }));
    api.on('GET', '/profile', Reply.ok(profileBody([PASS_A])));
    returnFromPage('lifepass://payment-success');
    const vm = model();
    await vm.purchasePlan(explorer, { saveCard: false });
    await vm.openCheckout();

    // Six profile reads, the status endpoint never.
    expect(api.sentAll('/profile', 'GET')).toHaveLength(6);
    expect(api.sentAll('/payments/status')).toHaveLength(0);
    expect(vm.state.welcome).toBeNull();
    expect(vm.state.error).toEqual({ message: en('plans.confirm_timeout', { email: MerchantInfo.email }), cta: null });
    expect(vm.state.error?.message).toContain('Contact@sport-a.com');
  });

  it('a membership the pull cannot confirm is confirmed by the status poll for its plan', async () => {
    answerCheckout(OPENED);
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.problem(404, 'not_found'));
    api.on('GET', '/payments/status', Reply.ok({ status: 'fulfilled', kind: 'subscription', slug: 'plan-plus' }));
    returnFromPage('lifepass://payment-success');
    const vm = model();
    await vm.purchasePlan(plus);
    await vm.openCheckout();
    expect(api.sent('/payments/status').query).toEqual({ plan: 'plan-plus' });
    expect(vm.state.welcome).toEqual({ name: 'Plus', isPass: false });
  });

  it('a membership the status poll never reports is confirmed by the profile switching to it', async () => {
    answerCheckout(OPENED);
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'processing' }));
    api.on('GET', '/payments/status', Reply.ok({ status: 'pending' }));
    returnFromPage(null);
    const vm = model();
    await vm.purchasePlan(plus);
    api.on('GET', '/subscriptions', Reply.ok(PLUS_SUBSCRIPTION));
    await vm.openCheckout();
    expect(api.sentAll('/payments/status')).toHaveLength(12);
    expect(vm.state.welcome).toEqual({ name: 'Plus', isPass: false });
  });

  it('a membership the member already had is not "confirmed" by the profile alone', async () => {
    // Plus was active before checkout: only the pull or the status poll may confirm a re-purchase.
    api.on('GET', '/subscriptions', Reply.ok(PLUS_SUBSCRIPTION));
    await useAppStore.getState().loadSubscription();
    answerCheckout(OPENED);
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'processing' }));
    api.on('GET', '/payments/status', Reply.ok({ status: 'pending' }));
    returnFromPage(null);
    const vm = model();
    await vm.purchasePlan(plus);
    await vm.openCheckout();
    expect(vm.state.welcome).toBeNull();
    expect(vm.state.error?.message).toBe(en('plans.confirm_timeout', { email: MerchantInfo.email }));
  });

  it('shows "Confirming your payment…" from the page closing until the answer, and its Cancel lets the check run on', async () => {
    answerCheckout(OPENED);
    let answer: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    api.on('POST', '/payments/checkout-sessions/confirm', async () => {
      await answered;
      return Reply.ok({ status: 'fulfilled' });
    });
    returnFromPage('lifepass://payment-success');
    const vm = model();
    await vm.purchasePlan(plus);
    const done = vm.openCheckout();
    await until(() => vm.state.isVerifying);
    expect(vm.state.isVerifying).toBe(true);
    expect(vm.state.verificationRunning).toBe(true);

    vm.dismissOverlay();
    expect(vm.state.isVerifying).toBe(false);
    expect(vm.state.verificationRunning).toBe(true);
    // A tap meanwhile brings it back rather than a second checkout.
    vm.showOverlay();
    expect(vm.state.isVerifying).toBe(true);
    vm.dismissOverlay();

    answer();
    await done;
    expect(vm.state.verificationRunning).toBe(false);
    expect(vm.state.welcome).not.toBeNull();
  });

  /** A first checkout of Plus whose return could not be verified (a gateway page): its attempt stays saved. */
  async function anUnverifiedCheckoutOfPlus(): Promise<void> {
    let session = 0;
    api.on('POST', '/payments/checkout-sessions', () => {
      session += 1;
      return Reply.ok({ checkoutUrl: `https://pay.kling.is/c/cs_${session}`, externalSessionId: `cs_${session}` }, 201);
    });
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'processing' }));
    api.on('GET', '/payments/status', Reply.raw(504, '<html>504</html>'));
    returnFromPage('lifepass://payment-success');
    const first = model();
    await first.purchasePlan(plus);
    await first.openCheckout();
    expect(first.state.error?.message).toBe(en('error.server'));
    expect(openPage).toHaveBeenCalledTimes(1);
    expect(checkouts()).toHaveLength(1);
    expect(await storedRecords()).toHaveLength(1);
  }

  it('an earlier checkout of the same plan still unverified is verified instead: no second session, no second page', async () => {
    await render(<DialogHost />);
    await anUnverifiedCheckoutOfPlus();

    // The member tries again: nothing is created, the earlier payment is checked under its own session.
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'fulfilled' }));
    const again = model();
    await again.purchasePlan(plus);
    expect(checkouts()).toHaveLength(1);
    expect(again.state.checkoutReady).toBe(false);
    expect(again.state.earlierPending).toBe(true);
    expect(again.state.error).toBeNull();

    // Once the sheet has gone: "Confirming your payment…" until the answer.
    const followed = again.followEarlierCheckout();
    expect(again.state.isVerifying).toBe(true);
    expect(again.isCheckRunning).toBe(true);
    await act(() => followed);

    expect(checkouts()).toHaveLength(1);
    expect(openPage).toHaveBeenCalledTimes(1);
    expect(api.sent('/payments/checkout-sessions/confirm').body).toEqual({ externalSessionId: 'cs_1' });
    expect(again.state.isVerifying).toBe(false);
    expect(again.state.verificationRunning).toBe(false);
    expect(again.state.earlierPending).toBe(false);
    expect(again.state.error).toBeNull();
    // The rails' plan presenter says it, in the Plans screen's words, once.
    expect(screen.getAllByText(en('plans.welcome_title'))).toHaveLength(1);
    expect(screen.getByText(en('plans.success.subscription', { name: 'Plus' }))).toBeOnTheScreen();
    expect(await storedRecords()).toHaveLength(0);
  });

  it('an earlier checkout that still cannot be verified is said, kept, and still no session is made', async () => {
    await render(<DialogHost />);
    await anUnverifiedCheckoutOfPlus();

    const again = model();
    await again.purchasePlan(plus);
    await act(() => again.followEarlierCheckout());

    expect(checkouts()).toHaveLength(1);
    expect(openPage).toHaveBeenCalledTimes(1);
    expect(again.state.isVerifying).toBe(false);
    expect(again.state.error).toEqual({ message: en('payment.err.checkout'), cta: null });
    // Said once, here: the quiet check the rails ran says nothing of its own.
    expect(screen.queryByText(en('plans.payment_issue'))).toBeNull();
    expect(await storedRecords()).toHaveLength(1);
  });

  it('an earlier checkout confirmed while the tap waited is not bought again, and its welcome is said once', async () => {
    await render(<DialogHost />);
    await anUnverifiedCheckoutOfPlus();

    // A return to the app starts the rails' recovery; the pull answers only when let go.
    let answer: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    api.on('POST', '/payments/checkout-sessions/confirm', async () => {
      await answered;
      return Reply.ok({ status: 'fulfilled' });
    });
    const recovery = recoverPayments(MEMBER_A, 'foreground');
    await flush(2);

    const again = model();
    const tapped = again.purchasePlan(plus);
    await flush(2);
    // The tap waits for the recovery, with the sheet's spinner up.
    expect(again.isCreatingCheckout).toBe(true);
    answer();
    await act(() => Promise.all([recovery, tapped]));

    expect(checkouts()).toHaveLength(1);
    expect(again.state.earlierPending).toBe(true);
    await act(() => again.followEarlierCheckout());
    expect(openPage).toHaveBeenCalledTimes(1);
    expect(again.state.welcome).toBeNull();
    expect(screen.getAllByText(en('plans.welcome_title'))).toHaveLength(1);
  });

  it('a check a closed Plans left running is followed by the next Plans, never answered with a second checkout', async () => {
    await render(<DialogHost />);
    answerCheckout(OPENED);
    let answer: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    api.on('POST', '/payments/checkout-sessions/confirm', async () => {
      await answered;
      return Reply.ok({ status: 'fulfilled' });
    });
    returnFromPage('lifepass://payment-success');
    let alive = true;
    const first = new PlanCheckoutModel({ inAppCheckout: true, isScreenAlive: () => alive });
    await first.purchasePlan(plus);
    const done = first.openCheckout();
    await until(() => first.state.isVerifying);
    // Cancel on the overlay, then Plans is closed.
    first.dismissOverlay();
    alive = false;

    // Plans opened again: Continue brings "Confirming your payment…" back.
    const reopened = model();
    expect(reopened.isCheckRunning).toBe(true);
    reopened.showOverlay();
    expect(reopened.state.isVerifying).toBe(true);
    expect(reopened.state.verificationRunning).toBe(true);
    reopened.dismissOverlay();

    // Even a purchase that reached the model makes no session while the check runs.
    const another = model();
    await another.purchasePlan(explorer, { saveCard: true });
    expect(checkouts()).toHaveLength(1);
    expect(another.state.earlierPending).toBe(true);
    const followed = another.followEarlierCheckout();
    expect(another.state.isVerifying).toBe(true);

    answer();
    await act(() => done);
    await act(() => followed);
    await until(() => !reopened.state.verificationRunning && !another.state.verificationRunning);
    expect(another.state.isVerifying).toBe(false);
    expect(another.state.error).toBeNull();
    expect(reopened.isCheckRunning).toBe(false);
    expect(openPage).toHaveBeenCalledTimes(1);
    // The closed screen's purchase is said by the rails, once.
    expect(first.state.welcome).toBeNull();
    expect(screen.getAllByText(en('plans.welcome_title'))).toHaveLength(1);
  });

  it('a page that never opened is the payment alert, and nothing is verified', async () => {
    answerCheckout(OPENED);
    openPage.mockRejectedValue(new Error('No browser on this phone'));
    const vm = model();
    await vm.purchasePlan(explorer, { saveCard: true });
    await vm.openCheckout();
    expect(api.sentAll('/payments/checkout-sessions/confirm')).toHaveLength(0);
    expect(vm.state.error).toEqual({ message: en('payment.err.checkout'), cta: null });
    expect(vm.state.pageOpen).toBe(false);
  });

  it('another page already open holds the rail: no second page, and the member is told to try again', async () => {
    answerCheckout(OPENED);
    // A page some other flow opened, still up.
    openPage.mockImplementationOnce(() => new Promise(() => undefined));
    void openHostedPage('https://pay.kling.is/other', 'payment');
    const vm = model();
    await vm.purchasePlan(explorer, { saveCard: true });
    await vm.openCheckout();
    // Asked before the create: no session is made that could not open.
    expect(checkouts()).toHaveLength(0);
    expect(openPage).toHaveBeenCalledTimes(1);
    expect(vm.state.error).toEqual({ message: en('payment.err.checkout'), cta: null });
    expect(vm.state.pageOpen).toBe(false);
  });

  it('a screen that went away leaves the welcome to the rails, which say it themselves', async () => {
    await render(<DialogHost />);
    answerCheckout(OPENED);
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'fulfilled' }));
    returnFromPage('lifepass://payment-success');
    const vm = new PlanCheckoutModel({ inAppCheckout: true, isScreenAlive: () => false });
    await vm.purchasePlan(plus);
    await act(() => vm.openCheckout());
    expect(vm.state.welcome).toBeNull();
    expect(screen.getByText(en('plans.welcome_title'))).toBeOnTheScreen();
    expect(screen.getByText(en('plans.success.subscription', { name: 'Plus' }))).toBeOnTheScreen();
  });

  describe('the web-first fallback', () => {
    it('opens the web plans page and, finding nothing on a short check, offers the quiet chip; the chip confirms later', async () => {
      returnFromPage(null);
      const vm = model(false);
      await vm.purchasePlan(explorer);
      await vm.openCheckout();
      expect(openPage.mock.calls[0][0]).toBe('https://www.lifepass.is/plans?completePurchase=pass-explorer');
      expect(api.sentAll('/payments/checkout-sessions/confirm')).toHaveLength(0);
      expect(api.sentAll('/profile', 'GET')).toHaveLength(3);
      expect(vm.state.verificationPending).toBe(true);
      expect(vm.state.error).toBeNull();

      api.on('GET', '/profile', Reply.ok(profileBody([PASS_B])));
      await vm.recheckPurchase();
      expect(vm.state.verificationPending).toBe(false);
      expect(vm.state.welcome).toEqual({ name: 'Explorer', isPass: true });
    });

    it('a check that still finds nothing keeps the chip', async () => {
      returnFromPage(null);
      const vm = model(false);
      await vm.purchasePlan(explorer);
      await vm.openCheckout();
      const reads = api.sentAll('/profile', 'GET').length;
      await vm.recheckPurchase();
      expect(api.sentAll('/profile', 'GET').length).toBe(reads + 2);
      expect(vm.state.verificationPending).toBe(true);
      expect(vm.state.welcome).toBeNull();
    });
  });

  it('the welcome names the plan in the language the member bought it in', async () => {
    setCurrentLanguage('is');
    answerCheckout(OPENED);
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'fulfilled' }));
    api.on('GET', '/profile', Reply.ok(profileBody([PASS_B])));
    returnFromPage('lifepass://payment-success');
    const vm = model();
    await vm.purchasePlan(planForSlug('pass-day-gym')!, { saveCard: true });
    await vm.openCheckout();
    expect(vm.state.welcome).toEqual({ name: 'Rækt dagspassi', isPass: true });
  });
});
