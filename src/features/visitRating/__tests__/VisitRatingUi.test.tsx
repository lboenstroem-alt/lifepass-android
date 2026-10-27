/**
 * "How was your visit?" on screen, against the stub server: the Home card
 * (its words, five stars that open the sheet, "Not now"), the sheet (its
 * rows in order, Send held until Overall, the comment and its counter or the
 * replace note, the public note, the stars as TalkBack adjustables, full
 * height at the largest text), the thank-you (the review offer, Done and the
 * Google Play ask), the refusals, and the notification tap.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { storeReviewState } from '@test/mocks/expoStoreReview';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { decodeProfile } from '../../../api/profile';
import { ToastHost } from '../../../components/ui';
import { bottomSheetMock } from '../../../components/ui/testing/bottomSheetMock';
import { restoreTestFontScale, setTestFontScale } from '../../../hooks/testing';
import { setCurrentLanguage } from '../../../i18n';
import * as navigation from '../../../navigation/navigationRef';
import { resetAppStoreForTests, useAppStore } from '../../../stores/appStore';
import {
  attachRecoveryProgressHost,
  endRecoveryProgress,
  resetRecoveryProgress,
  startRecoveryProgress,
} from '../../../payments/recoveryProgress';
import { resetIntentStoreForTests, useIntentStore } from '../../../stores/intentStore';
import { setStoreReviewDepsForTests } from '../../storeReview';
import VisitRatingCard from '../VisitRatingCard';
import VisitRatingSheetHost from '../VisitRatingSheet';
import { visitRatingStore } from '../store';

import { PROMPT_ID, promptJSON } from './fixtures';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const CURRENT = '/visit-rating-prompts/current';
const ANSWER = `/visit-rating-prompts/${PROMPT_ID}/answer`;
const DISMISS = `/visit-rating-prompts/${PROMPT_ID}/dismiss`;

function answerJSON(extra: Record<string, unknown> = {}) {
  return {
    prompt: promptJSON({ answeredAt: '2026-10-27T14:00:00.000Z' }),
    rating: { reviewId: '9c8a3f7c-0000-4000-8000-000000000001', kind: 'quick', rating: 5, equipmentRating: null, cleanlinessRating: null, visitDate: '2026-10-27' },
    happyMoment: true,
    hasWrittenReview: false,
    ...extra,
  };
}

function signIn(createdDaysAgo = 30) {
  useAppStore.setState({
    isAuthenticated: true,
    isLoading: false,
    userId: MEMBER,
    profile: decodeProfile({
      id: MEMBER,
      kennitalaVerified: false,
      marketingConsent: false,
      createdAt: new Date(Date.now() - createdDaysAgo * 24 * 60 * 60 * 1000).toISOString(),
    }),
  });
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 6; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
  }
}

/** Home's card and the shell's sheet, as the app mounts them. */
async function renderApp() {
  await render(
    <>
      <VisitRatingCard />
      <VisitRatingSheetHost />
      <ToastHost />
    </>,
  );
  await settle();
}

/** The app came to the foreground with the member's profile read. */
async function activate() {
  await act(async () => {
    visitRatingStore.getState().noteForeground();
  });
  await settle();
}

const sendButton = () => screen.getByTestId('visitRating.send');

/** "Confirming your payment…" up: a payment flow on screen (src/app/flowsOnScreen.ts). */
let detachProgressHost: () => void = () => undefined;
function paymentOnScreen(on: boolean): void {
  if (on) startRecoveryProgress({ attemptId: 'attempt-1', rail: 'walk_in' });
  else endRecoveryProgress('attempt-1');
}

/** A star (decoration to TalkBack, which reads the row as one control). */
const star = (row: string, stars: number) =>
  screen.getByTestId(`visitRating.stars.${row}.${stars}`, { includeHiddenElements: true });

type Json = { children?: (Json | string)[] | null } | string | null;

/** Every word on screen, in the order it is drawn (the icons' glyphs left out). */
function textsOnScreen(): string[] {
  const out: string[] = [];
  const walk = (node: Json | Json[]) => {
    if (node === null) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node === 'string') return void out.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(screen.toJSON() as Json | Json[]);
  return out.filter((text) => /[\p{L}\p{N}]/u.test(text));
}

beforeEach(() => {
  bottomSheetMock.reset();
  setTestFontScale(1);
  resetAppStoreForTests();
  resetIntentStoreForTests();
  visitRatingStore.getState().reset();
  resetRecoveryProgress();
  detachProgressHost = attachRecoveryProgressHost();
  setStoreReviewDepsForTests(null);
  setCurrentLanguage('en');
  signIn();
});

afterEach(() => {
  restoreTestFontScale();
  visitRatingStore.getState().reset();
  resetRecoveryProgress();
  detachProgressHost();
});

describe('the Home card', () => {
  it('shows the ask the server says is due: title, venue, line, five stars, Not now', async () => {
    api.on('GET', CURRENT, Reply.ok({ prompt: promptJSON() }));
    await renderApp();
    expect(screen.queryByTestId('visitRating.card')).toBeNull(); // not before the profile read
    await activate();
    expect(api.sentAll(CURRENT, 'GET')).toHaveLength(1);
    expect(screen.getByText('How was your visit?')).toBeOnTheScreen();
    expect(screen.getByTestId('visitRating.card.venue')).toHaveTextContent('World Class Laugar');
    expect(screen.getByText('Tap the stars to rate it')).toBeOnTheScreen();
    expect(screen.getByText('Not now')).toBeOnTheScreen();
    for (const star of [1, 2, 3, 4, 5]) {
      expect(screen.getByRole('button', { name: `${star} out of 5 stars` })).toBeOnTheScreen();
    }
  });

  it('nothing at all while there is no ask, or when the server cannot be asked', async () => {
    api.on('GET', CURRENT, Reply.ok({ prompt: null }));
    await renderApp();
    await activate();
    expect(screen.queryByTestId('visitRating.card')).toBeNull();
    api.on('GET', CURRENT, Reply.problem(404, 'not_found'));
    await activate();
    expect(screen.queryByTestId('visitRating.card')).toBeNull();
  });

  it('waits while a payment is being confirmed, and asks once it is over', async () => {
    api.on('GET', CURRENT, Reply.ok({ prompt: promptJSON() }));
    paymentOnScreen(true);
    await renderApp();
    await activate();
    expect(api.sentAll(CURRENT, 'GET')).toHaveLength(0);
    await act(async () => paymentOnScreen(false));
    await settle();
    expect(api.sentAll(CURRENT, 'GET')).toHaveLength(1);
    expect(screen.getByTestId('visitRating.card')).toBeOnTheScreen();
  });

  it('a star opens the sheet with that overall chosen', async () => {
    api.on('GET', CURRENT, Reply.ok({ prompt: promptJSON() }));
    await renderApp();
    await activate();
    await fireEvent.press(screen.getByRole('button', { name: '4 out of 5 stars' }));
    expect(screen.getByTestId('visitRating.sheet')).toBeOnTheScreen();
    expect(screen.getByTestId('visitRating.stars.overall').props.accessibilityValue).toMatchObject({
      now: 4,
      text: '4 out of 5 stars',
    });
  });

  it('Not now dismisses the ask on the server and the card goes', async () => {
    api.on('GET', CURRENT, Reply.ok({ prompt: promptJSON() }));
    api.on('POST', DISMISS, Reply.ok({ prompt: promptJSON({ dismissedAt: '2026-10-27T14:00:00.000Z' }) }));
    await renderApp();
    await activate();
    await fireEvent.press(screen.getByTestId('visitRating.card.dismiss'));
    await settle();
    expect(screen.queryByTestId('visitRating.card')).toBeNull();
    expect(api.sentAll(DISMISS, 'POST')).toHaveLength(1);
  });

  it('in Icelandic', async () => {
    setCurrentLanguage('is');
    api.on('GET', CURRENT, Reply.ok({ prompt: promptJSON({ venueName: 'Hress' }) }));
    await renderApp();
    await activate();
    expect(screen.getByText('Hvernig var heimsóknin?')).toBeOnTheScreen();
    expect(screen.getByText('Hress')).toBeOnTheScreen();
    expect(screen.getByText('Gefðu einkunn með stjörnunum')).toBeOnTheScreen();
    expect(screen.getByText('Ekki núna')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '3 af 5 stjörnum' })).toBeOnTheScreen();
  });
});

describe('the sheet', () => {
  async function openSheet(json: Record<string, unknown> = promptJSON(), stars = 0) {
    api.on('GET', CURRENT, Reply.ok({ prompt: json }));
    await renderApp();
    await activate();
    await act(async () => {
      if (stars > 0) visitRatingStore.getState().openFromCard(stars);
      else await visitRatingStore.getState().openFromNotification();
    });
    await settle();
  }

  it('in order: title and venue, Overall, the two optional rows, the comment, the public note; Send waits for Overall', async () => {
    await openSheet();
    // The card (Home, under the sheet) is drawn first; the sheet's words follow it.
    const texts = textsOnScreen();
    const sheetStart = texts.lastIndexOf('How was your visit?');
    expect(texts.slice(sheetStart)).toEqual([
      'How was your visit?',
      'World Class Laugar',
      'Overall',
      'Equipment',
      'Optional',
      'Cleanliness',
      'Optional',
      'Comment (optional)',
      '0/500',
      "Your rating is public. If you add a comment, it's shown with your first initial and the date of your visit.",
      'Send',
      'Not now',
    ]);
    expect(screen.getByPlaceholderText('What stood out?')).toBeOnTheScreen();
    expect(sendButton()).toBeDisabled();
    expect(screen.getByTestId('visitRating.notNow')).toHaveTextContent('Not now');

    await fireEvent.press(star('overall', 3));
    expect(sendButton()).not.toBeDisabled();
  });

  it('the stars are adjustable to TalkBack: "Overall, 4 out of 5 stars"; the optional rows say so', async () => {
    await openSheet(promptJSON(), 4);
    const overall = screen.getByTestId('visitRating.stars.overall');
    expect(overall.props.accessibilityRole).toBe('adjustable');
    expect(overall.props.accessibilityLabel).toBe('Overall');
    expect(overall.props.accessibilityValue.text).toBe('4 out of 5 stars');
    await fireEvent(overall, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(screen.getByTestId('visitRating.stars.overall').props.accessibilityValue.text).toBe('5 out of 5 stars');
    for (let i = 0; i < 6; i += 1) {
      await fireEvent(screen.getByTestId('visitRating.stars.overall'), 'accessibilityAction', {
        nativeEvent: { actionName: 'decrement' },
      });
    }
    // The overall never goes below one once chosen.
    expect(screen.getByTestId('visitRating.stars.overall').props.accessibilityValue.now).toBe(1);

    const equipment = screen.getByTestId('visitRating.stars.equipment');
    expect(equipment.props.accessibilityLabel).toBe('Equipment, Optional');
    expect(equipment.props.accessibilityValue.text).toBe('0 out of 5 stars');
    await fireEvent(equipment, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    await fireEvent(screen.getByTestId('visitRating.stars.equipment'), 'accessibilityAction', {
      nativeEvent: { actionName: 'decrement' },
    });
    expect(screen.getByTestId('visitRating.stars.equipment').props.accessibilityValue.now).toBe(0);
    expect(screen.getByTestId('visitRating.stars.cleanliness').props.accessibilityLabel).toBe('Cleanliness, Optional');
  });

  it('an optional row is taken back with a second tap on its star', async () => {
    await openSheet(promptJSON(), 5);
    await fireEvent.press(star('cleanliness', 4));
    expect(screen.getByTestId('visitRating.stars.cleanliness').props.accessibilityValue.now).toBe(4);
    await fireEvent.press(star('cleanliness', 4));
    expect(screen.getByTestId('visitRating.stars.cleanliness').props.accessibilityValue.now).toBe(0);
  });

  it('the comment counts to 500 and stops there', async () => {
    await openSheet(promptJSON(), 5);
    await fireEvent.changeText(screen.getByTestId('visitRating.comment'), 'Spotless showers');
    expect(screen.getByTestId('visitRating.counter')).toHaveTextContent('16/500');
    await fireEvent.changeText(screen.getByTestId('visitRating.comment'), 'x'.repeat(520));
    expect(screen.getByTestId('visitRating.counter')).toHaveTextContent('500/500');
    expect(screen.getByTestId('visitRating.comment').props.maxLength).toBe(500);
  });

  it('a member with a written review gets the replace note instead of the comment', async () => {
    await openSheet(promptJSON({ hasWrittenReview: true }), 4);
    expect(screen.queryByTestId('visitRating.comment')).toBeNull();
    expect(screen.getByText('Your stars replace the ones on your review. Its text stays as it is.')).toBeOnTheScreen();
  });

  it('Send: the thank-you, the review offer, Done, then Google Play’s own card (a happy moment)', async () => {
    api.on('POST', ANSWER, Reply.ok(answerJSON()));
    await openSheet(promptJSON(), 5);
    await fireEvent.press(star('equipment', 4));
    await fireEvent.changeText(screen.getByTestId('visitRating.comment'), '  Spotless showers. ');
    await fireEvent.press(sendButton());
    await settle();

    const sent = api.sent(ANSWER, 'POST');
    expect(sent.body).toEqual({ rating: 5, equipmentRating: 4, cleanlinessRating: null, comment: 'Spotless showers.' });
    expect(sent.headers['idempotency-key']).toBeTruthy();
    expect(screen.getByText('Thanks for rating!')).toBeOnTheScreen();
    expect(screen.getByText("Your stars now count in the venue's rating.")).toBeOnTheScreen();
    expect(screen.getByText('Want to tell other members more?')).toBeOnTheScreen();
    expect(screen.getByText('Write a public review')).toBeOnTheScreen();
    expect(screen.queryByTestId('visitRating.card')).toBeNull();
    expect(storeReviewState.requests()).toBe(0); // never over the thank-you

    await fireEvent.press(screen.getByTestId('visitRating.done'));
    await settle();
    expect(screen.queryByTestId('visitRating.sheet')).toBeNull();
    expect(storeReviewState.requests()).toBe(1);
  });

  it('no Google Play card for a new account, or for 3 stars', async () => {
    signIn(2);
    api.on('POST', ANSWER, Reply.ok(answerJSON()));
    await openSheet(promptJSON(), 5);
    await fireEvent.press(sendButton());
    await settle();
    await fireEvent.press(screen.getByTestId('visitRating.done'));
    await settle();
    expect(storeReviewState.requests()).toBe(0);
  });

  it('"Write a public review" opens the venue page, with no Google Play card over it', async () => {
    const open = jest.spyOn(navigation, 'navigateInCurrentTab').mockReturnValue(true);
    try {
      api.on('POST', ANSWER, Reply.ok(answerJSON()));
      await openSheet(promptJSON(), 5);
      await fireEvent.press(sendButton());
      await settle();
      await fireEvent.press(screen.getByTestId('visitRating.writeReview'));
      await settle();
      expect(open).toHaveBeenCalledWith('VenueDetail', { slug: 'world-class-laugar' });
      expect(storeReviewState.requests()).toBe(0);
    } finally {
      open.mockRestore();
    }
  });

  it('a written review: the thank-you offers no review', async () => {
    api.on('POST', ANSWER, Reply.ok(answerJSON({ hasWrittenReview: true, rating: { kind: 'written', rating: 4 } })));
    await openSheet(promptJSON({ hasWrittenReview: true }), 4);
    await fireEvent.press(sendButton());
    await settle();
    expect(screen.getByText('Thanks for rating!')).toBeOnTheScreen();
    expect(screen.queryByTestId('visitRating.writeReview')).toBeNull();
  });

  it('409 answered: the sheet closes and says so', async () => {
    api.on('POST', ANSWER, Reply.problem(409, 'visit_rating_prompt_closed', { reason: 'answered' }));
    await openSheet(promptJSON(), 3);
    await fireEvent.press(sendButton());
    await settle();
    expect(screen.queryByTestId('visitRating.sheet')).toBeNull();
    expect(screen.getByText("You've already rated this visit.")).toBeOnTheScreen();
  });

  it('no answer: the sheet stays, says so, and Send tries the same answer again under the same key', async () => {
    api.on('POST', ANSWER, { kind: 'network-error' });
    await openSheet(promptJSON(), 4);
    await fireEvent.press(sendButton());
    await settle();
    expect(screen.getByTestId('visitRating.error')).toHaveTextContent("Couldn't send your rating. Try again.");
    expect(sendButton()).not.toBeDisabled();
    api.on('POST', ANSWER, Reply.ok(answerJSON({ happyMoment: false })));
    await fireEvent.press(sendButton());
    await settle();
    const keys = api.sentAll(ANSWER, 'POST').map((request) => request.headers['idempotency-key']);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(screen.getByText('Thanks for rating!')).toBeOnTheScreen();
  });

  it('in Icelandic: the contract’s words', async () => {
    setCurrentLanguage('is');
    await openSheet(promptJSON(), 2);
    // The card's title and the sheet's.
    expect(screen.getAllByText('Hvernig var heimsóknin?')).toHaveLength(2);
    for (const text of [
      'Heildareinkunn',
      'Tækjabúnaður',
      'Hreinlæti',
      'Athugasemd (valfrjálst)',
      'Einkunnin þín er opinber. Ef þú skrifar athugasemd birtist hún með upphafsstaf þínum og dagsetningu heimsóknarinnar.',
      'Senda',
    ]) {
      // The rows' words are drawn for the eye; TalkBack hears them from the stars.
      expect(screen.getByText(text, { includeHiddenElements: true })).toBeOnTheScreen();
    }
    expect(screen.getByTestId('visitRating.notNow')).toHaveTextContent('Ekki núna');
    expect(screen.getAllByText('Valfrjálst', { includeHiddenElements: true })).toHaveLength(2);
    expect(screen.getByPlaceholderText('Hvað stóð upp úr?')).toBeOnTheScreen();
    expect(screen.getByTestId('visitRating.stars.equipment').props.accessibilityLabel).toBe('Tækjabúnaður, Valfrjálst');
  });

  it('at the largest text size it opens full height, with Send pinned below the form', async () => {
    setTestFontScale(2);
    await openSheet(promptJSON(), 5);
    expect(bottomSheetMock.latest()?.snapPoints).toEqual(['100%']);
    expect(screen.getByTestId('visitRating.sheet.footer')).toContainElement(sendButton());
  });
});

describe('the notification tap', () => {
  it('opens the sheet for the ask that is current, once nothing it must not cover is on screen', async () => {
    api.on('GET', CURRENT, Reply.ok({ prompt: promptJSON() }));
    paymentOnScreen(true);
    await renderApp();
    await act(async () => useIntentStore.getState().parkVisitRatingTap());
    await settle();
    expect(screen.queryByTestId('visitRating.sheet')).toBeNull();
    expect(api.sentAll(CURRENT, 'GET')).toHaveLength(0);

    await act(async () => paymentOnScreen(false));
    await settle();
    expect(screen.getByTestId('visitRating.sheet')).toBeOnTheScreen();
    expect(useIntentStore.getState().pendingVisitRatingTap).toBeNull();
  });

  it('opens nothing when the server says there is no ask', async () => {
    api.on('GET', CURRENT, Reply.ok({ prompt: null }));
    await renderApp();
    await act(async () => useIntentStore.getState().parkVisitRatingTap());
    await settle();
    expect(api.sentAll(CURRENT, 'GET')).toHaveLength(1);
    expect(screen.queryByTestId('visitRating.sheet')).toBeNull();
  });
});
