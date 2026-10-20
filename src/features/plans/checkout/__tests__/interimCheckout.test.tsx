/**
 * The checkout behind Continue, on the interim rail (../interimCheckout.ts)
 * until PLANS-2's payment sheet: the refusals PLANS-1's features answer, in iOS's
 * words (PlansCatalogPassesTests `testAPassOffSaleIsSaidInWordsAndItsCardGoes`
 * and its Icelandic twin, `testTheProblemReadsAsItsOwnSentence`;
 * PlansCheckoutTests `testAnUnverifiedMemberIsSentToKenniNotShownAnError` and
 * the refusal sentences of `testAPurchaseRefusalKeepsItsNextStep`).
 *
 * The real chain runs against the stub server: a refusal comes back from
 * `POST /payments/checkout-sessions` before any page opens.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { api, Reply } from '@test/server';

import { ProblemError, problemMessage } from '../../../../api';
import { expectSentToMatchContract, stubApiClientPerTest } from '../../../../api/testing';
import { DialogHost, dismissAllDialogs } from '../../../../components/ui/Dialog';
import { setCurrentLanguage, translate } from '../../../../i18n';
import { setAnalyticsObserver } from '../../../../lib/analytics';
import { freshPaymentsPerTest, signIn } from '../../../../payments/__tests__/paymentsHarness';
import * as legacyPayments from '../../../../supabase/services/payments';
import { currentPlanCatalog, loadPlanCatalog, resetPlanCatalog } from '../../catalogStore';
import { planForSlug, visitorPasses } from '../../plans';
import { catalogue, CATALOGUE_WITHOUT_POOL, pass } from '../../__tests__/fixtures';
import { usePlanCheckout, type PlanCheckout, type PlanCheckoutEvents } from '..';
import { attemptPlanCheckout } from '../interimCheckout';

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();
freshPaymentsPerTest();

const plus = planForSlug('plan-plus')!;
const poolPass = planForSlug('pass-day-pool')!;
const en = (key: string) => translate(key, 'en');

beforeEach(() => {
  resetPlanCatalog();
  setCurrentLanguage('en');
  signIn();
});

afterEach(() => {
  setCurrentLanguage('en');
  setAnalyticsObserver(null);
});

const refuseCheckout = (status: number, slug: string) =>
  api.on('POST', '/payments/checkout-sessions', Reply.problem(status, slug, { detail: `Server English for ${slug}.` }));

describe('attemptPlanCheckout', () => {
  it('sends an unverified member to Kenni, never an error', async () => {
    refuseCheckout(403, 'kennitala_verification_required');
    await expect(attemptPlanCheckout(plus)).resolves.toEqual({ kind: 'kennitalaRequired' });
    expect(jest.mocked(WebBrowser.openAuthSessionAsync)).not.toHaveBeenCalled();
  });

  it('a pass off sale is said in words, the code is not blamed, and the catalogue is read again so its card goes', async () => {
    // The cards were drawn from a catalogue read before the pass went off sale.
    api.on(
      'GET',
      '/catalog/plans',
      Reply.ok(catalogue({ dayPasses: [pass('pass-day-pool', 1_490), pass('pass-day-gym', 2_990), pass('pass-day-studio', 3_490)] })),
    );
    await loadPlanCatalog();
    expect(visitorPasses(currentPlanCatalog()).map((p) => p.id)).toContain('pass-day-pool');

    refuseCheckout(404, 'product_not_on_sale');
    api.on('GET', '/catalog/plans', Reply.ok(CATALOGUE_WITHOUT_POOL));
    const attempt = await attemptPlanCheckout(poolPass);

    expect(attempt).toEqual({
      kind: 'issue',
      message: "This pass isn't on sale right now. Passes you already have still work.",
      catalogRefresh: expect.any(Promise),
    });
    if (attempt.kind !== 'issue') throw new Error('not an issue');
    await attempt.catalogRefresh;
    expect(visitorPasses(currentPlanCatalog()).map((p) => p.id)).not.toContain('pass-day-pool');
    expect(api.sentAll('/payments/checkout-sessions', 'POST')).toHaveLength(1);
  });

  it('says the pass off sale in Icelandic', async () => {
    refuseCheckout(404, 'product_not_on_sale');
    api.on('GET', '/catalog/plans', Reply.problem(503, 'internal_error'));
    setCurrentLanguage('is');
    const attempt = await attemptPlanCheckout(poolPass);
    expect(attempt).toEqual(
      expect.objectContaining({
        kind: 'issue',
        message: 'Þessi passi er ekki til sölu eins og er. Passar sem þú átt nú þegar gilda áfram.',
      }),
    );
    if (attempt.kind === 'issue') await attempt.catalogRefresh;
  });

  it('reads product_not_on_sale as its own sentence wherever it is read', () => {
    const problem = {
      type: 'https://lifepass.is/problems/product_not_on_sale',
      title: 'product_not_on_sale',
      status: 404,
      detail: 'This pass is not on sale right now. Passes already bought still work.',
      instance: '/api/v1/payments/checkout-sessions',
    };
    expect(problemMessage(problem, 'en')).toBe("This pass isn't on sale right now. Passes you already have still work.");
    expect(problemMessage(problem, 'is')).toBe('Þessi passi er ekki til sölu eins og er. Passar sem þú átt nú þegar gilda áfram.');
    expect(new ProblemError(problem, 404).isProblem('product-not-on-sale')).toBe(true);
  });

  it("says a purchase refusal in the member's words, never the server's English", async () => {
    const cases: [string, string][] = [
      ['subscription_already_exists_for_profile', 'refusal.has_membership'],
      ['account_deletion_scheduled', 'refusal.deletion'],
      ['trial_no_longer_available', 'refusal.trial_gone'],
      ['order_create_failed', 'error.refusal_fallback'],
    ];
    for (const [slug, key] of cases) {
      refuseCheckout(409, slug);
      const attempt = await attemptPlanCheckout(plus);
      expect([slug, attempt]).toEqual([slug, { kind: 'issue', message: en(key), catalogRefresh: null }]);
    }
  });

  it("a gateway's page is our side's failure in words, never an HTTP code", async () => {
    api.on('POST', '/payments/checkout-sessions', Reply.raw(504, '<html><body><h1>504 Gateway Timeout</h1></body></html>'));
    const attempt = await attemptPlanCheckout(plus);
    expect(attempt.kind).toBe('issue');
    if (attempt.kind !== 'issue') return;
    expect(attempt.message).not.toMatch(/504|HTTP/);
  });

  it('sends the checkout the contract describes for the plan, and says checkout began', async () => {
    const events: string[] = [];
    setAnalyticsObserver((event, params) => events.push(`${event} ${JSON.stringify(params)}`));
    refuseCheckout(409, 'order_create_failed');
    await attemptPlanCheckout(plus);
    const sent = expectSentToMatchContract('POST', '/payments/checkout-sessions');
    expect((sent.body as { productSlug: string }).productSlug).toBe('plan-plus');
    expect(events).toEqual(['begin_checkout {"plan_id":"plan-plus","mode":"subscription"}']);
  });

  it('a purchase confirmed is a purchase; anything else ends quietly', async () => {
    const start = jest.spyOn(legacyPayments, 'startCheckout');
    start.mockResolvedValueOnce('fulfilled');
    await expect(attemptPlanCheckout(plus)).resolves.toEqual({ kind: 'purchased' });
    start.mockResolvedValueOnce('canceled');
    await expect(attemptPlanCheckout(plus)).resolves.toEqual({ kind: 'closed' });
    start.mockResolvedValueOnce('pending');
    await expect(attemptPlanCheckout(plus)).resolves.toEqual({ kind: 'closed' });
    expect(start).toHaveBeenCalledWith('plan-plus');
  });
});

describe('usePlanCheckout', () => {
  let checkout: PlanCheckout;
  const events: PlanCheckoutEvents = { onKennitalaRequired: jest.fn(), onFinished: jest.fn() };

  function Probe() {
    checkout = usePlanCheckout(events);
    return null;
  }

  beforeEach(() => {
    jest.mocked(events.onKennitalaRequired).mockReset();
    jest.mocked(events.onFinished).mockReset();
    dismissAllDialogs();
  });

  it('a second tap before the first attempt has answered is turned away', async () => {
    let finish: (value: legacyPayments.CheckoutOutcome) => void = () => undefined;
    const start = jest
      .spyOn(legacyPayments, 'startCheckout')
      .mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    await render(<Probe />);
    await act(async () => {
      checkout.begin(plus, '');
      checkout.begin(plus, '');
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(checkout.busy).toBe(true);
    await act(async () => finish('canceled'));
    expect(checkout.busy).toBe(false);
  });

  it('hands the SUBMITTED plan and its code back for Kenni', async () => {
    refuseCheckout(403, 'kennitala_verification_required');
    await render(<Probe />);
    await act(async () => checkout.begin(plus, 'PARTNER10'));
    await act(async () => undefined);
    expect(events.onKennitalaRequired).toHaveBeenCalledWith(plus, 'PARTNER10');
  });

  it("welcomes the member, and the welcome's button re-reads the plan and closes Plans", async () => {
    jest.spyOn(legacyPayments, 'startCheckout').mockResolvedValue('fulfilled');
    api.on('GET', '/subscriptions', Reply.ok(null));
    await render(
      <>
        <Probe />
        <DialogHost />
      </>,
    );
    await act(async () => checkout.begin(plus, ''));
    expect(await screen.findByText(en('plans.welcome_title'))).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Your Plus plan is now active. You're ready to explore wellness venues across Iceland.",
      ),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('plans.welcome_cta') }));
    expect(events.onFinished).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.sentAll('/subscriptions', 'GET')).toHaveLength(1));
  });

  it('a pass is welcomed as a pass, by its name in the language on screen', async () => {
    jest.spyOn(legacyPayments, 'startCheckout').mockResolvedValue('fulfilled');
    setCurrentLanguage('is');
    await render(
      <>
        <Probe />
        <DialogHost />
      </>,
    );
    await act(async () => checkout.begin(planForSlug('pass-day-gym')!, ''));
    expect(
      await screen.findByText('Rækt dagspassi er nú virkur. Nú geturðu skoðað vellíðunarstaði um allt Ísland.'),
    ).toBeOnTheScreen();
  });

  it('shows a refusal as the payment alert', async () => {
    refuseCheckout(409, 'subscription_already_exists_for_profile');
    await render(
      <>
        <Probe />
        <DialogHost />
      </>,
    );
    await act(async () => checkout.begin(plus, ''));
    expect(await screen.findByText(en('plans.payment_issue'))).toBeOnTheScreen();
    expect(screen.getByText(en('refusal.has_membership'))).toBeOnTheScreen();
    expect(screen.queryByText(/Server English/)).toBeNull();
    expect(events.onKennitalaRequired).not.toHaveBeenCalled();
  });
});
