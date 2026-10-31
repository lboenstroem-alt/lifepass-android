/**
 * Body and goals on screen (iOS BodyAndGoalsView): the sections for each
 * member, the page's own two reads, what a lapsed member keeps, the target
 * row, the chart, Your plan, the reminders (defaults, writes on a change
 * only, the permission asked only when never asked, the refused state), the
 * withdrawal (the same call from the switch and Delete all, the "Deleted"
 * sheet BEFORE the local wipe, the error lines), the export, and nothing on
 * the page naming Apple Health or Health Connect.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { notificationsState } from '@test/mocks/expoNotifications';
import { api, Reply, type StubReply } from '@test/server';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ScrollView, StyleSheet } from 'react-native';

import { stubApiClientPerTest } from '../../../api/testing';
import { bottomSheetMock } from '../../../components/ui/testing/bottomSheetMock';
import { healthLocalStore, ReminderKeys } from '../../../health';
import { resetHealthStoreForTests, useHealthStore } from '../../../health/store';
import { setCurrentLanguage, translate } from '../../../i18n';
import * as analytics from '../../../lib/analytics';
import { resetAppStoreForTests, useAppStore } from '../../../stores/appStore';
import { useIntentStore } from '../../../stores/intentStore';
import BodyAndGoalsScreen from '../BodyAndGoalsScreen';
import { resetExportCleanupForTests } from '../export/cleanup';
import { onReminderSyncRequested, resetReminderSyncListenersForTests } from '../reminders/preferences';
import { openBodySheet, openTargetSheet } from '../sheets';
import {
  CONSENT_JSON,
  currentRoute,
  MEMBER,
  navigationRef,
  profileJson,
  renderPushed,
  settle,
  signIn,
  type MemberOptions,
} from './harness';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));
// BODY-2's sheets are opened through its published door; here they only record the request.
jest.mock('../sheets', () => ({
  ...jest.requireActual('../sheets'),
  openBodySheet: jest.fn(),
  openTargetSheet: jest.fn(),
}));
// FEED-1's slot: a stand-in that draws, so the page's place for it shows.
jest.mock('../slots/FeedbackSwitches', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: MockText } = require('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    default: function FeedbackSwitchesStandIn() {
      return <MockText testID="slot.FeedbackSwitches">[FeedbackSwitches]</MockText>;
    },
  };
});

stubApiClientPerTest();

// A page with a navigator, sheets and the network: room for a busy machine.
jest.setTimeout(30_000);

const en = (key: string, params?: Record<string, string>) => translate(key, 'en', params);

const TREND = {
  weeks: [
    { weekStartsOn: '2026-08-03', avgKg: 74.8, count: 2 },
    { weekStartsOn: '2026-08-10', avgKg: null, count: 0 },
    { weekStartsOn: '2026-08-17', avgKg: 73.6, count: 2 },
    { weekStartsOn: '2026-08-24', avgKg: 72.5, count: 1 },
  ],
  latestAvgKg: 72.5,
  deltaKg: -2.3,
  direction: 'down',
};

const GOAL = { goal: 'lose', sex: 'female', ageBand: '25_34', activity: 'light', customKcal: null, target: { kcalLow: 1750, kcalHigh: 1950, proteinG: 110, basis: 'goal' } };

const TARGET = {
  targetWeightKg: 68,
  direction: 'lose',
  setAt: '2026-08-20T08:00:00Z',
  reachedAt: null,
  outsideHealthyRange: false,
  appliesTo: 'goal',
  eta: { weeksLow: 10, weeksHigh: 12 },
};

const DELETED = {
  bodyMeasurements: 24,
  coachPrograms: 2,
  coachProgramSessions: 31,
  weeklyReviews: 6,
  mealLogs: 58,
  wearableDailyRecords: 0,
  nutritionSettings: 1,
  feedbackReports: 0,
};

function serve(options: { trend?: object; goal?: object | null; target?: object | null; features?: string[] } = {}) {
  api.on('GET', '/health/measurements/trend', Reply.ok(options.trend ?? TREND));
  api.on(
    'GET',
    '/health/nutrition-goal',
    Reply.ok({ goal: options.goal === undefined ? GOAL : options.goal, targetWeight: options.target ?? null, features: options.features ?? ['target_weight'] }),
  );
}

async function show(options: MemberOptions = {}, route: { params?: object; below?: string } = {}) {
  signIn(options);
  api.on('GET', '/profile', Reply.ok(profileJson(options)));
  await renderPushed('BodyAndGoals', BodyAndGoalsScreen, route);
  await settle();
}

const rowLabel = (testID: string) => screen.getByTestId(testID).props.accessibilityLabel as string;

/** A reply the test hands over when it chooses. */
function heldReply() {
  let release: (reply: StubReply) => void = () => undefined;
  const reply = new Promise<StubReply>((resolve) => {
    release = resolve;
  });
  return { reply, release: (answer: StubReply) => release(answer) };
}

/** The member taps the top bar's back (never blocked, a request in flight or not). */
async function leavePage() {
  await act(async () => {
    navigationRef.goBack();
  });
  await settle();
}

function exportFiles(): string[] {
  const cache = new Directory(Paths.cache);
  if (!cache.exists) return [];
  return cache
    .list()
    .filter((entry): entry is File => entry instanceof File && entry.name.startsWith('lifepass-export-'))
    .map((file) => file.name);
}

/** Every word on screen (texts, labels, hints), for the "never names Apple Health" checks. */
function allText(): string {
  const words: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      words.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const { props, children } = node as { props?: Record<string, unknown>; children?: unknown };
    for (const key of ['accessibilityLabel', 'accessibilityHint']) {
      if (typeof props?.[key] === 'string') words.push(props[key] as string);
    }
    walk(children);
  };
  walk(screen.toJSON());
  return words.join('\n');
}

afterEach(async () => {
  resetExportCleanupForTests();
  await healthLocalStore.clearExports();
});

beforeEach(() => {
  bottomSheetMock.reset();
  resetAppStoreForTests();
  resetHealthStoreForTests();
  resetReminderSyncListenersForTests();
  notificationsState.setPermission('granted');
  serve();
});

describe('the sections', () => {
  it('with consent: tracking, your body, reminders, the feedback slot, what we store, your data, the footer', async () => {
    const track = jest.spyOn(analytics, 'track');
    await show();
    expect(screen.getByText('BODY AND GOALS')).toBeTruthy();
    expect(rowLabel('bodygoals.tracking.switch')).toBe('Health and fitness tracking');
    expect(screen.getByTestId('bodygoals.tracking.switch').props.accessibilityHint).toBe('On since 1 September');
    expect(screen.getByTestId('bodygoals.tracking.switch').props.accessibilityState).toMatchObject({ checked: true });
    for (const id of ['bodygoals.body', 'bodygoals.reminders', 'slot.FeedbackSwitches', 'bodygoals.store', 'bodygoals.data', 'bodygoals.footer']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    // No live plan, no Your plan.
    expect(screen.queryByTestId('bodygoals.plan')).toBeNull();
    // The page's own reads: the 12-week trend, then the goal in the account language.
    expect(api.sent('/health/measurements/trend').query).toEqual({ weeks: '12' });
    expect(api.sent('/health/nutrition-goal').query).toEqual({ locale: 'en' });
    expect(track).toHaveBeenCalledWith('body_goals_opened', { entry: 'plan' });
  });

  it('without consent: the switch off, what we store and the export only (no delete, no body, no reminders)', async () => {
    await show({ consent: false });
    expect(screen.getByTestId('bodygoals.tracking.switch').props.accessibilityState).toMatchObject({ checked: false, disabled: false });
    expect(screen.getByTestId('bodygoals.tracking.switch').props.accessibilityHint).toBe(en('bodygoals.tracking_off'));
    expect(screen.queryByTestId('bodygoals.body')).toBeNull();
    expect(screen.queryByTestId('bodygoals.reminders')).toBeNull();
    expect(screen.queryByTestId('slot.FeedbackSwitches')).toBeNull();
    expect(screen.getByTestId('bodygoals.export')).toBeTruthy();
    expect(screen.queryByTestId('bodygoals.deleteAll')).toBeNull();
    // Nothing to read without consent.
    expect(api.sentAll('/health/measurements/trend')).toHaveLength(0);
  });

  it('without consent and without a membership the switch cannot be turned on, and says why', async () => {
    await show({ consent: false, access: 'not_member' });
    const toggle = screen.getByTestId('bodygoals.tracking.switch');
    expect(toggle.props.accessibilityState).toMatchObject({ checked: false, disabled: true });
    expect(toggle.props.accessibilityHint).toBe('Needs an active membership');
    // Only the switch is dim (iOS disables the Toggle alone): the title and
    // the line that says why stay at full strength.
    expect(StyleSheet.flatten(toggle.props.style).opacity).toBeUndefined();
    expect(StyleSheet.flatten(screen.getByTestId('bodygoals.tracking.switch.control', { includeHiddenElements: true }).props.style).opacity).toBe(0.45);
    expect(screen.getByText('Needs an active membership')).toBeTruthy();
  });

  it('a minor sees the under-18 notice and the footer, nothing else', async () => {
    await show({ access: 'minor', consent: false });
    expect(screen.getByText(en('health.minor.title'))).toBeTruthy();
    expect(screen.getByText(en('health.minor.body'))).toBeTruthy();
    expect(screen.queryByTestId('bodygoals.tracking')).toBeNull();
    expect(screen.queryByTestId('bodygoals.data')).toBeNull();
    expect(screen.getByTestId('bodygoals.footer')).toBeTruthy();
  });

  it('opened from Account it reports entry account; with an anchor from Plan, banner', async () => {
    const track = jest.spyOn(analytics, 'track');
    await show({}, { below: 'Account' });
    expect(track).toHaveBeenCalledWith('body_goals_opened', { entry: 'account' });
  });

  it('opened on the reminders reports banner', async () => {
    const track = jest.spyOn(analytics, 'track');
    await show({}, { params: { anchor: 'reminders' } });
    expect(track).toHaveBeenCalledWith('body_goals_opened', { entry: 'banner' });
  });

  it('opened on the feedback, it scrolls to the section itself, not the gap above it', async () => {
    const scrollTo = ScrollView.prototype.scrollTo as jest.Mock;
    scrollTo.mockClear();
    await show({}, { params: { anchor: 'feedback' } });
    const slot = screen.getByTestId('bodygoals.slot.feedback');
    // The slot draws: its first layout has no gap above it yet, so no scroll.
    await fireEvent.layout(slot, { x: 0, y: 900, width: 360, height: 120 });
    await settle();
    expect(StyleSheet.flatten(slot.props.style)).toMatchObject({ marginTop: 22 });
    expect(scrollTo).not.toHaveBeenCalled();
    // The gap moves it down 22: that is where the page opens.
    await fireEvent.layout(slot, { x: 0, y: 922, width: 360, height: 120 });
    await settle();
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 922 }));
  });

  it('nothing on the page names Apple Health or Health Connect, in either language', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('bodygoals.store.toggle'));
    expect(allText()).not.toMatch(/Apple Health|Health Connect/);

    await act(async () => {
      setCurrentLanguage('is');
      useAppStore.setState({ profile: { ...useAppStore.getState().profile!, locale: 'is' } });
    });
    await settle();
    expect(allText()).not.toMatch(/Apple Health|Health Connect/);
  });
});

describe('your body', () => {
  it('the latest weigh-in, the chart, Log weight, the calorie goal, the target and the history', async () => {
    serve({ target: TARGET });
    await show();
    expect(rowLabel('bodygoals.latest')).toBe('72.5 kg · 178 cm');
    expect(rowLabel('bodygoals.goal')).toBe('Calorie goal, Lose weight: about 1,750 to 1,950 kcal a day');
    expect(rowLabel('bodygoals.target')).toBe('Target weight, Target 68 kg · about 10 to 12 weeks at this pace');
    const chart = screen.getByTestId('bodygoals.chart.target');
    expect(chart.props.accessibilityLabel).toBe('Weekly average weight');
    expect(chart.props.accessibilityValue).toEqual({ text: 'From 74.8 kg to 72.5 kg, down. Target 68 kilograms.' });
    expect(within(chart).getByText('Mon 3 Aug', { includeHiddenElements: true })).toBeTruthy();
    expect(within(chart).getByText('Mon 24 Aug', { includeHiddenElements: true })).toBeTruthy();
  });

  it('no chart under two weeks with an average; no target row without a target or a goal that takes one', async () => {
    serve({ trend: { ...TREND, weeks: [TREND.weeks[0], TREND.weeks[1]] }, goal: { ...GOAL, goal: 'maintain' } });
    await show();
    expect(screen.queryByTestId('bodygoals.chart')).toBeNull();
    expect(screen.queryByTestId('bodygoals.chart.target')).toBeNull();
    expect(screen.queryByTestId('bodygoals.target')).toBeNull();
  });

  it('a lose goal without a target offers "Add a target weight"; a reached target shows the note', async () => {
    serve({ target: { ...TARGET, reachedAt: '2026-09-17T08:00:00Z', eta: null } });
    await show();
    expect(rowLabel('bodygoals.target')).toBe('Target weight, Reached 68 kg on Thu 17 Sept');
    expect(screen.getByText(en('target.reached.title'))).toBeTruthy();
    expect(screen.getByText(en('target.reached.cta'))).toBeTruthy();
  });

  it('a lapsed member reads everything and writes nothing, and every dead row says why', async () => {
    serve({ target: TARGET });
    await show({ access: 'past_due' });
    expect(rowLabel('bodygoals.latest')).toBe('72.5 kg · 178 cm, Needs an active membership');
    expect(screen.getByTestId('bodygoals.latest').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('bodygoals.logWeight.row').props.accessibilityState).toMatchObject({ disabled: true });
    expect(rowLabel('bodygoals.goal')).toBe('Calorie goal, Lose weight: about 1,750 to 1,950 kcal a day · Needs an active membership');
    expect(rowLabel('bodygoals.target')).toBe(
      'Target weight, Target 68 kg · about 10 to 12 weeks at this pace · Needs an active membership',
    );
    // Reads, the export and the delete stay.
    expect(screen.getByTestId('bodygoals.history').props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.getByTestId('bodygoals.export')).toBeTruthy();
    expect(screen.getByTestId('bodygoals.deleteAll').props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('the rows open the body sheet, the goal sheet, the target sheet and the weight history', async () => {
    serve({ target: TARGET });
    await show({ program: { status: 'active', weekNo: 3, weeks: 8, summaryTitle: 'Strength, 3 days a week' } });
    await fireEvent.press(screen.getByTestId('bodygoals.latest'));
    expect(openBodySheet).toHaveBeenCalledWith(expect.objectContaining({ kind: 'update', programId: expect.any(String) }));
    await fireEvent.press(screen.getByTestId('bodygoals.goal'));
    expect(openBodySheet).toHaveBeenCalledWith(expect.objectContaining({ kind: 'goal' }));
    await fireEvent.press(screen.getByTestId('bodygoals.target'));
    expect(openTargetSheet).toHaveBeenCalledWith(expect.objectContaining({ kind: 'save', existing: expect.objectContaining({ targetWeightKg: 68 }) }));
    await fireEvent.press(screen.getByTestId('bodygoals.history'));
    await settle();
    expect(currentRoute()).toBe('Measurements');
  });

  it('a saved body re-reads the profile and the page', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('bodygoals.goal'));
    const mode = (openBodySheet as jest.Mock).mock.calls[0][0] as { onSaved: () => void };
    const reads = api.sentAll('/health/measurements/trend').length;
    mode.onSaved();
    await settle();
    expect(api.sentAll('/health/measurements/trend').length).toBe(reads + 1);
    expect(api.sentAll('/profile').length).toBeGreaterThan(0);
  });

  it("Log weight opens the weight-only sheet over the page", async () => {
    await show();
    await fireEvent.press(screen.getByTestId('bodygoals.logWeight.row'));
    expect(screen.getByTestId('bodygoals.logWeight.save')).toBeTruthy();
    expect(screen.getAllByText(en('checkin.weight_title'))).toHaveLength(2);
  });

  it('a failed read: the error and Try again, which reads again', async () => {
    api.once('GET', '/health/measurements/trend', Reply.problem(500, 'internal_error'));
    await show();
    expect(screen.getByTestId('bodygoals.loadFailed')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('bodygoals.loadFailed.action'));
    await settle();
    expect(screen.queryByTestId('bodygoals.loadFailed')).toBeNull();
    expect(screen.getByTestId('bodygoals.chart')).toBeTruthy();
  });
});

describe('your plan', () => {
  it('a live plan: its title and week, and a tap takes the member to Plan at its root', async () => {
    await show({ program: { status: 'paused', weekNo: 3, weeks: 8, summaryTitle: 'Strength, 3 days a week' } });
    expect(rowLabel('bodygoals.plan.row')).toBe('Strength, 3 days a week, Week 3 of 8');
    await fireEvent.press(screen.getByTestId('bodygoals.plan.row'));
    expect(useIntentStore.getState().pendingTab).toBe('Plan');
  });

  it('a finished plan is not shown', async () => {
    await show({ program: { status: 'completed', weekNo: 8, weeks: 8, summaryTitle: null } });
    expect(screen.queryByTestId('bodygoals.plan')).toBeNull();
  });
});

describe('reminders', () => {
  it('nothing stored: on, 07:00, on, Mondays at 07:30; and reading writes nothing', async () => {
    await show();
    expect(screen.getByTestId('bodygoals.rem.workout').props.accessibilityState).toMatchObject({ checked: true, disabled: false });
    expect(screen.getByTestId('bodygoals.rem.time').props.accessibilityValue).toEqual({ text: '07:00' });
    expect(screen.getByTestId('bodygoals.rem.checkin').props.accessibilityHint).toBe('Mondays at 07:30');
    expect(screen.getByTestId('bodygoals.rem.day').props.accessibilityValue).toEqual({ text: 'Mondays' });
    expect(await AsyncStorage.getItem(ReminderKeys.workoutDay(MEMBER))).toBeNull();
  });

  it('a change writes the choices, reports it and asks for a resync; the time row goes off with the notes', async () => {
    const track = jest.spyOn(analytics, 'track');
    const sync = jest.fn();
    onReminderSyncRequested(sync);
    await show();
    await fireEvent.press(screen.getByTestId('bodygoals.rem.workout'));
    await settle();
    expect(await AsyncStorage.getItem(ReminderKeys.workoutDay(MEMBER))).toBe('false');
    expect(await AsyncStorage.getItem(ReminderKeys.checkInTime(MEMBER))).toBe('450');
    expect(track).toHaveBeenCalledWith('reminder_setting_changed', { kind: 'workoutday' });
    expect(sync).toHaveBeenCalled();
    expect(screen.getByTestId('bodygoals.rem.time').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('the check-in day and time menus write the choice', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('bodygoals.rem.day'));
    await fireEvent.press(screen.getByTestId('bodygoals.rem.day.7'));
    await settle();
    expect(await AsyncStorage.getItem(ReminderKeys.checkInDay(MEMBER))).toBe('7');
    expect(screen.getByTestId('bodygoals.rem.checkin').props.accessibilityHint).toBe('Sundays at 07:30');
  });

  it('switching one ON asks for the permission only when never asked', async () => {
    await AsyncStorage.setItem(ReminderKeys.weeklyCheckIn(MEMBER), 'false');
    notificationsState.setPermission('undetermined');
    await show();
    await fireEvent.press(screen.getByTestId('bodygoals.rem.checkin'));
    await settle();
    expect(notificationsState.requestCount()).toBe(1);
    expect(await AsyncStorage.getItem(`health.reminders.${MEMBER}.denied`)).toBe('false');

    // Switching it off and on again asks nothing more: the member answered.
    await fireEvent.press(screen.getByTestId('bodygoals.rem.checkin'));
    await fireEvent.press(screen.getByTestId('bodygoals.rem.checkin'));
    await settle();
    expect(notificationsState.requestCount()).toBe(1);
  });

  it('refused: "Notifications are off" with Open Settings, every row off, and the flag Plan reads', async () => {
    notificationsState.setPermission('denied');
    await show();
    expect(screen.getByText(en('bodygoals.rem_denied'))).toBeTruthy();
    expect(screen.getByRole('button', { name: en('bodygoals.open_settings') })).toBeTruthy();
    expect(screen.getByTestId('bodygoals.rem.workout').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('bodygoals.rem.checkin').props.accessibilityState).toMatchObject({ disabled: true });
    expect(await AsyncStorage.getItem(`health.reminders.${MEMBER}.denied`)).toBe('true');
    expect(notificationsState.requestCount()).toBe(0);
  });
});

describe('delete everything', () => {
  const WITHDRAWN = { optedIn: false, version: '2026-09-v1', consentedAt: null, ageSource: null, deleted: DELETED };

  it('the switch asks first; Cancel deletes nothing', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('bodygoals.tracking.switch'));
    expect(screen.getByText(en('bodygoals.delete_title'))).toBeTruthy();
    expect(screen.getByText(translate('bodygoals.android.delete_body', 'en'))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('bodygoals.delete.cancel'));
    await settle();
    expect(api.sentAll('/profile/health-consent')).toHaveLength(0);
  });

  it('withdraws with the recorded version, shows what was deleted, and wipes this phone only once that sheet has gone', async () => {
    const track = jest.spyOn(analytics, 'track');
    await AsyncStorage.setItem(ReminderKeys.workoutDay(MEMBER), 'false');
    api.on('POST', '/profile/health-consent', Reply.ok(WITHDRAWN));
    await show();

    await fireEvent.press(screen.getByTestId('bodygoals.deleteAll'));
    await fireEvent.press(screen.getByTestId('bodygoals.delete.confirm'));
    await settle();

    const sent = api.sent('/profile/health-consent', 'POST');
    expect(sent.body).toEqual({ optedIn: false, version: CONSENT_JSON.version, source: 'account' });
    expect(sent.headers['idempotency-key']).toBeTruthy();
    expect(track).toHaveBeenCalledWith('health_consent_withdrawn', { entry: 'delete_all' });

    // The member is told first.
    const lines = screen.getAllByTestId('bodygoals.deleted.line').map((line) => line.props.accessibilityLabel);
    expect(lines).toEqual(['24 weight entries', '2 plans', '31 workouts', '6 weekly reviews', '58 meals', 'Your calorie goal']);
    // The page already shows no health data, whatever a read in flight says.
    expect(screen.queryByTestId('bodygoals.body')).toBeNull();
    expect(useAppStore.getState().profile?.health?.consent).toBeNull();
    // And this phone has not wiped yet.
    expect(track).not.toHaveBeenCalledWith('health_local_wiped', expect.anything());
    expect(await AsyncStorage.getItem(ReminderKeys.workoutDay(MEMBER))).toBe('false');

    const profileReads = api.sentAll('/profile').length;
    await fireEvent.press(screen.getByTestId('bodygoals.deleted.done'));
    await settle(10);
    expect(track).toHaveBeenCalledWith('health_local_wiped', { reason: 'withdrawn' });
    expect(await AsyncStorage.getItem(ReminderKeys.workoutDay(MEMBER))).toBeNull();
    expect(api.sentAll('/profile').length).toBe(profileReads + 1);
  });

  it('from the switch it reports entry toggle; nothing stored says so', async () => {
    const track = jest.spyOn(analytics, 'track');
    api.on('POST', '/profile/health-consent', Reply.ok({ ...WITHDRAWN, deleted: {} }));
    await show();
    await fireEvent.press(screen.getByTestId('bodygoals.tracking.switch'));
    await fireEvent.press(screen.getByTestId('bodygoals.delete.confirm'));
    await settle();
    expect(track).toHaveBeenCalledWith('health_consent_withdrawn', { entry: 'toggle' });
    expect(screen.getByTestId('bodygoals.deleted.nothing')).toBeTruthy();
  });

  it('a stale profile read carrying the old consent does not bring the deleted numbers back', async () => {
    api.on('POST', '/profile/health-consent', Reply.ok(WITHDRAWN));
    await show();
    await fireEvent.press(screen.getByTestId('bodygoals.deleteAll'));
    await fireEvent.press(screen.getByTestId('bodygoals.delete.confirm'));
    await settle();
    // A read that was in flight lands with the consent just withdrawn.
    await act(async () => {
      signIn();
    });
    await settle();
    expect(screen.queryByTestId('bodygoals.body')).toBeNull();
    expect(screen.getByTestId('bodygoals.tracking.switch').props.accessibilityState).toMatchObject({ checked: false });
  });

  it('a failure keeps everything and says why: offline has its own line', async () => {
    api.once('POST', '/profile/health-consent', Reply.problem(500, 'internal_error'));
    await show();
    await fireEvent.press(screen.getByTestId('bodygoals.deleteAll'));
    await fireEvent.press(screen.getByTestId('bodygoals.delete.confirm'));
    await settle();
    expect(screen.getByTestId('bodygoals.tracking.error')).toBeTruthy();
    expect(screen.getByText(en('common.error_body'))).toBeTruthy();
    expect(screen.getByTestId('bodygoals.body')).toBeTruthy();

    api.once('POST', '/profile/health-consent', Reply.fail());
    await fireEvent.press(screen.getByTestId('bodygoals.deleteAll'));
    await fireEvent.press(screen.getByTestId('bodygoals.delete.confirm'));
    await settle();
    expect(screen.getByText(en('health.offline.action_hint'))).toBeTruthy();
  });

  it('turning tracking on opens the consent sheet', async () => {
    await show({ consent: false });
    await fireEvent.press(screen.getByTestId('bodygoals.tracking.switch'));
    expect(screen.getByTestId('bodygoals.consent')).toBeTruthy();
  });

  it('a member who leaves while the call runs: the phone still wipes as the answer lands', async () => {
    const track = jest.spyOn(analytics, 'track');
    await AsyncStorage.setItem(ReminderKeys.workoutDay(MEMBER), 'false');
    const held = heldReply();
    api.on('POST', '/profile/health-consent', () => held.reply);
    await show();
    await fireEvent.press(screen.getByTestId('bodygoals.deleteAll'));
    await fireEvent.press(screen.getByTestId('bodygoals.delete.confirm'));
    await settle();
    expect(screen.getByTestId('bodygoals.tracking.busy')).toBeTruthy();

    await leavePage();
    expect(currentRoute()).toBe('PlanMain');
    api.on('GET', '/profile', Reply.ok(profileJson({ consent: false })));
    held.release(Reply.ok(WITHDRAWN));
    await settle(10);

    expect(track).toHaveBeenCalledWith('health_consent_withdrawn', { entry: 'delete_all' });
    expect(track).toHaveBeenCalledWith('health_local_wiped', { reason: 'withdrawn' });
    expect(await AsyncStorage.getItem(ReminderKeys.workoutDay(MEMBER))).toBeNull();
    expect(useAppStore.getState().profile?.health?.consent).toBeNull();
    // Not a later reconcile's "turned off on another device".
    expect(track).not.toHaveBeenCalledWith('health_local_wiped', { reason: 'withdrawn_elsewhere' });
    expect(useHealthStore.getState().toastKey).not.toBe('health.consent_off_elsewhere');
  });

  it('switching tracking back on after a withdrawal never shows the deleted target, even when the read fails', async () => {
    serve({ target: TARGET });
    api.on('POST', '/profile/health-consent', (request) =>
      (request.body as { optedIn?: boolean }).optedIn === false
        ? Reply.ok(WITHDRAWN)
        : Reply.ok({ optedIn: true, version: CONSENT_JSON.version, consentedAt: '2026-10-21T09:00:00Z', ageSource: 'kennitala' }),
    );
    await show();
    expect(screen.getByTestId('bodygoals.target')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('bodygoals.deleteAll'));
    await fireEvent.press(screen.getByTestId('bodygoals.delete.confirm'));
    await settle();
    await fireEvent.press(screen.getByTestId('bodygoals.deleted.done'));
    await settle(10);

    // Yes again, from this page; the trend read that follows fails, so the goal read never runs.
    api.on('GET', '/health/measurements/trend', Reply.problem(500, 'internal_error'));
    await fireEvent.press(screen.getByTestId('bodygoals.tracking.switch'));
    await settle();
    await fireEvent.press(screen.getByTestId('healthconsent.consent'));
    await fireEvent.press(screen.getByTestId('healthconsent.cta'));
    await settle(10);

    expect(screen.getByTestId('bodygoals.tracking.switch').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('bodygoals.loadFailed')).toBeTruthy();
    expect(screen.queryByTestId('bodygoals.target')).toBeNull();
  });

  describe("the consent sheet's Open account (a deletion is pending)", () => {
    async function openAccountFromSheet() {
      api.on('POST', '/profile/health-consent', Reply.problem(409, 'account_pending_deletion'));
      await fireEvent.press(screen.getByTestId('bodygoals.tracking.switch'));
      await settle();
      await fireEvent.press(screen.getByTestId('healthconsent.consent'));
      await fireEvent.press(screen.getByTestId('healthconsent.cta'));
      await settle();
      await fireEvent.press(screen.getByRole('button', { name: en('health.err.open_account') }));
      await settle();
    }

    it('opened from Account: back to that Account, not a second one on top', async () => {
      await show({ consent: false }, { below: 'Account' });
      await openAccountFromSheet();
      expect(currentRoute()).toBe('Account');
      expect(navigationRef.getRootState().routes.map((r) => r.name)).toEqual(['Account']);
    });

    it("opened from Plan: Account is pushed on Plan's stack", async () => {
      await show({ consent: false });
      await openAccountFromSheet();
      expect(navigationRef.getRootState().routes.map((r) => r.name)).toEqual(['PlanMain', 'BodyAndGoals', 'Account']);
    });
  });
});

describe('download my data', () => {
  it('shares the file and reports ok', async () => {
    const track = jest.spyOn(analytics, 'track');
    api.on('GET', '/account/export', Reply.ok({ format: '2026-09-v3' }));
    await show();
    await fireEvent.press(screen.getByTestId('bodygoals.export'));
    await settle();
    expect(Sharing.shareAsync).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('health_export_requested', { outcome: 'ok' });
    expect(screen.queryByTestId('bodygoals.export.error')).toBeNull();
  });

  it('a member who leaves Body and goals while it is read: no file, no share sheet, nothing reported', async () => {
    const track = jest.spyOn(analytics, 'track');
    const held = heldReply();
    api.on('GET', '/account/export', () => held.reply);
    await show();
    await fireEvent.press(screen.getByTestId('bodygoals.export'));
    await leavePage();
    held.release(Reply.ok({ format: '2026-09-v3' }));
    await settle();
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
    expect(exportFiles()).toEqual([]);
    expect(track).not.toHaveBeenCalledWith('health_export_requested', expect.anything());
  });

  it('a member who signs out while it is read: no file, and no share sheet over the sign-in screen', async () => {
    const held = heldReply();
    api.on('GET', '/account/export', () => held.reply);
    await show();
    await fireEvent.press(screen.getByTestId('bodygoals.export'));
    await act(async () => {
      useAppStore.setState({ isAuthenticated: false, userId: null });
    });
    held.release(Reply.ok({ format: '2026-09-v3' }));
    await settle();
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
    expect(exportFiles()).toEqual([]);
  });

  it('the daily limit has its own red line', async () => {
    api.on('GET', '/account/export', Reply.problem(429, 'account_export_limit'));
    await show({ consent: false });
    await fireEvent.press(screen.getByTestId('bodygoals.export'));
    await settle();
    expect(screen.getByText(en('bodygoals.export.limit'))).toBeTruthy();
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });
});
