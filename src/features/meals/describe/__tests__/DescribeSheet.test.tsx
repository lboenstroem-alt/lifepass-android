/**
 * The describe sheet on screen (iOS MealDescribeSheet), opened through the
 * MEAL-2 contract (`openDescribe`) with the host F4's shell mounts: the
 * words handed in, Estimate and "One moment", the draft handed back and the
 * announcement, the one-tap consent retrying the same words with the same
 * key, every failure line with "Search instead" (none offline), the
 * allowance line, the route that is gone, the gate, the counter, and
 * analytics that never carry the words.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import { AccessibilityInfo } from 'react-native';

import { ProblemError, TransportError } from '../../../../api';
import { decodeProfile } from '../../../../api/profile';
import { stubApiClientPerTest } from '../../../../api/testing';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { resetHealthStoreForTests } from '../../../../health/store';
import { useMealGatePresenter } from '../../../../health';
import { setCurrentLanguage, translate } from '../../../../i18n';
import { setAnalyticsObserver, type AnalyticsParams } from '../../../../lib/analytics';
import { resetAppStoreForTests, selectSupportsMealDescribe, useAppStore } from '../../../../stores/appStore';
import { setMealApi } from '../../api/mealApi';
import { fakeMealApi } from '../../api/testing';
import { decodeMealRecord, type MealDescribeBody, type MealDescribeResult } from '../../types';
import DescribeHost from '../DescribeHost';
import { openDescribe, resetDescribePresenter, useDescribePresenter, type DescribePrefill } from '../presenter';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);

const draft = decodeMealRecord(
  {
    id: 'meal-text-1',
    logDate: '2026-10-16',
    loggedAt: '2026-10-16T12:40:00.000Z',
    slot: 'lunch',
    source: 'text',
    confirmed: false,
    needsConfirm: true,
    hasEstimate: true,
    items: [],
    updatedAt: '2026-10-16T12:40:00.123Z',
  },
  'meal',
);

function problem(status: number, slug: string): ProblemError {
  return new ProblemError({ type: `https://lifepass.is/problems/${slug}`, title: slug, status }, status);
}

function ok(left: number | null, meal = draft): MealDescribeResult {
  return { meal, noFood: false, needsConfirm: true, describesLeftToday: left, replayed: false };
}

type Answer = MealDescribeResult | Error;

/** Answers `describe` in order and records what was sent. */
function useDescribeAnswers(answers: Answer[]) {
  const sent: { body: MealDescribeBody; key: string }[] = [];
  const queue = [...answers];
  setMealApi(
    fakeMealApi({
      describe: async (body, key) => {
        sent.push({ body, key });
        const next = queue.shift();
        if (!next) throw new TransportError('network');
        if (next instanceof Error) throw next;
        return next;
      },
    }),
  );
  return sent;
}

function profileJSON(ageSource: string | null, features: string[], version = '2026-09-v1') {
  return {
    id: MEMBER,
    locale: 'en',
    kennitalaVerified: true,
    marketingConsent: false,
    health: {
      access: 'entitled',
      consent: ageSource === null ? null : { version, consentedAt: '2026-10-01T10:00:00Z', ageSource },
      features,
    },
  };
}

function signIn(options: { consentAgeSource?: string | null; features?: string[] } = {}) {
  const features = options.features ?? ['meal_describe'];
  const json = profileJSON(options.consentAgeSource === undefined ? 'kennitala' : options.consentAgeSource, features);
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: decodeProfile(json), serverFeatures: features, healthAccess: 'entitled' });
  api.on('GET', '/profile', Reply.ok(json));
}

const events: [string, AnalyticsParams][] = [];

async function open(prefill: Partial<DescribePrefill> = {}) {
  const onDraft = jest.fn();
  const onSearch = jest.fn();
  await render(<DescribeHost />);
  await act(async () => {
    openDescribe({ text: 'Focaccia sandwich with mozzarella and pesto', slot: 'lunch', date: '2026-10-16', onDraft, onSearch, ...prefill });
  });
  return { onDraft, onSearch };
}

const estimateButton = () => screen.getByTestId('meal.describe.submit');
const isOpen = () => useDescribePresenter.getState().visible;

beforeEach(() => {
  bottomSheetMock.reset();
  resetAppStoreForTests();
  resetHealthStoreForTests();
  resetDescribePresenter();
  setCurrentLanguage('en');
  events.length = 0;
  setAnalyticsObserver((event, params) => events.push([event, params]));
});

afterEach(() => {
  setAnalyticsObserver(null);
  setMealApi(null);
  resetDescribePresenter();
  resetAppStoreForTests();
});

it('draws the title, the words handed in, the hint, Estimate and the notice', async () => {
  signIn();
  useDescribeAnswers([]);
  await open();
  expect(screen.getByRole('header', { name: en('meal.describe.title') })).toBeOnTheScreen();
  expect(screen.getByTestId('meal.describe.field').props.value).toBe('Focaccia sandwich with mozzarella and pesto');
  expect(screen.getByText(en('meal.describe.hint'))).toBeOnTheScreen();
  expect(screen.getByText(en('meal.describe.submit'))).toBeOnTheScreen();
  expect(screen.getByText(en('meal.describe.notice'))).toBeOnTheScreen();
  expect(screen.queryByTestId('meal.describe.counter')).toBeNull();
  expect(screen.queryByTestId('meal.describe.remaining')).toBeNull();
});

it('an empty field has the placeholder and no Estimate to press', async () => {
  signIn();
  useDescribeAnswers([]);
  await open({ text: '' });
  expect(screen.getByTestId('meal.describe.field').props.placeholder).toBe(en('meal.describe.placeholder'));
  expect(estimateButton()).toBeDisabled();
  await fireEvent.changeText(screen.getByTestId('meal.describe.field'), 'skyr');
  expect(estimateButton()).toBeEnabled();
});

it('Estimate sends the words once, hands the draft back, says it is ready and closes', async () => {
  signIn();
  const sent = useDescribeAnswers([ok(14)]);
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  const { onDraft } = await open();
  await fireEvent.press(estimateButton());
  await waitFor(() => expect(onDraft).toHaveBeenCalledWith('meal-text-1', draft));
  expect(sent).toHaveLength(1);
  expect(sent[0]!.body.text).toBe('Focaccia sandwich with mozzarella and pesto');
  expect(sent[0]!.body.slot).toBe('lunch');
  expect(sent[0]!.body.logDate).toBe('2026-10-16');
  expect(announce).toHaveBeenCalledWith(en('meal.describe.ready'));
  expect(isOpen()).toBe(false);
  // Analytics: what happened, never the words.
  expect(events.map(([event]) => event)).toEqual(['meal_describe_submitted', 'meal_describe_result']);
  expect(events[1]![1]).toEqual({ outcome: 'ok' });
  expect(JSON.stringify(events)).not.toMatch(/focaccia/i);
  announce.mockRestore();
});

it('says "One moment" while it works and sends nothing on a second press', async () => {
  signIn();
  let release: (value: MealDescribeResult) => void = () => undefined;
  const keys: string[] = [];
  setMealApi(
    fakeMealApi({
      describe: (_body, key) => {
        keys.push(key);
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    }),
  );
  await open();
  await fireEvent.press(estimateButton());
  expect(screen.getByText(en('meal.describe.estimating'))).toBeOnTheScreen();
  expect(estimateButton().props.accessibilityState).toMatchObject({ busy: true });
  await fireEvent.press(estimateButton());
  expect(keys).toHaveLength(1);
  await act(async () => release(ok(3)));
});

it('the one-tap consent: the describe text, v3 granted, then the same words with the same key', async () => {
  signIn({ consentAgeSource: 'kennitala' });
  const sent = useDescribeAnswers([problem(409, 'meal_describe_consent_required'), ok(14)]);
  api.on('POST', '/profile/health-consent', Reply.ok({ optedIn: true, version: '2026-09-v3', consentedAt: '2026-10-16T10:00:00Z', ageSource: 'kennitala' }));
  const { onDraft } = await open();
  await fireEvent.press(estimateButton());
  await waitFor(() => expect(screen.getByTestId('meal.describe.consentBlock')).toBeOnTheScreen());
  expect(screen.getByText(en('healthconsent.ai.describe'))).toBeOnTheScreen();
  expect(screen.getByText(en('healthconsent.privacy_link'))).toBeOnTheScreen();
  // The consent block says it in full: no notice under it, no Estimate.
  expect(screen.queryByText(en('meal.describe.notice'))).toBeNull();
  expect(screen.queryByTestId('meal.describe.submit')).toBeNull();

  // The profile read after the grant answers with the new consent.
  api.on('GET', '/profile', Reply.ok(profileJSON('kennitala', ['meal_describe'], '2026-09-v3')));
  await fireEvent.press(screen.getByTestId('meal.describe.consent'));
  await waitFor(() => expect(onDraft).toHaveBeenCalledTimes(1));
  const grant = api.sent('/profile/health-consent', 'POST');
  expect(grant.body).toEqual({ optedIn: true, version: '2026-09-v3', source: 'coach_intake' });
  expect(sent).toHaveLength(2);
  expect(sent[1]!.key).toBe(sent[0]!.key);
  expect(grant.headers['idempotency-key']).not.toBe(sent[0]!.key);
  expect(useAppStore.getState().profile?.health?.consent?.version).toBe('2026-09-v3');
  expect(events.find(([event]) => event === 'health_consent_granted')?.[1]).toEqual({ entry: 'describe', source: 'kennitala' });
});

it('an attested consent is granted again with its attestation', async () => {
  signIn({ consentAgeSource: 'attestation' });
  useDescribeAnswers([problem(409, 'meal_describe_consent_required'), ok(2)]);
  api.on('POST', '/profile/health-consent', Reply.ok({ optedIn: true, version: '2026-09-v3', consentedAt: '2026-10-16T10:00:00Z', ageSource: 'attestation' }));
  const { onDraft } = await open();
  await fireEvent.press(estimateButton());
  await waitFor(() => screen.getByTestId('meal.describe.consent'));
  await fireEvent.press(screen.getByTestId('meal.describe.consent'));
  await waitFor(() => expect(onDraft).toHaveBeenCalled());
  expect(api.sent('/profile/health-consent', 'POST').body).toEqual({
    optedIn: true,
    version: '2026-09-v3',
    source: 'coach_intake',
    ageAttested: true,
  });
});

it('a consent tap that fails offline says so under the button, which stays', async () => {
  signIn();
  useDescribeAnswers([problem(409, 'meal_describe_consent_required')]);
  api.on('POST', '/profile/health-consent', Reply.fail());
  await open();
  await fireEvent.press(estimateButton());
  await waitFor(() => screen.getByTestId('meal.describe.consent'));
  await fireEvent.press(screen.getByTestId('meal.describe.consent'));
  await waitFor(() => expect(screen.getByTestId('meal.describe.consentError')).toHaveTextContent(en('health.offline.action_hint')));
  expect(screen.getByTestId('meal.describe.consent')).toBeEnabled();
});

it.each([
  ['personal data', problem(422, 'meal_describe_personal_data'), 'meal.describe.err.personal'],
  ['no food', { meal: null, noFood: true, needsConfirm: false, describesLeftToday: 9, replayed: false } as MealDescribeResult, 'meal.describe.err.no_food'],
  ['an upstream failure', problem(502, 'coach_upstream_error'), 'meal.describe.err.failed'],
  ['a timeout', new TransportError('timeout'), 'meal.describe.err.failed'],
  ['too many requests', problem(429, 'rate_limited'), 'health.err.rate_limited'],
])('%s: its line, and Search instead with the cleaned words', async (_name, answer, key) => {
  signIn();
  useDescribeAnswers([answer]);
  const { onSearch } = await open({ text: '  pasta \n with  pesto ' });
  await fireEvent.press(estimateButton());
  await waitFor(() => expect(screen.getByTestId('meal.describe.error')).toHaveTextContent(en(key)));
  await fireEvent.press(screen.getByTestId('meal.describe.searchInstead'));
  expect(onSearch).toHaveBeenCalledWith('pasta with pesto');
  expect(isOpen()).toBe(false);
});

it('too many words says the limit', async () => {
  signIn();
  useDescribeAnswers([problem(400, 'invalid-meal-describe')]);
  await open({ text: 'pizza '.repeat(46) });
  await fireEvent.press(estimateButton());
  await waitFor(() => expect(screen.getByTestId('meal.describe.error')).toHaveTextContent('Up to 280 characters.'));
});

it('offline: the line, and no Search instead (search needs a connection too)', async () => {
  signIn();
  useDescribeAnswers([new TransportError('offline')]);
  await open();
  await fireEvent.press(estimateButton());
  await waitFor(() => expect(screen.getByTestId('meal.describe.error')).toHaveTextContent(en('meal.photo.err.offline')));
  expect(screen.queryByTestId('meal.describe.searchInstead')).toBeNull();
  expect(events.at(-1)).toEqual(['meal_describe_result', { outcome: 'offline' }]);
});

it('a spent allowance keeps Estimate off whatever the words', async () => {
  signIn();
  useDescribeAnswers([problem(429, 'meal_describe_limit')]);
  await open();
  await fireEvent.press(estimateButton());
  await waitFor(() => expect(screen.getByTestId('meal.describe.error')).toHaveTextContent(en('meal.describe.err.limit')));
  expect(estimateButton()).toBeDisabled();
  await fireEvent.changeText(screen.getByTestId('meal.describe.field'), 'skyr with berries');
  expect(estimateButton()).toBeDisabled();
  expect(screen.getByTestId('meal.describe.error')).toBeOnTheScreen();
});

it('says how many are left once five or fewer remain', async () => {
  signIn();
  useDescribeAnswers([{ meal: null, noFood: true, needsConfirm: false, describesLeftToday: 1, replayed: false }]);
  await open();
  await fireEvent.press(estimateButton());
  await waitFor(() => expect(screen.getByTestId('meal.describe.remaining')).toHaveTextContent(en('meal.describe.remaining.one')));
});

it('a route that is gone (404) hides the entry and goes to search with the words', async () => {
  signIn();
  useDescribeAnswers([problem(404, 'not_found')]);
  api.on('GET', '/health', Reply.problem(500, 'internal_error'));
  const { onSearch } = await open({ text: 'skyr' });
  await fireEvent.press(estimateButton());
  await waitFor(() => expect(onSearch).toHaveBeenCalledWith('skyr'));
  expect(selectSupportsMealDescribe(useAppStore.getState())).toBe(false);
  expect(isOpen()).toBe(false);
});

it('a membership refusal closes the sheet for the page’s gate', async () => {
  signIn();
  const refusal = new ProblemError(
    { type: 'https://lifepass.is/problems/no_active_plan_or_pass', title: 'x', status: 403, memberPricing: 'pass_holder' },
    403,
  );
  useDescribeAnswers([refusal]);
  const onGate = jest.fn();
  await open({ onGate });
  await fireEvent.press(estimateButton());
  await waitFor(() => expect(onGate).toHaveBeenCalledWith('pass_only'));
  expect(isOpen()).toBe(false);
  expect(useMealGatePresenter.getState().visible).toBe(false);
});

it('a pending deletion is a sentence in the sheet', async () => {
  signIn();
  useDescribeAnswers([problem(409, 'account_pending_deletion')]);
  await open();
  await fireEvent.press(estimateButton());
  await waitFor(() => expect(screen.getByTestId('meal.describe.refusal')).toHaveTextContent(en('health.err.pending_deletion')));
  expect(isOpen()).toBe(true);
});

it('shows the counter within 40 of the cap, and caps what is typed', async () => {
  signIn();
  useDescribeAnswers([]);
  await open({ text: '' });
  await fireEvent.changeText(screen.getByTestId('meal.describe.field'), 'a'.repeat(250));
  expect(screen.getByTestId('meal.describe.counter')).toHaveTextContent('250/280');
  await fireEvent.changeText(screen.getByTestId('meal.describe.field'), 'a'.repeat(300));
  expect(screen.getByTestId('meal.describe.field').props.value).toBe('a'.repeat(280));
  expect(screen.getByTestId('meal.describe.counter')).toHaveTextContent('280/280');
});

it('Cancel closes it; a second opening starts fresh', async () => {
  signIn();
  useDescribeAnswers([]);
  await open({ text: 'first words' });
  await fireEvent.press(screen.getByTestId('meal.describe.cancel'));
  expect(isOpen()).toBe(false);
  await act(async () => {
    openDescribe({ text: 'second', onDraft: jest.fn() });
  });
  expect(screen.getByTestId('meal.describe.field').props.value).toBe('second');
});

it('one sheet at a time, and none without a host', async () => {
  expect(openDescribe({ onDraft: jest.fn() })).toBe(false);
  signIn();
  useDescribeAnswers([]);
  await open({ text: 'first' });
  expect(openDescribe({ text: 'second', onDraft: jest.fn() })).toBe(false);
  expect(screen.getByTestId('meal.describe.field').props.value).toBe('first');
  await screen.unmount();
  expect(useDescribePresenter.getState().request).toBeNull();
});

it('speaks Icelandic', async () => {
  signIn();
  setCurrentLanguage('is');
  const sent = useDescribeAnswers([problem(422, 'meal_describe_personal_data')]);
  await open({ text: 'skyr með bláberjum' });
  expect(screen.getByText(translate('meal.describe.title', 'is'))).toBeOnTheScreen();
  await fireEvent.press(estimateButton());
  await waitFor(() => expect(screen.getByTestId('meal.describe.error')).toHaveTextContent(translate('meal.describe.err.personal', 'is')));
  expect(sent[0]!.body.locale).toBe('is');
});
