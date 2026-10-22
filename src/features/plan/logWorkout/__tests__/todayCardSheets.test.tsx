/**
 * PLAN-3's two sheets inside their real host, the Today card (PLAN-2): the
 * slot contract end to end, with nothing faked but the server.
 *
 *   - a rest day's "Log a workout": Save posts the extra, the card draws
 *     "Extra workout · Gym · 45 min" from the answer and the sheet goes
 *   - yesterday's skipped row: "Log an extra workout" files it at noon of
 *     yesterday, and yesterday's card is updated in place
 *   - "No energy today": Skip with a reason marks today's card skipped
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { UiKitProvider } from '../../../../components/ui';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { decodeHealthDay, useHealthStore } from '../../../../health';
import * as healthLocalStore from '../../../../health/localStore';
import { translate } from '../../../../i18n';
import { addServerDays } from '../../../../i18n/format';
import TodaySection from '../../sections/Today';
import { attachPlanNavigator } from '../../shell/planShell';
import { dayJSON, freshPlan, memberProfile, settle, signIn, TODAY } from '../../__tests__/planFixtures';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);

const SESSION = '1d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a';
const YESTERDAY = addServerDays(TODAY, -1)!;

type Json = Record<string, unknown>;

function dayWith(date: string, session: Json): Json {
  return { ...dayJSON(date), day: { date, relative: date === TODAY ? 'today' : 'past', session: { scheduledFor: date, ...session } } };
}

function seed(days: Json[], selected: string = TODAY) {
  const decoded = days.map((json) => decodeHealthDay(json));
  useHealthStore.setState({
    today: decoded.find((day) => day.date === TODAY) ?? null,
    days: Object.fromEntries(decoded.map((day) => [day.date, day])),
    selectedDate: selected,
    loadState: { kind: 'loaded', at: new Date() },
    profileId: memberProfile().id,
  });
}

async function renderToday() {
  await render(
    <UiKitProvider>
      <TodaySection />
    </UiKitProvider>,
  );
  await act(async () => settle());
}

async function press(name: string) {
  await fireEvent.press(screen.getByRole('button', { name }));
  await act(async () => settle());
}

async function pressID(testID: string) {
  await fireEvent.press(screen.getByTestId(testID));
  await act(async () => settle());
}

beforeEach(() => {
  freshPlan();
  bottomSheetMock.reset();
  attachPlanNavigator({ navigate: jest.fn(), popToTop: jest.fn() });
  signIn();
});

afterEach(async () => {
  await settle();
  await healthLocalStore.settled();
});

it("a rest day's workout lands on the card as an extra, and the sheet goes", async () => {
  const restToday = dayWith(TODAY, { id: SESSION, kind: 'rest', status: 'rest', title: null, canLogExtra: true });
  seed([restToday]);
  api.on('GET', '/health', Reply.ok(restToday));
  api.on(
    'POST',
    `/health/sessions/${SESSION}`,
    Reply.ok({
      session: {
        id: SESSION,
        scheduledFor: TODAY,
        kind: 'rest',
        status: 'rest',
        canLogExtra: true,
        extras: [{ id: 'extra-0001', index: 0, minutes: 45, kind: 'strength', title: 'Gym', canRemove: true }],
      },
      changed: [],
    }),
  );
  await renderToday();
  await pressID('plan.logWorkout');
  expect(screen.getByRole('header', { name: en('logworkout.title') })).toBeOnTheScreen();

  await press('Gym');
  await press('45 minutes');
  await pressID('logworkout.save');

  expect(api.sent(`/health/sessions/${SESSION}`, 'POST').body).toEqual({ action: 'done', asExtra: true, kind: 'strength', minutes: 45 });
  expect(screen.queryByRole('header', { name: en('logworkout.title') })).toBeNull();
  expect(screen.getByText('Extra workout · Gym · 45 min')).toBeOnTheScreen();
  expect(useHealthStore.getState().today?.day?.session?.extras).toHaveLength(1);
  expect(useHealthStore.getState().toastKey).toBe('logworkout.saved');
});

it("yesterday's skipped row files the extra at noon of yesterday and updates that card", async () => {
  const today = dayWith(TODAY, { id: SESSION, kind: 'strength', status: 'planned', title: 'Full body', minutes: 40 });
  const skippedYesterday = dayWith(YESTERDAY, {
    id: 's-yday',
    kind: 'strength',
    title: 'Legs',
    status: 'skipped',
    skipReason: 'time',
    canLogExtra: true,
  });
  seed([today, skippedYesterday], YESTERDAY);
  api.on('GET', '/health', Reply.ok(today));
  api.on(
    'POST',
    '/health/sessions/s-yday',
    Reply.ok({
      session: {
        id: 's-yday',
        scheduledFor: YESTERDAY,
        kind: 'strength',
        title: 'Legs',
        status: 'skipped',
        skipReason: 'time',
        canLogExtra: true,
        extras: [{ id: 'extra-0002', index: 0, minutes: 30, kind: 'swim', title: 'Swim', canRemove: true }],
      },
      changed: [],
    }),
  );
  await renderToday();
  await press(en('logworkout.cta.extra'));
  expect(screen.getByTestId('logworkout.date')).toHaveTextContent('Yesterday');

  await press('Swim');
  await press('30 minutes');
  await pressID('logworkout.save');

  expect(api.sent('/health/sessions/s-yday', 'POST').body).toEqual({
    action: 'done',
    asExtra: true,
    kind: 'swim',
    minutes: 30,
    clientCompletedAt: `${YESTERDAY}T12:00:00Z`,
  });
  expect(useHealthStore.getState().days[YESTERDAY]?.day?.session?.extras).toHaveLength(1);
  expect(screen.getByText('Extra workout · Swim · 30 min')).toBeOnTheScreen();
});

it("No energy today, skipped with a reason, marks today's card skipped", async () => {
  const plannedToday = dayWith(TODAY, {
    id: SESSION,
    kind: 'strength',
    title: 'Full body strength',
    status: 'planned',
    minutes: 40,
    canMove: true,
    canSkip: true,
  });
  seed([plannedToday]);
  api.on('GET', '/health', Reply.ok(plannedToday));
  api.on(
    'POST',
    `/health/sessions/${SESSION}`,
    Reply.ok({
      session: { id: SESSION, scheduledFor: TODAY, kind: 'strength', title: 'Full body strength', status: 'skipped', skipReason: 'tired', canUndo: true },
      changed: [],
    }),
  );
  await renderToday();
  await press(en('plan.no_energy'));
  await press(en('noenergy.skip'));
  await press(en('noenergy.reason.tired'));
  await press(en('noenergy.skip_confirm'));

  expect(api.sent(`/health/sessions/${SESSION}`, 'POST').body).toEqual({ action: 'skip', skipReason: 'tired' });
  expect(screen.queryByRole('header', { name: en('noenergy.skip_title') })).toBeNull();
  expect(useHealthStore.getState().today?.day?.session?.status).toBe('skipped');
  expect(screen.getByText(en('plan.skipped.line', { reason: en('plan.skip_reason.tired') }))).toBeOnTheScreen();
});
