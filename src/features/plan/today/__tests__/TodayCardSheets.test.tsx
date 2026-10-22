/**
 * The Today card as host of PLAN-3's two sheets (iOS PlanTodayCard's
 * `.sheet(item:)`), against stand-ins built to the slot contract that never
 * close themselves:
 *
 *   - an answer patches the card and the CARD closes the sheet, as iOS's
 *     dismiss() after onResult; "changed elsewhere" reads again and closes
 *   - every opening is a new sheet (fresh state), as `.sheet(item:)` builds
 *     a new view per presentation
 *   - an answer that lands after the member opened another sheet applies,
 *     and leaves the newer sheet up
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { UiKitProvider } from '../../../../components/ui';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { decodeHealthDay, decodeSessionActionResponse, useHealthStore } from '../../../../health';
import * as healthLocalStore from '../../../../health/localStore';
import { translate } from '../../../../i18n';
import { addServerDays } from '../../../../i18n/format';
import TodaySection from '../../sections/Today';
import { attachPlanNavigator } from '../../shell/planShell';
import { dayJSON, freshPlan, memberProfile, settle, signIn, TODAY } from '../../__tests__/planFixtures';

import { fakeSheets, resetFakeSheets } from './fakePlan3Sheets';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('../../sheets/NoEnergySheet', () => require('./fakePlan3Sheets').noEnergyModule);
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('../../sheets/LogWorkoutSheet', () => require('./fakePlan3Sheets').logWorkoutModule);

stubApiClientPerTest();

const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);

const SESSION = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const YESTERDAY = addServerDays(TODAY, -1)!;

type Json = Record<string, unknown>;

function dayWith(date: string, session: Json): Json {
  return { ...dayJSON(date), day: { date, relative: date === TODAY ? 'today' : 'past', session: { scheduledFor: date, ...session } } };
}

const plannedToday = dayWith(TODAY, { id: SESSION, kind: 'strength', title: 'Full body strength', status: 'planned', minutes: 40 });
const restToday = dayWith(TODAY, { id: SESSION, kind: 'rest', status: 'rest', title: null, canLogExtra: true });
const missedYesterday = dayWith(YESTERDAY, { id: 's-missed', kind: 'strength', title: 'Legs', status: 'missed', canSkip: true });

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

/** A session action's answer for today's session, decoded as the API client hands it over. */
function answer(session: Json) {
  return decodeSessionActionResponse({
    session: { id: SESSION, scheduledFor: TODAY, kind: 'strength', title: 'Full body strength', ...session },
    week: dayJSON().week,
    upcoming: [],
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

async function tap(label: string) {
  await fireEvent.press(screen.getByRole('button', { name: label }));
  await act(async () => settle());
}

beforeEach(() => {
  freshPlan();
  resetFakeSheets();
  bottomSheetMock.reset();
  attachPlanNavigator({ navigate: jest.fn(), popToTop: jest.fn() });
  signIn();
  api.on('GET', '/health', Reply.ok(plannedToday));
});

afterEach(async () => {
  await settle();
  await healthLocalStore.settled();
});

describe('No energy', () => {
  it("the answer patches today's card and the card closes the sheet", async () => {
    seed([plannedToday]);
    await renderToday();
    await tap(en('plan.no_energy'));
    expect(screen.getByTestId('fake.noEnergy')).toBeOnTheScreen();

    fakeSheets.result = answer({ status: 'skipped', skipReason: 'tired', canUndo: true });
    await tap('no energy: answered');
    expect(screen.queryByTestId('fake.noEnergy')).toBeNull();
    expect(screen.getByText(en('plan.skipped.line', { reason: en('plan.skip_reason.tired') }))).toBeOnTheScreen();
    expect(useHealthStore.getState().today?.day?.session?.status).toBe('skipped');
  });

  it('changed elsewhere says so, reads the day again and closes the sheet', async () => {
    seed([plannedToday]);
    await renderToday();
    await tap(en('plan.no_energy'));
    await tap('no energy: changed elsewhere');
    expect(screen.queryByTestId('fake.noEnergy')).toBeNull();
    expect(useHealthStore.getState().toastKey).toBe('health.err.changed');
    await waitFor(() => expect(api.sentAll('/health').length).toBeGreaterThan(0));
  });
});

describe('Log a workout', () => {
  it('the answer patches the rest day and the card closes the sheet', async () => {
    seed([restToday]);
    await renderToday();
    await fireEvent.press(screen.getByTestId('plan.logWorkout'));
    await act(async () => settle());
    expect(screen.getByTestId('fake.logWorkout')).toBeOnTheScreen();

    fakeSheets.result = answer({
      kind: 'rest',
      status: 'rest',
      title: null,
      extras: [{ id: 'extra-0001', index: 0, minutes: 45, kind: 'strength', title: 'Gym', canRemove: true }],
    });
    await tap('log workout: answered');
    expect(screen.queryByTestId('fake.logWorkout')).toBeNull();
    expect(screen.getByText('Extra workout · Gym · 45 min')).toBeOnTheScreen();
  });

  it('changed elsewhere reads the day again and closes the sheet', async () => {
    seed([restToday]);
    await renderToday();
    await fireEvent.press(screen.getByTestId('plan.logWorkout'));
    await act(async () => settle());
    await tap('log workout: changed elsewhere');
    expect(screen.queryByTestId('fake.logWorkout')).toBeNull();
    await waitFor(() => expect(api.sentAll('/health').length).toBeGreaterThan(0));
  });
});

describe('every opening is a new sheet', () => {
  it("Skip it on yesterday's missed row, cancelled, then No energy today opens fresh in move mode", async () => {
    seed([plannedToday, missedYesterday], YESTERDAY);
    await renderToday();
    await tap(en('plan.skip_it'));
    expect(screen.getByText('skip mode')).toBeOnTheScreen();
    expect(screen.getByText('session s-missed')).toBeOnTheScreen();
    expect(screen.getByText('mount 1')).toBeOnTheScreen();
    await tap('no energy: swipe down');
    expect(screen.queryByTestId('fake.noEnergy')).toBeNull();

    // The week strip back on today: the same card, another day.
    await act(async () => useHealthStore.setState({ selectedDate: TODAY }));
    await tap(en('plan.no_energy'));
    expect(screen.getByText('move mode')).toBeOnTheScreen();
    expect(screen.getByText(`session ${SESSION}`)).toBeOnTheScreen();
    expect(screen.getByText('mount 2')).toBeOnTheScreen();
  });

  it('an answer from a sheet the member already put away leaves the newer sheet up', async () => {
    seed([plannedToday]);
    await renderToday();
    await tap(en('plan.no_energy'));
    const first = fakeSheets.noEnergy!;
    await tap('no energy: swipe down');
    await tap(en('plan.no_energy'));
    expect(screen.getByText('mount 2')).toBeOnTheScreen();

    // The first sheet's move answers only now: it applies, and the second stays.
    await act(async () => first.onResult(answer({ status: 'skipped', skipReason: 'time', canUndo: true })));
    expect(useHealthStore.getState().today?.day?.session?.status).toBe('skipped');
    expect(screen.getByTestId('fake.noEnergy')).toBeOnTheScreen();
  });
});
