/**
 * "Get offers by email" on Home, the whole screen over the stub server (the
 * website dashboard's card, owner 29 Oct 2026 "Card in the apps"; iOS
 * HomeOffersCard): offered only when the profile's `offersCard` says so and
 * never to a member opted in, dismissed, signed out or on the way out; one
 * tap opts in as the apps' card and the done line shows for the rest of the
 * visit; a failure says so and a tap tries again; No thanks closes it at once
 * and stays said, on the phone and on the account; the words are the website
 * card's, in both languages.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import { AccessibilityInfo } from 'react-native';

import { stubApiClientPerTest } from '../../../../api/testing';
import { lookup } from '../../../../i18n';
import { useAppStore } from '../../../../stores/appStore';
import { freshHome, homeNavigation, leaveHome, MEMBER, profileJSON, renderHome, settle } from '../../__tests__/homeHarness';
import { REYKJAVIK, testVenue, venuePage } from '../../__tests__/homeVenues';
import { MARKETING_CONSENT_PATH, OFFERS_CARD_DISMISS_PATH } from '../api';
import { offersCardDismissedKey } from '../storage';

// expo-font (behind @expo/vector-icons) imports expo-asset, which npm left
// nested under expo/ (as the UI kit's tests do).
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

// A whole screen per test, over the stub network.
jest.setTimeout(30_000);

const OFFERED = { show: true, dismissed: false };

/** The website dashboard card's words (offers-opt-in-copy.ts on lifepass-monorepo main). */
const WEBSITE = {
  en: {
    title: 'Get offers by email',
    body: 'New venues and classes, ideas for your week and member offers. You can unsubscribe any time.',
    optIn: 'Email me offers',
    dismiss: 'No thanks',
    doneTitle: "You'll get offers by email",
    doneBody: 'Every email has an unsubscribe link, and you can also turn marketing emails off in your profile.',
    failed: 'Could not save that. Please try again.',
  },
  is: {
    title: 'Fáðu tilboð í tölvupósti',
    body: 'Nýir staðir og hóptímar, hugmyndir fyrir vikuna og tilboð fyrir meðlimi. Þú getur afskráð þig hvenær sem er.',
    optIn: 'Sendið mér tilboð',
    dismiss: 'Nei takk',
    doneTitle: 'Þú færð tilboð í tölvupósti',
    doneBody: 'Í hverjum pósti er hlekkur til að afskrá sig, og þú getur líka slökkt á markaðspósti í stillingunum þínum.',
    failed: 'Ekki tókst að vista. Reyndu aftur.',
  },
} as const;

function serve(profile: Record<string, unknown>) {
  api.on('GET', '/venues', Reply.ok(venuePage([testVenue(1, 'Sundhöllin', { reviews: 3 })])));
  api.on('GET', '/bookings', Reply.ok({ data: [], pagination: { nextCursor: null, hasMore: false, limit: 100 } }));
  api.on('GET', '/profile', Reply.ok(profileJSON(profile)));
}

/** Home with the card offered (or with the profile given). */
async function homeWith(profile: Record<string, unknown> = { offersCard: OFFERED }) {
  freshHome({ fix: REYKJAVIK });
  serve(profile);
  await renderHome();
}

async function press(testID: string) {
  await fireEvent.press(screen.getByTestId(testID));
  await settle();
}

/** Another tab, then Home again: a new Home visit. */
async function newVisit() {
  await act(async () => homeNavigation.navigate('Explore'));
  await settle();
  await act(async () => homeNavigation.navigate('Home'));
  await settle();
}

const profileReads = () => api.sentAll('/profile', 'GET').length;

afterEach(() => {
  leaveHome();
});

describe('who sees the card', () => {
  it('a member the profile offers it to: first among the cards, in the website card’s words', async () => {
    await homeWith();
    const card = screen.getByTestId('home.offers');
    expect(within(card).getByRole('header', { name: WEBSITE.en.title })).toBeOnTheScreen();
    expect(within(card).getByText(WEBSITE.en.body)).toBeOnTheScreen();
    expect(within(card).getByRole('button', { name: WEBSITE.en.optIn })).toBeOnTheScreen();
    expect(within(card).getByRole('button', { name: WEBSITE.en.dismiss })).toBeOnTheScreen();
    expect(within(card).queryByTestId('home.offers.failed')).toBeNull();

    // Above the referral card, which is always there.
    const list = card.parent!;
    const order = list.children.map((child) => (typeof child === 'string' ? child : child.props.testID));
    expect(order.indexOf('home.offers')).toBeLessThan(order.indexOf('home.referral'));
    // Nothing is sent until the member taps.
    expect(api.sentAll(MARKETING_CONSENT_PATH)).toHaveLength(0);
    expect(api.sentAll(OFFERS_CARD_DISMISS_PATH)).toHaveLength(0);
  });

  it.each([
    ['a server older than 0.51.0 (no block)', {}],
    ['a block the server could not read this time', { offersCard: null }],
    ['a block that does not read', { offersCard: { show: 'yes' } }],
    ['the server says not to (opted in elsewhere, on the way out, a no of their own)', { offersCard: { show: false, dismissed: false } }],
    ['No thanks on the account (the website or another phone)', { offersCard: { show: false, dismissed: true } }],
    ['No thanks on the account, whatever show says', { offersCard: { show: true, dismissed: true } }],
    ['opted in, whatever show says', { marketingConsent: true, offersCard: OFFERED }],
  ])('never: %s', async (_name, profile) => {
    await homeWith(profile);
    expect(screen.queryByTestId('home.offers')).toBeNull();
    expect(screen.queryByTestId('home.offers.done')).toBeNull();
    expect(screen.getByTestId('home.referral')).toBeOnTheScreen();
  });

  it('never while signed out', async () => {
    await homeWith();
    expect(screen.getByTestId('home.offers')).toBeOnTheScreen();
    await act(async () => useAppStore.setState({ isAuthenticated: false }));
    expect(screen.queryByTestId('home.offers')).toBeNull();
  });

  it('an Icelandic account reads it in Icelandic', async () => {
    await homeWith({ locale: 'is', offersCard: OFFERED });
    const card = screen.getByTestId('home.offers');
    expect(within(card).getByRole('header', { name: WEBSITE.is.title })).toBeOnTheScreen();
    expect(within(card).getByText(WEBSITE.is.body)).toBeOnTheScreen();
    expect(within(card).getByRole('button', { name: WEBSITE.is.optIn })).toBeOnTheScreen();
    expect(within(card).getByRole('button', { name: WEBSITE.is.dismiss })).toBeOnTheScreen();
  });
});

describe('Email me offers', () => {
  it('one tap opts in as the apps card, then the done line, gone at the next visit', async () => {
    await homeWith();
    const readsBefore = profileReads();
    api.on('POST', MARKETING_CONSENT_PATH, Reply.ok({ optedIn: true }));
    await press('home.offers.optIn');

    expect(api.sentAll(MARKETING_CONSENT_PATH)).toHaveLength(1);
    expect(api.sent(MARKETING_CONSENT_PATH, 'POST').body).toEqual({ optedIn: true, source: 'app_card' });
    const done = screen.getByTestId('home.offers.done');
    expect(within(done).getByRole('header', { name: WEBSITE.en.doneTitle })).toBeOnTheScreen();
    expect(within(done).getByText(lookup('offers.card.done_body', 'en'))).toBeOnTheScreen();
    expect(screen.queryByTestId('home.offers')).toBeNull();
    // The app's own copy of the profile is read again.
    expect(profileReads()).toBe(readsBefore + 1);

    // A page pushed on Home and back is the same visit: the done line stays,
    // even with a profile read that still offers the card.
    await press('home.referral');
    await act(async () => homeNavigation.goBack());
    await settle();
    expect(screen.getByTestId('home.offers.done')).toBeOnTheScreen();

    // The next visit: gone, though this stub profile still offers it.
    await newVisit();
    expect(screen.queryByTestId('home.offers.done')).toBeNull();
    expect(screen.queryByTestId('home.offers')).toBeNull();
    expect(api.sentAll(MARKETING_CONSENT_PATH)).toHaveLength(1);
  });

  it('TalkBack goes on from the done line', async () => {
    const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent');
    await homeWith();
    api.on('POST', MARKETING_CONSENT_PATH, Reply.ok({ optedIn: true }));
    await press('home.offers.optIn');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(focus).toHaveBeenCalledWith(expect.anything(), 'focus');
    focus.mockRestore();
  });

  it('waits while a tap is on its way: one request, whatever the taps', async () => {
    await homeWith();
    let answer: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    api.on('POST', MARKETING_CONSENT_PATH, async () => {
      await answered;
      return Reply.ok({ optedIn: true });
    });
    await press('home.offers.optIn');
    const button = screen.getByTestId('home.offers.optIn');
    expect(button).toBeBusy();
    expect(button).toBeDisabled();
    expect(screen.getByTestId('home.offers.dismiss')).toBeDisabled();
    await press('home.offers.optIn');
    await press('home.offers.dismiss');
    expect(screen.getByTestId('home.offers')).toBeOnTheScreen();

    await act(async () => answer());
    await settle();
    expect(api.sentAll(MARKETING_CONSENT_PATH)).toHaveLength(1);
    expect(api.sentAll(OFFERS_CARD_DISMISS_PATH)).toHaveLength(0);
    expect(screen.getByTestId('home.offers.done')).toBeOnTheScreen();
  });

  it('a failure keeps the card and says so; a tap tries again', async () => {
    await homeWith();
    api.on('POST', MARKETING_CONSENT_PATH, Reply.problem(500, 'internal_error'));
    await press('home.offers.optIn');
    expect(screen.getByTestId('home.offers.failed')).toHaveTextContent(WEBSITE.en.failed);
    expect(screen.getByTestId('home.offers.optIn')).not.toBeBusy();
    expect(screen.getByTestId('home.offers.optIn')).toBeEnabled();

    api.on('POST', MARKETING_CONSENT_PATH, Reply.ok({ optedIn: true }));
    await press('home.offers.optIn');
    expect(screen.queryByTestId('home.offers.failed')).toBeNull();
    expect(screen.getByTestId('home.offers.done')).toBeOnTheScreen();
    expect(api.sentAll(MARKETING_CONSENT_PATH)).toHaveLength(2);
    // Each tap is its own action, with its own key.
    const keys = api.sentAll(MARKETING_CONSENT_PATH).map((request) => request.headers['idempotency-key']);
    expect(new Set(keys).size).toBe(2);
  });

  it('a failure line belongs to its visit: the next visit offers the card afresh', async () => {
    await homeWith();
    api.on('POST', MARKETING_CONSENT_PATH, Reply.fail());
    await press('home.offers.optIn');
    expect(screen.getByTestId('home.offers.failed')).toBeOnTheScreen();
    await newVisit();
    expect(screen.getByTestId('home.offers')).toBeOnTheScreen();
    expect(screen.queryByTestId('home.offers.failed')).toBeNull();
  });

  it.each(['account_pending_deletion', 'account_deletion_scheduled'])(
    '409 %s (a deletion asked for elsewhere): the card closes without a word',
    async (slug) => {
      await homeWith();
      api.on('POST', MARKETING_CONSENT_PATH, Reply.problem(409, slug));
      await press('home.offers.optIn');
      expect(screen.queryByTestId('home.offers')).toBeNull();
      expect(screen.queryByTestId('home.offers.done')).toBeNull();
      expect(screen.queryByText(WEBSITE.en.failed)).toBeNull();
    },
  );

  it('an answer that comes after the member left Home is shown when they come back, for that visit', async () => {
    await homeWith();
    let answer: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    api.on('POST', MARKETING_CONSENT_PATH, async () => {
      await answered;
      return Reply.ok({ optedIn: true });
    });
    await press('home.offers.optIn');
    await act(async () => homeNavigation.navigate('Explore'));
    await settle();
    await act(async () => answer());
    await settle();
    await act(async () => homeNavigation.navigate('Home'));
    await settle();
    expect(screen.getByTestId('home.offers.done')).toBeOnTheScreen();
    await newVisit();
    expect(screen.queryByTestId('home.offers.done')).toBeNull();
    expect(screen.queryByTestId('home.offers')).toBeNull();
  });
});

describe('No thanks', () => {
  it('closes the card at once, and keeps it said on this phone and on the account', async () => {
    await homeWith();
    api.on('POST', OFFERS_CARD_DISMISS_PATH, Reply.ok({ dismissed: true }));
    await press('home.offers.dismiss');

    expect(screen.queryByTestId('home.offers')).toBeNull();
    expect(screen.queryByTestId('home.offers.done')).toBeNull();
    expect(api.sentAll(OFFERS_CARD_DISMISS_PATH)).toHaveLength(1);
    expect(api.sent(OFFERS_CARD_DISMISS_PATH, 'POST').rawBody).toBeNull();
    expect(api.sentAll(MARKETING_CONSENT_PATH)).toHaveLength(0);
    expect(await AsyncStorage.getItem(offersCardDismissedKey(MEMBER))).toBe('true');

    // A profile read that still offers it (the account did not keep it in
    // time) brings nothing back, and nothing more is sent.
    await newVisit();
    expect(screen.queryByTestId('home.offers')).toBeNull();
    expect(api.sentAll(OFFERS_CARD_DISMISS_PATH)).toHaveLength(1);
  });

  it('closes the card even when the account could not keep it', async () => {
    await homeWith();
    api.on('POST', OFFERS_CARD_DISMISS_PATH, Reply.problem(502, 'offers_card_dismiss_failed'));
    await press('home.offers.dismiss');
    expect(screen.queryByTestId('home.offers')).toBeNull();
    expect(screen.queryByText(WEBSITE.en.failed)).toBeNull();
    expect(await AsyncStorage.getItem(offersCardDismissedKey(MEMBER))).toBe('true');
  });

  it('said on this phone before: no card, and the account is told once a session while it still offers it', async () => {
    await AsyncStorage.setItem(offersCardDismissedKey(MEMBER), 'true');
    api.on('POST', OFFERS_CARD_DISMISS_PATH, Reply.ok({ dismissed: true }));
    await homeWith();
    expect(screen.queryByTestId('home.offers')).toBeNull();
    expect(api.sentAll(OFFERS_CARD_DISMISS_PATH)).toHaveLength(1);
    await newVisit();
    expect(screen.queryByTestId('home.offers')).toBeNull();
    expect(api.sentAll(OFFERS_CARD_DISMISS_PATH)).toHaveLength(1);
  });

  it('said on this phone by another member: this one still sees the card', async () => {
    await AsyncStorage.setItem(offersCardDismissedKey('3f1a7c5e-9b2d-4e8f-a6c4-1d3b5f7a9c2e'), 'true');
    await homeWith();
    expect(screen.getByTestId('home.offers')).toBeOnTheScreen();
    expect(api.sentAll(OFFERS_CARD_DISMISS_PATH)).toHaveLength(0);
  });

  it('the account already has it: nothing is sent again', async () => {
    await AsyncStorage.setItem(offersCardDismissedKey(MEMBER), 'true');
    await homeWith({ offersCard: { show: false, dismissed: true } });
    expect(api.sentAll(OFFERS_CARD_DISMISS_PATH)).toHaveLength(0);
  });
});

describe('the words', () => {
  it('title, body and button are the website card’s exactly: the consent is recorded as given to them', () => {
    for (const lang of ['en', 'is'] as const) {
      expect([lang, lookup('offers.card.title', lang)]).toEqual([lang, WEBSITE[lang].title]);
      expect([lang, lookup('offers.card.body', lang)]).toEqual([lang, WEBSITE[lang].body]);
      expect([lang, lookup('offers.card.opt_in', lang)]).toEqual([lang, WEBSITE[lang].optIn]);
    }
  });

  it('No thanks, the done title and the failure line are the website card’s too', () => {
    for (const lang of ['en', 'is'] as const) {
      expect([lang, lookup('offers.card.dismiss', lang)]).toEqual([lang, WEBSITE[lang].dismiss]);
      expect([lang, lookup('offers.card.done_title', lang)]).toEqual([lang, WEBSITE[lang].doneTitle]);
      expect([lang, lookup('offers.card.failed', lang)]).toEqual([lang, WEBSITE[lang].failed]);
    }
  });

  it('the done body is the website’s, saying where the switch is: the apps have none', () => {
    expect(lookup('offers.card.done_body', 'en')).toBe(WEBSITE.en.doneBody.replace(/\.$/, ' on lifepass.is.'));
    expect(lookup('offers.card.done_body', 'is')).toBe(WEBSITE.is.doneBody.replace(/\.$/, ' á lifepass.is.'));
  });

  it('say "unsubscribe any time" in both languages, with no dash standing in for punctuation', () => {
    expect(lookup('offers.card.body', 'en')).toContain('You can unsubscribe any time.');
    expect(lookup('offers.card.body', 'is')).toContain('Þú getur afskráð þig hvenær sem er.');
    for (const key of ['title', 'body', 'opt_in', 'dismiss', 'done_title', 'done_body', 'failed']) {
      for (const lang of ['en', 'is'] as const) expect(lookup(`offers.card.${key}`, lang)).not.toMatch(/[–—]| - /);
    }
  });
});
