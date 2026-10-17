/**
 * The Plans screen (iOS PlansView): the segments and their headings, the
 * cards with the catalogue's prices and tier facts (and without them), the
 * passes the catalogue sells with the empty state, the selection kept across
 * a catalogue load, the terms line, the info sheet, and the eID gate: the
 * note and the Step 1 chip only for a loaded, unverified profile; Continue on
 * a membership parks the plan and opens Kenni, resuming once verified;
 * "See visitor passes"; the server's refusal resuming the SUBMITTED plan.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { api, Reply } from '@test/server';

import { decodeProfile } from '../../../api/profile';
import { stubApiClientPerTest } from '../../../api/testing';
import { bottomSheetMock } from '../../../components/ui/testing/bottomSheetMock';
import { DialogHost, dismissAllDialogs } from '../../../components/ui/Dialog';
import { restoreTestFontScale, setTestFontScale } from '../../../hooks/testing';
import { setCurrentLanguage, translate, type Lang } from '../../../i18n';
import { setAnalyticsObserver } from '../../../lib/analytics';
import type { RootModalProps } from '../../../navigation/types';
import { resetAppStoreForTests, useAppStore } from '../../../stores/appStore';
import { MEMBER_A, profileJSON } from '../../../stores/__tests__/storeHarness';
import * as legacyPayments from '../../../supabase/services/payments';
import { openKenniSheet, type KenniSheetOptions } from '../../kenni';
import { resetPlanCatalog } from '../catalogStore';
import PlansView from '../PlansView';
import { catalogue, CATALOGUE_WITHOUT_POOL, FULL_CATALOGUE, pass } from './fixtures';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('../../kenni', () => ({ openKenniSheet: jest.fn() }));

stubApiClientPerTest();

const openKenni = jest.mocked(openKenniSheet);
const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);

const navigation = { goBack: jest.fn(), isFocused: jest.fn(() => true) };

let startCheckout: jest.SpyInstance<
  ReturnType<typeof legacyPayments.startCheckout>,
  Parameters<typeof legacyPayments.startCheckout>
>;

beforeEach(() => {
  bottomSheetMock.reset();
  setTestFontScale(1);
  resetAppStoreForTests();
  resetPlanCatalog();
  setCurrentLanguage('en');
  dismissAllDialogs();
  openKenni.mockReset();
  navigation.goBack.mockReset();
  startCheckout = jest.spyOn(legacyPayments, 'startCheckout').mockResolvedValue('canceled');
});

afterEach(() => {
  restoreTestFontScale();
  resetAppStoreForTests();
  setCurrentLanguage('en');
  setAnalyticsObserver(null);
  dismissAllDialogs();
  jest.restoreAllMocks();
});

/** The member, signed in; `profile: false` is a profile that has not loaded yet. */
function signIn(options: { verified?: boolean; profile?: boolean; usage?: Record<string, unknown> } = {}) {
  const json = profileJSON({ kennitalaVerified: options.verified ?? false, ...(options.usage ? { usage: options.usage } : {}) });
  useAppStore.setState({
    isAuthenticated: true,
    userId: MEMBER_A,
    profile: options.profile === false ? null : decodeProfile(json),
  });
  api.on('GET', '/profile', Reply.ok(json));
}

const serveCatalogue = (json: object | null) =>
  api.on('GET', '/catalog/plans', json ? Reply.ok(json) : Reply.problem(503, 'internal_error'));

async function renderPlans(params?: RootModalProps<'Plans'>['route']['params']) {
  const props = { navigation, route: { key: 'Plans-1', name: 'Plans', params } } as unknown as RootModalProps<'Plans'>;
  await render(
    <>
      <PlansView {...props} />
      <DialogHost />
    </>,
  );
  // The catalogue read answers.
  await act(async () => undefined);
}

const card = (slug: string) => screen.getByTestId(`plans.card.${slug}`);
const cardIds = () =>
  screen.queryAllByTestId(/^plans\.card\./).map((element) => String(element.props.testID).replace('plans.card.', ''));
const continueButton = () => screen.getByTestId('plans.continue');
// The first text in the pill is its label (the arrow is a glyph after it).
const continueText = () => within(continueButton()).getAllByText(/./)[0].props.children;
const kenniOptions = (): KenniSheetOptions => openKenni.mock.calls.at(-1)![0];

describe('the screen', () => {
  it('opens on the memberships, Plus selected, with no price and the generic line before the catalogue', async () => {
    signIn({ verified: true });
    api.on('GET', '/catalog/plans', Reply.hang());
    await renderPlans();
    expect(screen.getByText(en('plans.title').toUpperCase())).toBeOnTheScreen();
    expect(screen.getByText(en('plans.heading.memberships'))).toBeOnTheScreen();
    expect(screen.getByText(en('plans.intro.memberships'))).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: en('plans.segment.monthly') })).toBeSelected();
    expect(cardIds()).toEqual(['plan-base', 'plan-plus', 'plan-max']);
    expect(card('plan-plus')).toBeSelected();
    expect(card('plan-base')).not.toBeSelected();
    expect(within(card('plan-plus')).getByText(en('plans.most_popular').toUpperCase())).toBeOnTheScreen();
    expect(screen.queryByText(/^ISK /)).toBeNull();
    expect(within(card('plan-plus')).getByText(en('plans.fact.fallback'))).toBeOnTheScreen();
    expect(within(card('plan-plus')).getByText(en('plans.eid.required'))).toBeOnTheScreen();
    expect(screen.getByTestId('plans.terms')).toHaveTextContent(en('plans.fine.sub_terms'));
    expect(continueText()).toBe('Continue with Plus');

    // Leaving Plans abandons the read still out (iOS's `.task` is cancelled).
    await waitFor(() => expect(api.sentAll('/catalog/plans', 'GET')).toHaveLength(1));
    await act(async () => screen.unmount());
    expect(api.sent('/catalog/plans', 'GET').signal.aborted).toBe(true);
  });

  it('shows the catalogue’s prices and the tier’s real visit numbers, and drops "Price shown at checkout"', async () => {
    signIn({ verified: true });
    serveCatalogue(FULL_CATALOGUE);
    await renderPlans();
    expect(within(card('plan-plus')).getByText('ISK 14,900')).toBeOnTheScreen();
    expect(within(card('plan-plus')).getByText(en('plans.per_month'))).toBeOnTheScreen();
    expect(within(card('plan-plus')).getByText('8 gym & studio visits a month')).toBeOnTheScreen();
    expect(within(card('plan-plus')).getByText('6 pool visits a month')).toBeOnTheScreen();
    expect(within(card('plan-plus')).getByText('Up to 2 check-ins a day')).toBeOnTheScreen();
    expect(within(card('plan-base')).getByText('Up to 1 check-in a day')).toBeOnTheScreen();
    expect(screen.getByTestId('plans.terms')).toHaveTextContent(en('plans.fine.sub_terms_priced'));
    expect(screen.queryByText(/3[- ]month/i)).toBeNull();
  });

  it('a card the catalogue does not price shows no price, never ISK 0', async () => {
    signIn({ verified: true });
    serveCatalogue(CATALOGUE_WITHOUT_POOL);
    await renderPlans();
    expect(within(card('plan-base')).queryByText(/ISK/)).toBeNull();
    expect(screen.queryByText('ISK 0')).toBeNull();
    await fireEvent.press(card('plan-base'));
    expect(screen.getByTestId('plans.terms')).toHaveTextContent(en('plans.fine.sub_terms'));
  });

  it('the passes: Adventurer selected, packs first, the pool pass gone, and the day pass terms', async () => {
    signIn({ verified: true });
    serveCatalogue(CATALOGUE_WITHOUT_POOL);
    await renderPlans();
    await fireEvent.press(screen.getByRole('tab', { name: en('plans.segment.passes') }));
    expect(screen.getByText(en('plans.heading.passes'))).toBeOnTheScreen();
    expect(screen.getByText(en('plans.intro.passes'))).toBeOnTheScreen();
    expect(cardIds()).toEqual(['pass-explorer', 'pass-adventurer', 'pass-local', 'pass-day-gym', 'pass-day-studio']);
    expect(card('pass-adventurer')).toBeSelected();
    expect(within(card('pass-adventurer')).getByText('6 visits')).toBeOnTheScreen();
    expect(within(card('pass-adventurer')).queryByText(en('plans.per_month'))).toBeNull();
    expect(within(card('pass-adventurer')).queryByText(en('plans.eid.required'))).toBeNull();
    expect(screen.getByTestId('plans.terms')).toHaveTextContent(en('plans.fine.pass_terms_priced'));
    await fireEvent.press(card('pass-day-gym'));
    expect(screen.getByTestId('plans.terms')).toHaveTextContent(en('plans.fine.day_pass_terms_priced'));
    expect(continueText()).toBe('Continue with Gym Day Pass');
    // Back to the memberships: the popular card again.
    await fireEvent.press(screen.getByRole('tab', { name: en('plans.segment.monthly') }));
    expect(card('plan-plus')).toBeSelected();
  });

  it('without a catalogue the passes are the built-in list minus the pool pass, silently', async () => {
    signIn({ verified: true });
    serveCatalogue(null);
    await renderPlans({ segment: 'passes' });
    expect(cardIds()).toEqual(['pass-explorer', 'pass-adventurer', 'pass-local', 'pass-day-gym', 'pass-day-studio']);
    expect(screen.queryByText(en('plans.payment_issue'))).toBeNull();
    expect(screen.getByTestId('plans.terms')).toHaveTextContent(en('plans.fine.pass_terms'));
  });

  it('a catalogue with no pass on sale says so, with no Continue', async () => {
    signIn({ verified: true });
    serveCatalogue(catalogue({ dayPasses: [], packs: [] }));
    await renderPlans({ segment: 'passes' });
    expect(cardIds()).toEqual([]);
    expect(screen.getByText(en('plans.passes.none'))).toBeOnTheScreen();
    expect(screen.queryByTestId('plans.continue')).toBeNull();
  });

  it('keeps the selected pass when the catalogue arrives and reorders the list', async () => {
    signIn({ verified: true });
    api.on('GET', '/catalog/plans', Reply.delayed(30, Reply.ok(catalogue({ packs: [pass('pass-local', 28_900, 12, 90)] }))));
    await renderPlans({ segment: 'passes' });
    await fireEvent.press(card('pass-day-studio'));
    expect(cardIds()[4]).toBe('pass-day-studio');
    await waitFor(() => expect(cardIds()).toEqual(['pass-local', 'pass-day-gym', 'pass-day-studio']));
    expect(card('pass-day-studio')).toBeSelected();
    expect(continueText()).toBe('Continue with Studio Day Pass');
  });

  it('opens on the card it was asked to', async () => {
    signIn({ verified: true });
    serveCatalogue(CATALOGUE_WITHOUT_POOL);
    await renderPlans({ slug: 'pass-local' });
    expect(screen.getByRole('tab', { name: en('plans.segment.passes') })).toBeSelected();
    expect(card('pass-local')).toBeSelected();
  });

  it('reads Icelandic: the segments, the dative after "Áfram með", and the plural for 21', async () => {
    signIn({ verified: true });
    setCurrentLanguage('is');
    serveCatalogue(catalogue({ tiers: [{ ...FULL_CATALOGUE.tiers[1], dailyCap: 21 }] }));
    await renderPlans();
    const is = (key: string) => translate(key, 'is' as Lang);
    expect(screen.getByRole('tab', { name: is('plans.segment.monthly') })).toBeSelected();
    expect(within(card('plan-plus')).getByText('Allt að 21 innritun á dag')).toBeOnTheScreen();
    expect(continueText()).toBe('Áfram með Plus');
    await fireEvent.press(screen.getByRole('tab', { name: is('plans.segment.passes') }));
    await fireEvent.press(card('pass-day-gym'));
    expect(continueText()).toBe('Áfram með Rækt dagspassa');
    expect(within(card('pass-day-gym')).getByText('Rækt dagspassi')).toBeOnTheScreen();
  });

  it('the back chevron closes Plans', async () => {
    signIn({ verified: true });
    serveCatalogue(null);
    await renderPlans();
    await fireEvent.press(screen.getByRole('button', { name: en('common.back') }));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});

describe('How LifePass works', () => {
  it('opens from the link, with a row per catalogue tier and the member’s own drop-in prices', async () => {
    signIn({
      verified: true,
      usage: {
        tier: 'plus',
        network: null,
        pools: null,
        daily: null,
        concurrent: { open: 0, cap: 3 },
        topup: { available: true, prices: { gym: 2_490, studio: null, pool: 1_290 } },
        passes: [],
        block: { until: null },
        strikes: { active: 0, threshold: 3 },
      },
    });
    serveCatalogue(FULL_CATALOGUE);
    await renderPlans();
    await fireEvent.press(screen.getByText(en('plans.info.link')));
    expect(screen.getByRole('header', { name: en('plans.info.title') })).toBeOnTheScreen();
    for (const key of ['included', 'extra', 'inbundle', 'premium']) {
      expect(screen.getByText(en(`plans.info.${key}.title`))).toBeOnTheScreen();
      expect(screen.getByText(en(`plans.info.${key}.body`))).toBeOnTheScreen();
    }
    expect(screen.getByText(en('plans.info.tier_line', { network: 12, pools: 8, daily: 2 }))).toBeOnTheScreen();
    expect(screen.getByText('Your drop-in prices right now: Gym ISK 2,490 · Pool ISK 1,290')).toBeOnTheScreen();
    expect(screen.getByText(en('plans.info.footer'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('common.close') }));
    await waitFor(() => expect(screen.queryByText(en('plans.info.title'))).toBeNull());
  });

  it('never waits on a read: no tier rows without a catalogue, no prices without a usage block', async () => {
    signIn({ verified: true });
    serveCatalogue(null);
    await renderPlans();
    await fireEvent.press(screen.getByText(en('plans.info.link')));
    expect(screen.getByText(en('plans.info.included.body'))).toBeOnTheScreen();
    expect(screen.queryByText(/gym & studio visits ·/)).toBeNull();
    expect(screen.queryByTestId('plans.info.your_prices')).toBeNull();
  });
});

describe('the eID gate', () => {
  it('an unverified member sees the note above the memberships and the Step 1 chip', async () => {
    signIn({ verified: false });
    serveCatalogue(CATALOGUE_WITHOUT_POOL);
    await renderPlans();
    expect(screen.getByText(en('plans.eid.no_id_hint'))).toBeOnTheScreen();
    expect(within(screen.getByTestId('plans.kenni_step')).getByText(en('plans.kenni_step'))).toBeOnTheScreen();
    // Passes need no eID: no note there, and no chip on a pass.
    await fireEvent.press(screen.getByRole('tab', { name: en('plans.segment.passes') }));
    expect(screen.queryByText(en('plans.eid.no_id_hint'))).toBeNull();
    expect(screen.queryByTestId('plans.kenni_step')).toBeNull();
  });

  it('a verified member never sees them, nor anyone before the profile has loaded', async () => {
    signIn({ verified: true });
    serveCatalogue(null);
    await renderPlans();
    expect(screen.queryByTestId('plans.eid.hint')).toBeNull();
    expect(screen.queryByTestId('plans.kenni_step')).toBeNull();

    await act(async () => signIn({ profile: false }));
    await renderPlans();
    expect(screen.queryByTestId('plans.eid.hint')).toBeNull();
    expect(screen.queryByTestId('plans.kenni_step')).toBeNull();
  });

  it('"See visitor passes" in the note switches to the passes', async () => {
    signIn({ verified: false });
    serveCatalogue(CATALOGUE_WITHOUT_POOL);
    await renderPlans();
    await fireEvent.press(screen.getByRole('button', { name: en('plans.eid.see_passes') }));
    expect(screen.getByRole('tab', { name: en('plans.segment.passes') })).toBeSelected();
    expect(card('pass-adventurer')).toBeSelected();
  });

  it('a verified member’s Continue on a membership goes straight to the checkout', async () => {
    signIn({ verified: true });
    serveCatalogue(CATALOGUE_WITHOUT_POOL);
    const events: string[] = [];
    setAnalyticsObserver((event, params) => events.push(`${event} ${params.plan_id}`));
    await renderPlans();
    await fireEvent.press(continueButton());
    expect(openKenni).not.toHaveBeenCalled();
    expect(startCheckout).toHaveBeenCalledWith('plan-plus');
    expect(events).toContain('plan_selected plan-plus');
  });

  it('a pass needs no eID: Continue checks out at once for an unverified member', async () => {
    signIn({ verified: false });
    serveCatalogue(CATALOGUE_WITHOUT_POOL);
    await renderPlans({ segment: 'passes' });
    await fireEvent.press(continueButton());
    expect(openKenni).not.toHaveBeenCalled();
    expect(startCheckout).toHaveBeenCalledWith('pass-adventurer');
  });

  it('Continue on a membership while unverified parks it, opens Kenni, and resumes once verified', async () => {
    signIn({ verified: false });
    serveCatalogue(CATALOGUE_WITHOUT_POOL);
    await renderPlans();
    await fireEvent.press(continueButton());
    expect(openKenni).toHaveBeenCalledTimes(1);
    expect(kenniOptions().bodyKey).toBe('kenni.body');
    expect(startCheckout).not.toHaveBeenCalled();

    // Kenni verified the member and re-read the profile before closing.
    await act(async () => signIn({ verified: true }));
    await act(async () => kenniOptions().onClose());
    expect(startCheckout).toHaveBeenCalledWith('plan-plus');
    expect(startCheckout).toHaveBeenCalledTimes(1);
  });

  it('the Step 1 chip parks the selected membership the same way', async () => {
    signIn({ verified: false });
    serveCatalogue(CATALOGUE_WITHOUT_POOL);
    await renderPlans();
    await fireEvent.press(card('plan-max'));
    await fireEvent.press(screen.getByTestId('plans.kenni_step'));
    await act(async () => signIn({ verified: true }));
    await act(async () => kenniOptions().onClose());
    expect(startCheckout).toHaveBeenCalledWith('plan-max');
  });

  it('closing Kenni unverified never resumes, after one more read of the profile to be sure', async () => {
    signIn({ verified: false });
    serveCatalogue(CATALOGUE_WITHOUT_POOL);
    await renderPlans();
    await fireEvent.press(continueButton());
    const reads = api.sentAll('/profile', 'GET').length;
    await act(async () => kenniOptions().onClose());
    expect(api.sentAll('/profile', 'GET').length).toBe(reads + 1);
    expect(startCheckout).not.toHaveBeenCalled();
  });

  it('resumes when the verified profile lands only after the sheet has closed', async () => {
    signIn({ verified: false });
    serveCatalogue(CATALOGUE_WITHOUT_POOL);
    await renderPlans();
    await fireEvent.press(continueButton());
    api.on('GET', '/profile', Reply.ok(profileJSON({ kennitalaVerified: true })));
    await act(async () => kenniOptions().onClose());
    await waitFor(() => expect(startCheckout).toHaveBeenCalledWith('plan-plus'));
  });

  it('"See visitor passes" in the Kenni sheet forgets the parked plan and shows the passes', async () => {
    signIn({ verified: false });
    serveCatalogue(CATALOGUE_WITHOUT_POOL);
    await renderPlans();
    await fireEvent.press(continueButton());
    expect(kenniOptions().onSeePasses).toBeDefined();
    await act(async () => kenniOptions().onSeePasses?.());
    expect(screen.getByRole('tab', { name: en('plans.segment.passes') })).toBeSelected();
    await act(async () => signIn({ verified: true }));
    await act(async () => kenniOptions().onClose());
    expect(startCheckout).not.toHaveBeenCalled();
  });

  it('the server’s refusal opens Kenni with the SUBMITTED plan, not a selection that moved since', async () => {
    // The local flag says verified, the server disagrees (it can be stale).
    signIn({ verified: true });
    serveCatalogue(CATALOGUE_WITHOUT_POOL);
    let refuse: (error: unknown) => void = () => undefined;
    startCheckout.mockImplementationOnce(() => new Promise((_resolve, reject) => (refuse = reject)));
    await renderPlans();
    await fireEvent.press(continueButton());
    expect(continueButton()).toBeDisabled();
    // The member moves the selection while the checkout is being created.
    await fireEvent.press(card('plan-base'));
    const { ProblemError } = jest.requireActual('../../../api');
    await act(async () =>
      refuse(new ProblemError({ type: 'https://lifepass.is/problems/kennitala_verification_required', title: 'x', status: 403 }, 403)),
    );
    expect(openKenni).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(en('plans.payment_issue'))).toBeNull();
    await act(async () => kenniOptions().onClose());
    expect(startCheckout).toHaveBeenLastCalledWith('plan-plus');
  });

  it('a pass off sale at checkout is the payment alert, and its card goes', async () => {
    signIn({ verified: true });
    serveCatalogue(catalogue({ dayPasses: [pass('pass-day-pool', 1_490), pass('pass-day-gym', 2_990)] }));
    await renderPlans({ segment: 'passes' });
    await fireEvent.press(card('pass-day-pool'));
    expect(card('pass-day-pool')).toBeSelected();
    startCheckout.mockRestore();
    api.on('POST', '/payments/checkout-sessions', Reply.problem(404, 'product_not_on_sale'));
    serveCatalogue(CATALOGUE_WITHOUT_POOL);
    await fireEvent.press(continueButton());
    expect(await screen.findByText(en('plans.payment_issue'))).toBeOnTheScreen();
    expect(screen.getByText(en('plans.err.not_on_sale'))).toBeOnTheScreen();
    await waitFor(() => expect(cardIds()).not.toContain('pass-day-pool'));
    expect(card('pass-adventurer')).toBeSelected();
  });

  it('a confirmed purchase is welcomed, and its button closes Plans', async () => {
    signIn({ verified: true });
    serveCatalogue(CATALOGUE_WITHOUT_POOL);
    api.on('GET', '/subscriptions', Reply.ok(null));
    startCheckout.mockResolvedValue('fulfilled');
    await renderPlans();
    await fireEvent.press(continueButton());
    expect(await screen.findByText(en('plans.welcome_title'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('plans.welcome_cta') }));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
