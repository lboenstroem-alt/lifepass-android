/**
 * The Today section on the real health store, the real Plan shell and the
 * stub server (iOS PlanTodayCard): every state of 3.7 drawn from a Today
 * read, the writes it sends (fresh Idempotency-Key, the contract's body) and
 * how their answers patch the day, read-only and offline, the sheets it opens
 * and the hand-offs to the runner, the Coach, Profile and the venue page.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { expectRequestValid } from '@test/contract';
import { api, Reply } from '@test/server';

import { TransportError } from '../../../../api';
import { stubApiClientPerTest } from '../../../../api/testing';
import { UiKitProvider } from '../../../../components/ui';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { decodeHealthDay, useHealthStore } from '../../../../health';
import * as healthLocalStore from '../../../../health/localStore';
import { restoreTestFontScale, setTestFontScale } from '../../../../hooks/testing';
import { setCurrentLanguage, translate } from '../../../../i18n';
import { addServerDays, shortDay } from '../../../../i18n/format';
import * as runner from '../../../runner';
import { useAppStore } from '../../../../stores/appStore';
import { useIntentStore } from '../../../../stores/intentStore';
import TodaySection from '../../sections/Today';
import { installWeeklyCheckInOpener } from '../../shell/bridges';
import { attachPlanNavigator } from '../../shell/planShell';
import { dayJSON, freshPlan, memberProfile, recordAnalytics, settle, signIn, TODAY } from '../../__tests__/planFixtures';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);
const is = (key: string, params?: Record<string, string | number>) => translate(key, 'is', params);

const SESSION = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const TOMORROW = addServerDays(TODAY, 1)!;

type Json = Record<string, unknown>;

/** Today's read with `session` (merged over a planned strength session) and `day` extras. */
function todayJSON(session: Json = {}, extra: Json = {}, dayExtra: Json = {}): Json {
  const base = dayJSON(TODAY, extra);
  return {
    ...base,
    day: {
      date: TODAY,
      relative: 'today',
      session: { id: SESSION, scheduledFor: TODAY, kind: 'strength', title: 'Full body strength', status: 'planned', minutes: 40, ...session },
      ...dayExtra,
    },
  };
}

function seed(json: Json, options: { selected?: string } = {}) {
  const day = decodeHealthDay(json);
  const selected = options.selected ?? TODAY;
  useHealthStore.setState({
    today: decodeHealthDay(json.date === TODAY ? json : todayJSON()),
    days: { [day.date]: day },
    selectedDate: selected,
    loadState: { kind: 'loaded', at: new Date() },
    profileId: memberProfile().id,
  });
}

const navigate = jest.fn();

async function renderToday() {
  await render(
    <UiKitProvider>
      <TodaySection />
    </UiKitProvider>,
  );
  await act(async () => settle());
}

/** A session action's answer: `session` as the server sends it back, today's week. */
function answer(session: Json, extra: Json = {}): Json {
  return { session: { id: SESSION, scheduledFor: TODAY, kind: 'strength', title: 'Full body strength', ...session }, week: dayJSON().week, upcoming: [], ...extra };
}

const blocks = [
  { exerciseId: 'squat', name: 'Goblet squat', sets: 3, reps: 10, loadHint: 'moderate' },
  { exerciseId: 'plank', name: 'Side plank', sets: 2, seconds: 30, perSide: true },
  { exerciseId: 'row', name: 'Rowing', sets: 1, seconds: 600, minutes: 10 },
  { exerciseId: 'press', name: 'Press', sets: 3, reps: 8, loadHint: 'light' },
  { exerciseId: 'bridge', name: 'Bridge', sets: 3, reps: 12, loadHint: 'bodyweight' },
];

beforeEach(() => {
  freshPlan();
  bottomSheetMock.reset();
  setTestFontScale(1);
  navigate.mockReset();
  attachPlanNavigator({ navigate, popToTop: jest.fn() });
  signIn();
  api.on('GET', '/health', Reply.ok(todayJSON()));
});

afterEach(async () => {
  setCurrentLanguage('en');
  restoreTestFontScale();
  jest.restoreAllMocks();
  await settle();
  await healthLocalStore.settled();
});

describe("today's planned workout", () => {
  it('says the week, the session, its minutes and intensity, and the first three exercises', async () => {
    seed(todayJSON({ intensity: 'hard', blocks }));
    await renderToday();
    expect(screen.getByTestId('plan.today.kicker')).toHaveTextContent(en('plan.today.kicker', { week: 2, weeks: 4 }).toUpperCase());
    expect(screen.getByRole('header', { name: 'Full body strength' })).toBeOnTheScreen();
    expect(screen.getByText('40 min · Hard')).toBeOnTheScreen();
    expect(screen.getByText('3 × 10 · Moderate')).toBeOnTheScreen();
    expect(screen.getByText('2 × 30 s each side')).toBeOnTheScreen();
    expect(screen.getByText('10 min')).toBeOnTheScreen();
    expect(screen.queryByText('Press')).toBeNull();
    expect(screen.getByText('and 2 more')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en('plan.start') })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en('plan.no_energy') })).toBeOnTheScreen();
  });

  it('Start opens the runner on the session', async () => {
    const open = jest.spyOn(runner, 'openRunner').mockImplementation(() => undefined);
    seed(todayJSON());
    await renderToday();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.start') }));
    await act(async () => settle());
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: SESSION }), 'today');
  });

  it('reads in Icelandic', async () => {
    setCurrentLanguage('is');
    seed(todayJSON({ blocks: blocks.slice(0, 1) }));
    await renderToday();
    expect(screen.getByText('40 mín · Miðlungs')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: is('plan.start') })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: is('plan.no_energy') })).toBeOnTheScreen();
  });

  it('a session pulled here says where from, and a lighter one says so', async () => {
    seed(todayJSON({ movedFrom: TOMORROW, undoAction: 'pull', lighter: true }));
    await renderToday();
    expect(screen.getByText(en('plan.pulled.line', { day: shortDay(TOMORROW, 'en') }))).toBeOnTheScreen();
    expect(screen.getByText(en('plan.lighter_chip'))).toBeOnTheScreen();
  });

  it('No energy opens the PLAN-3 sheet and says where it came from', async () => {
    const events = recordAnalytics();
    seed(todayJSON());
    await renderToday();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.no_energy') }));
    expect(events).toContainEqual({ event: 'workout_no_energy_opened', params: { entry: 'today' } });
  });
});

describe('offline and read only', () => {
  it('offline dims every action but Start, hides No energy and says it needs a connection', async () => {
    seed(todayJSON({ kind: 'swim', title: 'Pool', blocks: [{ name: 'Front crawl', sets: 4, meters: 50 }] }));
    useHealthStore.setState({ lastError: new TransportError('offline') });
    await renderToday();
    expect(screen.getByText('4 × 50 m')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en('plan.swim.find_pool') })).toBeDisabled();
    expect(screen.getByRole('button', { name: en('plan.mark_done') })).toBeDisabled();
    expect(screen.queryByRole('button', { name: en('plan.no_energy') })).toBeNull();
    expect(screen.getByText(en('health.offline.action_hint'))).toBeOnTheScreen();
  });

  it('Start still works offline', async () => {
    jest.spyOn(runner, 'openRunner').mockImplementation(() => undefined);
    seed(todayJSON());
    useHealthStore.setState({ lastError: new TransportError('offline') });
    await renderToday();
    expect(screen.getByRole('button', { name: en('plan.start') })).toBeEnabled();
  });

  it.each(['past_due', 'pass_only', 'not_member'])('%s reads the card and writes nothing', async (access) => {
    signIn(memberProfile({ access }));
    seed(todayJSON({ kind: 'class', title: 'Yoga', classLabel: 'yoga', minutes: 60 }, {}, {}));
    await renderToday();
    expect(screen.getByText(en('plan.class.line', { class: 'yoga', minutes: 60 }))).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en('plan.class.book') })).toBeNull();
    expect(screen.queryByRole('button', { name: en('plan.mark_done') })).toBeNull();
    expect(screen.queryByRole('button', { name: en('plan.no_energy') })).toBeNull();
  });

  it('a read-only missed row just says Missed.', async () => {
    signIn(memberProfile({ access: 'past_due' }));
    seed(todayJSON({ status: 'missed', canLogDone: true, canSkip: true }));
    await renderToday();
    expect(screen.getByText(en('plan.missed.line_readonly'))).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en('plan.log_done') })).toBeNull();
  });
});

describe('the writes', () => {
  it('Mark as done sends done with the minutes and a fresh key, and the answer asks how it felt', async () => {
    const events = recordAnalytics();
    seed(todayJSON({ kind: 'hike', title: 'Esja', minutes: 150 }));
    api.on('POST', `/health/sessions/${SESSION}`, Reply.ok(answer({ kind: 'hike', title: 'Esja', status: 'done', canUndo: true })));
    await renderToday();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.mark_done') }));
    await act(async () => settle());
    const sent = api.sent(`/health/sessions/${SESSION}`, 'POST');
    expect(sent.body).toEqual({ action: 'done', minutes: 150 });
    expect(sent.headers['idempotency-key']).toMatch(/^[A-Za-z0-9_.:-]{8,128}$/);
    expectRequestValid(sent);
    expect(events).toContainEqual({ event: 'workout_marked_done', params: { kind: 'hike' } });
    expect(screen.getByText(en('plan.done.title_chip'))).toBeOnTheScreen();
    expect(screen.getByText(en('plan.feeling.q'))).toBeOnTheScreen();
    expect(useHealthStore.getState().today?.day?.session?.status).toBe('done');
  });

  it('a double tap posts once, and every key is new', async () => {
    seed(todayJSON({ kind: 'walk', title: 'Walk' }));
    let release: (() => void) | null = null;
    api.on('POST', `/health/sessions/${SESSION}`, () => new Promise<void>((resolve) => (release = resolve)).then(() => Reply.ok(answer({ kind: 'walk', status: 'done' }))));
    await renderToday();
    const markDone = screen.getByRole('button', { name: en('plan.mark_done') });
    await fireEvent.press(markDone);
    await fireEvent.press(markDone);
    await act(async () => settle());
    expect(api.sentAll(`/health/sessions/${SESSION}`, 'POST')).toHaveLength(1);
    await act(async () => {
      release?.();
      await settle();
    });
  });

  it('the feeling chips send the feeling', async () => {
    seed(todayJSON({ status: 'done' }));
    api.on('POST', `/health/sessions/${SESSION}`, Reply.ok(answer({ status: 'done', feeling: 'hard', remark: { text: 'Strong work.' } })));
    await renderToday();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.feeling.hard') }));
    await act(async () => settle());
    expect(api.sent(`/health/sessions/${SESSION}`, 'POST').body).toEqual({ action: 'feeling', feeling: 'hard' });
    expect(screen.getByText('Strong work.')).toBeOnTheScreen();
    expect(screen.queryByText(en('plan.feeling.q'))).toBeNull();
  });

  it('a refusal that says the plan changed elsewhere reads the day again', async () => {
    seed(todayJSON({ kind: 'hike', title: 'Esja' }));
    api.on('POST', `/health/sessions/${SESSION}`, Reply.problem(409, 'session_action_not_allowed'));
    await renderToday();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.mark_done') }));
    await act(async () => settle());
    expect(useHealthStore.getState().toastKey).toBe('health.err.changed');
    await waitFor(() => expect(api.sentAll('/health').length).toBeGreaterThan(0));
  });

  it('Undo on a done row sends undo', async () => {
    seed(todayJSON({ status: 'done', feeling: 'ok', canUndo: true }));
    api.on('POST', `/health/sessions/${SESSION}`, Reply.ok(answer({ status: 'planned' })));
    await renderToday();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.undo') }));
    await act(async () => settle());
    expect(api.sent(`/health/sessions/${SESSION}`, 'POST').body).toEqual({ action: 'undo' });
    expect(screen.getByRole('button', { name: en('plan.start') })).toBeOnTheScreen();
  });
});

describe('done, skipped and missed', () => {
  it('a done row with a feeling says the remark, tomorrow, next week and where it was counted from', async () => {
    seed(
      todayJSON(
        { status: 'done', feeling: 'ok', remark: { text: 'Nice and steady.' }, doneSource: 'check_in', checkInVenueName: 'Sundhöllin' },
        {},
        { tomorrow: { kind: 'cardio', title: 'Intervals' }, nextWeekChange: { text: 'one more set of squats' } },
      ),
    );
    await renderToday();
    expect(screen.getByText('Nice and steady.')).toBeOnTheScreen();
    expect(screen.getByText(en('plan.tomorrow', { title: 'Intervals' }))).toBeOnTheScreen();
    expect(screen.getByText(en('plan.next_week_change', { change: 'one more set of squats' }))).toBeOnTheScreen();
    expect(screen.getByText(en('plan.done_source.check_in', { venue: 'Sundhöllin' }))).toBeOnTheScreen();
    expect(screen.queryByText(en('plan.feeling.q'))).toBeNull();
  });

  it('a row a watch counted never names Apple Health', async () => {
    seed(todayJSON({ status: 'done', feeling: 'ok', doneSource: 'wearable' }));
    await renderToday();
    expect(screen.getByText('Counted from a workout your watch or phone recorded')).toBeOnTheScreen();
    expect(screen.queryByText(/Apple Health/)).toBeNull();
  });

  it('a skipped row says why, with Undo', async () => {
    seed(todayJSON({ status: 'skipped', skipReason: 'time', canUndo: true }));
    await renderToday();
    expect(screen.getByText(en('plan.skipped.line', { reason: en('plan.skip_reason.time') }))).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en('plan.undo') })).toBeOnTheScreen();
  });

  it('a missed row offers Do it now, Log as done and Skip it', async () => {
    const open = jest.spyOn(runner, 'openRunner').mockImplementation(() => undefined);
    seed(todayJSON({ status: 'missed', canLogDone: true, canSkip: true }));
    await renderToday();
    expect(screen.getByText(en('plan.missed.line'))).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en('plan.log_done') })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en('plan.skip_it') })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.do_it_now') }));
    await act(async () => settle());
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: SESSION }), 'missed');
  });

  it('a Save waiting in the outbox is done and waiting, with nothing to tap', async () => {
    seed(todayJSON({ canUndo: true }));
    runner.useWorkoutOutbox.setState({
      items: [
        {
          id: 'item-1',
          sessionId: SESSION,
          body: { action: 'done' } as never,
          key: 'key-12345678',
          createdAt: new Date(),
          state: 'pending',
          converted: false,
        },
      ],
    });
    await renderToday();
    expect(screen.getByText(en('plan.done.title_chip'))).toBeOnTheScreen();
    expect(screen.getByText(en('plan.waiting_sync'))).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en('plan.start') })).toBeNull();
    runner.useWorkoutOutbox.setState({ items: [] });
  });
});

describe('the rows above the session', () => {
  it('the note, and Why with the reasons it knows', async () => {
    const events = recordAnalytics();
    seed(
      todayJSON({}, {
        note: { title: 'An easier day', body: 'Your plan went easier today.', reasonCodes: ['short_sleep', 'from_the_future'] },
        scores: { recoveryBand: 'low' },
      }),
    );
    await renderToday();
    expect(screen.getByText('An easier day')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en('plan.recovery.chip', { band: en('ah.band.low') }) })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.note.why') }));
    await act(async () => settle());
    expect(events).toContainEqual({ event: 'note_why_opened', params: {} });
    expect(screen.getByRole('header', { name: en('note.why.title') })).toBeOnTheScreen();
    expect(screen.getByText(en('note.reason.short_sleep'))).toBeOnTheScreen();
    expect(screen.queryByText('note.reason.from_the_future')).toBeNull();
    expect(screen.getByText(en('ah.recovery.row', { band: en('ah.band.low') }))).toBeOnTheScreen();
    expect(screen.getByText(en('ah.accuracy'))).toBeOnTheScreen();
  });

  it('the weekly check-in opens the sheet PLAN-5 installs', async () => {
    const opener = jest.fn();
    installWeeklyCheckInOpener(opener);
    seed(todayJSON({}, { checkIn: { due: true } }));
    await renderToday();
    await fireEvent.press(screen.getByRole('button', { name: `${en('plan.checkin_prompt.title')}, ${en('plan.checkin_prompt.sub')}` }));
    expect(opener).toHaveBeenCalledWith('plan');
  });

  it('a workout in progress: Resume instead of Start', async () => {
    const open = jest.spyOn(runner, 'openRunner').mockImplementation(() => undefined);
    runner.useRunnerProgress.setState({ summary: { sessionId: SESSION, exercise: 2, total: 4, title: 'Full body strength', scheduledFor: TODAY } });
    seed(todayJSON());
    await renderToday();
    expect(screen.getByText(en('plan.in_progress', { n: 2, total: 4 }))).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en('plan.start') })).toBeNull();
    await fireEvent.press(screen.getByTestId('plan.resumeWorkout'));
    await act(async () => settle());
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: SESSION }), 'today');
    await act(async () => runner.useRunnerProgress.setState({ summary: null }));
  });

  it("another day's workout in progress is named, with Resume", async () => {
    runner.useRunnerProgress.setState({ summary: { sessionId: 's-old', exercise: 1, total: 3, title: 'Legs', scheduledFor: addServerDays(TODAY, -1) } });
    seed(todayJSON());
    await renderToday();
    expect(screen.getByText(en('runner.in_progress_other', { title: 'Legs', n: 1, total: 3 }))).toBeOnTheScreen();
    expect(screen.getByTestId('plan.resumeOtherWorkout')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en('plan.start') })).toBeOnTheScreen();
    await act(async () => runner.useRunnerProgress.setState({ summary: null }));
  });

  it('a session moved away, with Undo on the session it moved', async () => {
    seed(todayJSON({ kind: 'rest', status: 'rest', title: null }, {}, { movedAway: { sessionId: 's-moved', title: 'Legs', canUndo: true } }));
    api.on('POST', '/health/sessions/s-moved', Reply.ok(answer({ status: 'planned' })));
    await renderToday();
    expect(screen.getByText(en('plan.moved.line', { title: 'Legs' }))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.undo') }));
    await act(async () => settle());
    expect(api.sent('/health/sessions/s-moved', 'POST').body).toEqual({ action: 'undo' });
  });

  it('a paused plan says since when, and Resume plan sets it active', async () => {
    seed(todayJSON({}, { program: { id: 'p-1', status: 'paused', weekNo: 2, weeks: 4, pausedOn: TODAY } }));
    api.on('POST', '/health/programs/p-1', Reply.ok({ program: { id: 'p-1', status: 'active' } }));
    await renderToday();
    expect(screen.queryByRole('button', { name: en('plan.start') })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.resume_plan') }));
    await act(async () => settle());
    expect(api.sent('/health/programs/p-1', 'POST').body).toEqual({ status: 'active' });
  });

  it('a finished block asks about the next one: the Coach, or Not now', async () => {
    seed(todayJSON({}, { program: { id: 'p-1', status: 'completed', weekNo: 4, weeks: 4 } }));
    await renderToday();
    expect(screen.getByText(en('plan.block_done.title', { weeks: 4 }))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.block_done.next') }));
    expect(useIntentStore.getState().pendingCoachProgram).toEqual({ kind: 'nextBlock', programId: 'p-1' });
    expect(useIntentStore.getState().pendingTab).toBe('Coach');
    await fireEvent.press(screen.getByRole('button', { name: en('plan.block_done.not_now') }));
    expect(screen.queryByText(en('plan.block_done.title', { weeks: 4 }))).toBeNull();
    expect(screen.getByRole('button', { name: en('plan.start') })).toBeOnTheScreen();
  });
});

describe('kinds', () => {
  it('a booked class says when and where, with View booking', async () => {
    seed(
      todayJSON({ kind: 'class', title: 'Yoga' }, {}, {
        booking: { bookingId: 'b-1', activityTitle: 'Hot yoga', venueName: 'Yoga Shala', startsAt: '2026-10-16T18:00:00Z' },
      }),
    );
    await renderToday();
    expect(screen.getByText(/^Booked: Hot yoga at Yoga Shala, \d\d:\d\d$/)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en('plan.mark_done') })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.class.view_booking') }));
    expect(navigate).toHaveBeenCalledWith('Profile', { initialTab: 'bookings' });
  });

  it('an unbooked class opens class discovery on its category and date', async () => {
    const events = recordAnalytics();
    seed(todayJSON({ kind: 'class', title: 'Yoga', classCategory: 'yoga', classLabel: 'yoga' }));
    await renderToday();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.class.book') }));
    expect(navigate).toHaveBeenCalledWith('ClassesDiscoveryModal', { initialCategory: 'yoga', initialDate: TODAY });
    expect(events).toContainEqual({ event: 'plan_class_book_opened', params: {} });
  });

  it('a hike names its sight and the soak after', async () => {
    seed(
      todayJSON({ kind: 'hike', title: 'Esja', soakCaution: true }, {}, {
        attraction: { slug: 'esja', name: 'Esja', difficulty: 'hard', durationMinutes: 150, ascentM: 640 },
        soak: { venueSlug: 'sky-lagoon', venueName: 'Sky Lagoon', driveMinutes: 20, priceLabel: 'Included in your plan' },
      }),
    );
    await renderToday();
    await fireEvent.press(screen.getByRole('button', { name: 'Esja, Hard · 2 h 30 min · 640 m up' }));
    expect(navigate).toHaveBeenCalledWith('AttractionDetail', { slug: 'esja' });
    expect(screen.getByText('Included in your plan')).toBeOnTheScreen();
    expect(screen.getByText(en('plan.soak.gentle_caution'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByText(en('plan.hike.soak_after', { venue: 'Sky Lagoon', minutes: 20 })));
    expect(navigate).toHaveBeenCalledWith('VenueDetail', { slug: 'sky-lagoon' });
  });

  it('a windy hike day swaps to the pool', async () => {
    seed(todayJSON({ kind: 'hike', title: 'Esja', weatherSwap: true, poolAlternative: { minutes: 30 } }));
    await renderToday();
    expect(screen.getByText(en('plan.hike.weather_swap'))).toBeOnTheScreen();
    expect(screen.getByText(en('plan.swim.line', { minutes: 30 }))).toBeOnTheScreen();
  });

  it('Find a pool lists the pools and opens the one tapped once the picker has gone', async () => {
    const events = recordAnalytics();
    seed(todayJSON({ kind: 'swim', title: 'Pool' }));
    api.on(
      'GET',
      '/venues',
      Reply.ok({
        data: [
          { id: '11111111-1111-4111-8111-111111111111', slug: 'sundholl', name: 'Sundhöllin', city: 'Reykjavík' },
          { id: '22222222-2222-4222-8222-222222222222', slug: 'laugardalslaug', name: 'Laugardalslaug', city: 'Reykjavík' },
        ],
        pagination: { nextCursor: null, hasMore: false, limit: 40 },
      }),
    );
    await renderToday();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.swim.find_pool') }));
    await act(async () => settle());
    expect(events).toContainEqual({ event: 'plan_pool_picker_opened', params: {} });
    expect(api.sent('/venues', 'GET').query).toMatchObject({ category: 'Pool', limit: '40' });
    await fireEvent.press(screen.getByRole('button', { name: 'Laugardalslaug, Reykjavík' }));
    await act(async () => settle());
    expect(navigate).toHaveBeenCalledWith('VenueDetail', { slug: 'laugardalslaug' });
  });
});

describe('rest days, extras and other dates', () => {
  it('a rest day offers the soak, the walk and the later session this week', async () => {
    const saturday = addServerDays(TODAY, 1)!;
    seed(
      todayJSON(
        { kind: 'rest', status: 'rest', title: null, canLogExtra: true },
        {
          week: { weekStartsOn: TODAY, days: [] },
          upcoming: [{ id: 's-sat', scheduledFor: saturday, kind: 'strength', status: 'planned', title: 'Legs' }],
        },
        { restPick: { soak: { venueSlug: 'vesturbaejarlaug', venueName: 'Vesturbæjarlaug' }, walk: { slug: 'grotta', name: 'Grótta' } } },
      ),
    );
    api.on('GET', '/health/sessions/s-sat', Reply.ok({ session: { id: 's-sat', scheduledFor: saturday, kind: 'strength', title: 'Legs', canPull: true, blocks: [] } }));
    api.on('POST', '/health/sessions/s-sat', Reply.ok(answer({ id: 's-sat', status: 'planned', title: 'Legs' })));
    await renderToday();
    expect(screen.getByRole('header', { name: en('plan.today.rest_title') })).toBeOnTheScreen();
    expect(screen.getByText(en('plan.rest.line'))).toBeOnTheScreen();
    expect(screen.getByText('Vesturbæjarlaug')).toBeOnTheScreen();
    expect(screen.getByText(en('plan.rest.walk_pick', { sight: 'Grótta' }))).toBeOnTheScreen();
    expect(screen.getByTestId('plan.logWorkout')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('plan.today.pullForward'));
    await act(async () => settle());
    expect(api.sent('/health/sessions/s-sat', 'GET').query).toMatchObject({ locale: 'en' });
    expect(screen.getByText(en('history.detail.no_sets'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.do_today') }));
    await act(async () => settle());
    expect(api.sent('/health/sessions/s-sat', 'POST').body).toEqual({ action: 'pull' });
  });

  it('an extra on the row says what it was, and Remove takes it back', async () => {
    const events = recordAnalytics();
    seed(
      todayJSON({
        kind: 'rest',
        status: 'rest',
        title: null,
        extras: [{ id: 'extra-0001', index: 0, minutes: 45, kind: 'strength', title: 'Gym', note: 'Leg day', canRemove: true }],
      }),
    );
    api.on('POST', `/health/sessions/${SESSION}`, Reply.ok(answer({ kind: 'rest', status: 'rest', extras: [] })));
    await renderToday();
    expect(screen.getByText('Extra workout · Gym · 45 min')).toBeOnTheScreen();
    expect(screen.getByText('Leg day')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Remove extra workout: Gym, 45 minutes' }));
    await act(async () => settle());
    const sent = api.sent(`/health/sessions/${SESSION}`, 'POST');
    expect(sent.body).toEqual({ action: 'remove_extra', extraId: 'extra-0001' });
    expectRequestValid(sent);
    expect(events).toContainEqual({ event: 'plan_extra_removed', params: {} });
    expect(useHealthStore.getState().toastKey).toBe('logworkout.removed');
    expect(screen.queryByText('Extra workout · Gym · 45 min')).toBeNull();
  });

  it('another date says its date, and a future session offers only Preview', async () => {
    const later = addServerDays(TODAY, 2)!;
    seed(
      {
        ...dayJSON(later),
        day: {
          date: later,
          relative: 'future',
          session: { id: 's-later', scheduledFor: later, kind: 'strength', title: 'Legs', status: 'planned', minutes: 30, canPull: true, blocks },
        },
      },
      { selected: later },
    );
    api.on('POST', '/health/sessions/s-later', Reply.problem(409, 'session_move_past_week'));
    await renderToday();
    expect(screen.getByTestId('plan.today.kicker').props.children).not.toMatch(/^TODAY/);
    expect(screen.queryByRole('button', { name: en('plan.start') })).toBeNull();
    expect(screen.queryByRole('button', { name: en('plan.no_energy') })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.preview') }));
    await act(async () => settle());
    expect(screen.getByText(en('health.disclaimer'))).toBeOnTheScreen();
    expect(screen.getByText('Bridge')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.do_today') }));
    await act(async () => settle());
    // Refused: the button goes, with the "changed" toast.
    expect(screen.queryByRole('button', { name: en('plan.do_today') })).toBeNull();
    expect(useHealthStore.getState().toastKey).toBe('health.err.changed');
  });
});

describe('a class on a later date', () => {
  it('reads as the plan has it, even when it is booked (only the planned row names the booking)', async () => {
    const later = addServerDays(TODAY, 2)!;
    seed(
      {
        ...dayJSON(later),
        day: {
          date: later,
          relative: 'future',
          session: { id: 's-later', scheduledFor: later, kind: 'class', title: 'Yoga', classLabel: 'yoga', minutes: 60, status: 'planned' },
          booking: { bookingId: 'b-1', activityTitle: 'Hot yoga', venueName: 'Yoga Shala', startsAt: '2026-10-18T18:00:00Z' },
        },
      },
      { selected: later },
    );
    await renderToday();
    expect(screen.getByText(en('plan.class.line', { class: 'yoga', minutes: 60 }))).toBeOnTheScreen();
    expect(screen.queryByText(/^Booked:/)).toBeNull();
    expect(screen.queryByRole('button', { name: en('plan.class.view_booking') })).toBeNull();
    expect(screen.getByRole('button', { name: en('plan.preview') })).toBeOnTheScreen();
  });
});

describe('large text', () => {
  it('stacks the actions in a column at the accessibility sizes', async () => {
    setTestFontScale(2);
    seed(todayJSON({ kind: 'swim', title: 'Pool' }));
    await renderToday();
    expect(screen.getByTestId('plan.today.actions')).toHaveStyle({ flexDirection: 'column' });
    expect(screen.getByRole('button', { name: en('plan.swim.find_pool') })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en('plan.mark_done') })).toBeOnTheScreen();
  });

  it('keeps them on one line up to the largest standard size', async () => {
    setTestFontScale(1.3);
    seed(todayJSON({ kind: 'swim', title: 'Pool' }));
    await renderToday();
    expect(screen.getByTestId('plan.today.actions')).toHaveStyle({ flexDirection: 'row' });
  });
});

describe('Change with Coach (COACH-6)', () => {
  it('shows under a planned day while the server changes plans by chat, and opens the Coach about that day', async () => {
    useAppStore.setState({ serverFeatures: ['plan_edit'] });
    seed(todayJSON({ blocks }));
    await renderToday();
    await fireEvent.press(screen.getByTestId('plan.today.changeWithCoach'));
    expect(useIntentStore.getState().pendingCoachPlanEdit).toEqual({ sessionId: SESSION, sessionTitle: 'Full body strength' });
    expect(useIntentStore.getState().pendingTab).toBe('Coach');
  });

  it('is not offered by a server that does not change plans by chat, nor for a day already done', async () => {
    seed(todayJSON({ blocks }));
    await renderToday();
    expect(screen.queryByTestId('plan.today.changeWithCoach')).toBeNull();
    useAppStore.setState({ serverFeatures: ['plan_edit'] });
    seed(todayJSON({ status: 'done' }));
    await act(async () => settle());
    expect(screen.queryByTestId('plan.today.changeWithCoach')).toBeNull();
  });

  it('tags the member\'s own exercise', async () => {
    seed(todayJSON({ blocks: [{ exerciseId: 'custom-zottman-curl', name: 'Zottman curls', sets: 3, reps: 10, own: true }] }));
    await renderToday();
    expect(screen.getByText('Zottman curls')).toBeOnTheScreen();
    expect(screen.getByText(en('coach.planEdit.ownTag'))).toBeOnTheScreen();
  });
});
