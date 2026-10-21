/**
 * Plan's "This plan" section (iOS PlanOverviewCard inside PlanView) against
 * the real health store and the stub server: what it says, the pause and
 * end confirmations, resume at once, every body a status alone, the rows
 * refused offline or for a finished block, and where each tap leads.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, Reply } from '@test/server';

import { expectSentToMatchContract, stubApiClientPerTest } from '../../../../api/testing';
import { TransportError } from '../../../../api';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { decodeHealthDay, useHealthStore } from '../../../../health';
import { translate } from '../../../../i18n';
import * as bodySheets from '../../../body/sheets';
import { useChangeDaysPresenter } from '../../days/presenter';
import { ChangeDaysHost } from '../../days';
import OverviewSection from '../../sections/Overview';
import { attachPlanNavigator } from '../../shell/planShell';
import { dayJSON, freshPlan, memberProfile, signIn, TODAY } from '../../__tests__/planFixtures';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const PROGRAM = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const en = (key: string, params?: Record<string, string>) => translate(key, 'en', params);
const button = (key: string, params?: Record<string, string>) => screen.getByRole('button', { name: en(key, params) });

function program(extra: Record<string, unknown> = {}) {
  return {
    id: PROGRAM,
    status: 'active',
    summaryTitle: 'Stronger in four weeks',
    weekNo: 2,
    weeks: 4,
    daysPerWeek: 3,
    trainingDays: [5, 1, 3],
    startsOn: '2026-10-05',
    endsOn: '2026-11-01',
    targets: { kcalLow: 1800, kcalHigh: 2100, proteinG: 120 },
    ...extra,
  };
}

function setDay(programJSON: Record<string, unknown> | null) {
  useHealthStore.setState({
    today: decodeHealthDay(dayJSON(TODAY, { program: programJSON })),
    selectedDate: TODAY,
    loadState: { kind: 'loaded', at: new Date(0) },
  });
}

const navigate = jest.fn();

async function renderSection() {
  await render(
    <>
      <OverviewSection />
      <ChangeDaysHost />
    </>,
  );
}

beforeEach(() => {
  freshPlan();
  bottomSheetMock.reset();
  navigate.mockReset();
  attachPlanNavigator({ navigate, popToTop: jest.fn() });
  signIn();
  api.on('GET', '/health', Reply.ok(dayJSON(TODAY, { program: program() })));
});

describe('what it says', () => {
  it('the title, the dates, the days in order, the target with its Estimate chip', async () => {
    setDay(program());
    await renderSection();
    expect(screen.getByText(en('plan.overview.kicker').toUpperCase())).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Stronger in four weeks' })).toBeOnTheScreen();
    expect(screen.getByText('5 October to 1 November')).toBeOnTheScreen();
    expect(screen.getByText('Days: Mon, Wed, Fri')).toBeOnTheScreen();
    expect(screen.getByText('About 1,800 to 2,100 kcal a day, 120 g protein')).toBeOnTheScreen();
    expect(screen.getByText(en('health.estimate'))).toBeOnTheScreen();
    expect(button('plan.overview.see_all', { weeks: '4' })).toBeEnabled();
  });

  it('nothing for a day without a programme', async () => {
    setDay(null);
    await renderSection();
    expect(screen.queryByText(en('plan.overview.kicker').toUpperCase())).toBeNull();
  });

  it('a plan with no title is "Your plan"; a gentle plan says so instead of a target', async () => {
    setDay(program({ summaryTitle: null, planType: 'gentle' }));
    await renderSection();
    expect(screen.getByRole('header', { name: en('plan.overview.title') })).toBeOnTheScreen();
    expect(screen.getByText(en('plan.overview.gentle'))).toBeOnTheScreen();
    expect(screen.queryByText(en('health.estimate'))).toBeNull();
  });
});

describe('the decisions', () => {
  it('Pause asks first, then posts the status alone and reads Plan again', async () => {
    api.on('POST', `/health/programs/${PROGRAM}`, Reply.ok({ program: null }));
    setDay(program());
    await renderSection();

    await fireEvent.press(button('plan.overview.pause'));
    expect(await screen.findByRole('header', { name: en('plan.pause.title') })).toBeOnTheScreen();
    expect(screen.getByText(en('plan.pause.body'))).toBeOnTheScreen();
    expect(api.sentAll(`/health/programs/${PROGRAM}`)).toHaveLength(0);

    await fireEvent.press(button('plan.pause.confirm'));
    await waitFor(() => expect(api.sentAll(`/health/programs/${PROGRAM}`, 'POST')).toHaveLength(1));
    const sent = expectSentToMatchContract('POST', `/health/programs/${PROGRAM}`);
    expect(sent.body).toEqual({ status: 'paused' });
    await waitFor(() => expect(api.sentAll('/health', 'GET').length).toBeGreaterThan(0));
  });

  it('End asks with the history line, and Cancel sends nothing', async () => {
    setDay(program());
    await renderSection();
    await fireEvent.press(button('plan.overview.end'));
    expect(await screen.findByText(en('plan.end.body'))).toBeOnTheScreen();
    await fireEvent.press(button('common.cancel'));
    expect(api.sentAll(`/health/programs/${PROGRAM}`)).toHaveLength(0);

    api.on('POST', `/health/programs/${PROGRAM}`, Reply.ok({ program: null }));
    await fireEvent.press(button('plan.overview.end'));
    // The sheet's Confirm says "End plan" too: the last button of that name is the sheet's.
    await waitFor(() => expect(screen.getAllByRole('button', { name: en('plan.end.confirm') })).toHaveLength(2));
    await fireEvent.press(screen.getAllByRole('button', { name: en('plan.end.confirm') })[1]!);
    await waitFor(() => expect(api.sent(`/health/programs/${PROGRAM}`, 'POST').body).toEqual({ status: 'abandoned' }));
  });

  it('a paused plan offers Resume, which needs no confirmation', async () => {
    api.on('POST', `/health/programs/${PROGRAM}`, Reply.ok({ program: null }));
    setDay(program({ status: 'paused' }));
    await renderSection();
    await fireEvent.press(button('plan.overview.resume'));
    await waitFor(() => expect(api.sent(`/health/programs/${PROGRAM}`, 'POST').body).toEqual({ status: 'active' }));
    expect(screen.queryByText(en('plan.pause.body'))).toBeNull();
  });

  it('offline: every decision is refused and the card says why; See all weeks still opens', async () => {
    setDay(program());
    useHealthStore.setState({ lastError: new TransportError('offline') });
    await renderSection();
    expect(screen.getByText(en('health.offline.action_hint'))).toBeOnTheScreen();
    for (const key of ['plan.overview.pause', 'plan.overview.end', 'plan.overview.change_days']) {
      expect(button(key)).toBeDisabled();
    }
    await fireEvent.press(button('plan.overview.see_all', { weeks: '4' }));
    expect(navigate).toHaveBeenCalledWith('ProgramOverview', { programId: PROGRAM, mode: 'live' });
  });

  it('a finished block greys the decisions', async () => {
    setDay(program({ status: 'completed' }));
    await renderSection();
    expect(button('plan.overview.pause')).toBeDisabled();
    expect(button('plan.overview.end')).toBeDisabled();
  });

  it('a member who is not entitled (past due) reads only', async () => {
    signIn(memberProfile({ access: 'past_due' }));
    setDay(program({ targets: null }));
    await renderSection();
    expect(button('plan.overview.pause')).toBeDisabled();
    expect(button('plan.overview.change_days')).toBeDisabled();
    expect(button('plan.overview.no_targets')).toBeDisabled();
    expect(button('plan.overview.see_all', { weeks: '4' })).toBeEnabled();
  });
});

describe('where the rows lead', () => {
  it('Change opens the days sheet for this programme; a save reads Plan again', async () => {
    api.on('POST', `/health/programs/${PROGRAM}`, Reply.ok({ program: null }));
    setDay(program());
    await renderSection();
    await fireEvent.press(button('plan.overview.change_days'));
    const request = useChangeDaysPresenter.getState().request;
    expect(request?.mode).toMatchObject({ kind: 'program', programId: PROGRAM, daysPerWeek: 3, selected: [5, 1, 3] });
    await fireEvent.press(screen.getByTestId('days.save'));
    await waitFor(() => expect(api.sent(`/health/programs/${PROGRAM}`, 'POST').body).toEqual({ trainingDays: [1, 3, 5] }));
    await waitFor(() => expect(api.sentAll('/health', 'GET').length).toBeGreaterThan(0));
  });

  it('a change refused as changed elsewhere raises the toast and reads again', async () => {
    api.on('POST', `/health/programs/${PROGRAM}`, Reply.problem(409, 'program_action_not_allowed'));
    setDay(program());
    await renderSection();
    await fireEvent.press(button('plan.overview.change_days'));
    await fireEvent.press(screen.getByTestId('days.save'));
    await waitFor(() => expect(api.sentAll('/health', 'GET').length).toBeGreaterThan(0));
  });

  it('no targets: the invitation opens the body sheet for this programme', async () => {
    const spy = jest.spyOn(bodySheets, 'openBodySheet').mockImplementation(() => undefined);
    setDay(program({ targets: null }));
    await renderSection();
    await act(async () => fireEvent.press(button('plan.overview.no_targets')));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ kind: 'update', programId: PROGRAM }));
    spy.mockRestore();
  });
});
