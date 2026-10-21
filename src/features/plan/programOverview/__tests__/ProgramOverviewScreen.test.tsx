/**
 * The programme overview (iOS ProgramOverviewView) in a real stack against
 * the stub server: the read in the account language (a late older read
 * dropped, a cancelled one keeping the skeleton), the error, the header, the
 * week picker and its notes, the day rows and their preview (PLAN-2's sheet
 * stood in for), and the three modes' actions (live: days, pause, resume,
 * end; proposal from a card: Start through the card's flow, Discard;
 * proposal from Plan's review row: both only go back; past: none).
 */
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { notificationsState } from '@test/mocks/expoNotifications';
import { api, Reply, type StubReply } from '@test/server';
import { Text } from 'react-native';

import { TransportError } from '../../../../api';
import { expectSentToMatchContract, stubApiClientPerTest } from '../../../../api/testing';
import { resetUiKit, UiKitProvider } from '../../../../components/ui';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { decodeHealthDay, fetchProgram, ReminderKeys, useHealthStore } from '../../../../health';
import { setCurrentLanguage, translate } from '../../../../i18n';
import { useIntentStore } from '../../../../stores/intentStore';
import { openRunner } from '../../../runner';
import { ChangeDaysHost } from '../../days';
import { noteReminderDraft, onProposalOutcome, resetProposalBridges } from '../../proposal/proposalActions';
import { dayJSON, freshPlan, MEMBER, memberProfile, settle, signIn, TODAY } from '../../__tests__/planFixtures';
import ProgramOverviewScreen from '../ProgramOverviewScreen';

import { setPreviewInstalled } from './fakePreviewSheet';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
// PLAN-2's sheet is on its own branch: a stand-in that keeps its promises.
jest.mock('../sessionPreview', () => {
  const actual = jest.requireActual('../sessionPreview');
  const fake = jest.requireActual('./fakePreviewSheet');
  return { ...actual, useSessionPreview: (testID?: string) => actual.useSessionPreview(testID, fake.installedSheet()) };
});
// The runner is a root modal this stack does not have: what Start asks of it is enough.
jest.mock('../../../runner', () => ({ ...jest.requireActual('../../../runner'), openRunner: jest.fn() }));
// The read itself, so one test can hand it a cancellation.
jest.mock('../../../../health', () => {
  const actual = jest.requireActual('../../../../health');
  return { ...actual, fetchProgram: jest.fn(actual.fetchProgram) };
});

stubApiClientPerTest();

const PROGRAM = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const en = (key: string, params?: Record<string, string>) => translate(key, 'en', params);
const button = (key: string, params?: Record<string, string>) => screen.getByRole('button', { name: en(key, params) });
const programPath = `/health/programs/${PROGRAM}`;

function detailJSON(extra: Record<string, unknown> = {}) {
  return {
    id: PROGRAM,
    status: 'active',
    summaryTitle: 'Stronger in four weeks',
    intro: 'Three short sessions a week.',
    weekNo: 2,
    weeks: 4,
    daysPerWeek: 2,
    trainingDays: [1, 4],
    startsOn: '2026-10-12',
    endsOn: '2026-11-08',
    revisionOf: null,
    weekPlans: [
      {
        weekNo: 1,
        days: [
          { id: 'w1-1', weekday: 1, scheduledFor: '2026-10-12', kind: 'strength', title: 'Legs', minutes: 40, status: 'done' },
          { id: 'w1-2', weekday: 2, scheduledFor: '2026-10-13', kind: 'rest' },
        ],
      },
      {
        weekNo: 2,
        note: 'A little more each set.',
        days: [
          { id: 'w2-1', weekday: 3, scheduledFor: TODAY, kind: 'strength', title: 'Upper body', minutes: 35, status: 'planned' },
          { id: 'w2-2', weekday: 4, scheduledFor: '2026-10-22', kind: 'rest' },
        ],
      },
      { weekNo: 3, deload: true, days: [] },
      { weekNo: 4, deload: true, days: [{ id: 'w4-1', weekday: 1, kind: 'mobility', title: 'Easy stretch', minutes: 20 }] },
    ],
    ...extra,
  };
}

const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();

function Root() {
  return <Text>root</Text>;
}

async function renderOverview(mode: 'live' | 'proposal' | 'past', options: { fromCard?: 'coach' | 'plan' } = {}) {
  const rootName = 'Root';
  await render(
    <NavigationContainer ref={navigationRef}>
      <UiKitProvider>
        <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName={rootName}>
          <Stack.Screen name={rootName} component={Root} />
          <Stack.Screen name="ProgramOverview" component={ProgramOverviewScreen as never} />
        </Stack.Navigator>
        <ChangeDaysHost />
      </UiKitProvider>
    </NavigationContainer>,
  );
  await act(async () => {
    (navigationRef.navigate as (name: string, params: object) => void)('ProgramOverview', { programId: PROGRAM, mode, ...options });
  });
  await act(async () => settle());
}

beforeEach(() => {
  freshPlan();
  resetProposalBridges();
  setPreviewInstalled(true);
  jest.mocked(openRunner).mockClear();
  notificationsState.reset();
  bottomSheetMock.reset();
  resetUiKit();
  signIn();
  useHealthStore.setState({
    today: decodeHealthDay(dayJSON(TODAY, { program: { id: PROGRAM, status: 'active', weekNo: 2, weeks: 4 } })),
    selectedDate: TODAY,
  });
  api.on('GET', '/health', Reply.ok(dayJSON(TODAY)));
});

afterEach(async () => {
  setCurrentLanguage('en');
  await AsyncStorage.clear();
});

describe('the read', () => {
  it('reads the programme in the account language and opens on its current week', async () => {
    api.on('GET', programPath, Reply.ok({ program: detailJSON() }));
    await renderOverview('live');
    expect(screen.getByRole('header', { name: en('plan.overview.title').toUpperCase() })).toBeOnTheScreen();
    expect(api.sent(programPath, 'GET').query.locale).toBe('en');
    expect(screen.getByRole('header', { name: 'Stronger in four weeks' })).toBeOnTheScreen();
    expect(screen.getByText('12 October to 8 November')).toBeOnTheScreen();
    expect(screen.getByText('Three short sessions a week.')).toBeOnTheScreen();
    expect(screen.getByText(en('health.disclaimer'))).toBeOnTheScreen();
    expect(screen.getByTestId('programOverview.week.2').props.accessibilityState.selected).toBe(true);
    expect(screen.getByText('A little more each set.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Wed, Upper body, 35 min, planned')).toBeOnTheScreen();
  });

  it('a failed read is the error with Try again, which reads again', async () => {
    api.on('GET', programPath, Reply.problem(500, 'internal_error'));
    await renderOverview('live');
    expect(screen.getByTestId('programOverview.error')).toBeOnTheScreen();
    api.on('GET', programPath, Reply.ok({ program: detailJSON() }));
    await fireEvent.press(screen.getByRole('button', { name: en('venue.try_again') }));
    expect(await screen.findByRole('header', { name: 'Stronger in four weeks' })).toBeOnTheScreen();
  });

  it('a new language reads again, and the older read answering late is dropped', async () => {
    let answerEnglish: (reply: StubReply) => void = () => undefined;
    api.on('GET', programPath, (request) =>
      request.query.locale === 'is'
        ? Reply.ok({ program: detailJSON({ summaryTitle: 'Sterkari á fjórum vikum' }) })
        : new Promise<StubReply>((resolve) => {
            answerEnglish = resolve;
          }),
    );
    await renderOverview('live');
    expect(screen.getByTestId('programOverview.loading')).toBeOnTheScreen();

    await act(async () => setCurrentLanguage('is'));
    expect(await screen.findByRole('header', { name: 'Sterkari á fjórum vikum' })).toBeOnTheScreen();
    await act(async () => {
      answerEnglish(Reply.ok({ program: detailJSON() }));
      await settle();
    });
    expect(screen.getByRole('header', { name: 'Sterkari á fjórum vikum' })).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Stronger in four weeks' })).toBeNull();
  });

  it('a cancelled first read keeps the skeleton (never an empty page)', async () => {
    jest.mocked(fetchProgram).mockImplementationOnce(() => Promise.reject(new TransportError('cancelled')));
    await renderOverview('live');
    expect(screen.getByTestId('programOverview.loading')).toBeOnTheScreen();
    expect(screen.queryByTestId('programOverview.error')).toBeNull();
  });
});

describe('the weeks', () => {
  it('a week shows its rows with their dates; the deload line only on the last week', async () => {
    api.on('GET', programPath, Reply.ok({ program: detailJSON() }));
    await renderOverview('live');
    await fireEvent.press(screen.getByTestId('programOverview.week.1'));
    expect(screen.getByLabelText('Mon, Legs, 40 min, done')).toBeOnTheScreen();
    expect(screen.getByText('Mon 12 Oct')).toBeOnTheScreen();
    expect(screen.queryByTestId('programOverview.deload')).toBeNull();

    await fireEvent.press(screen.getByTestId('programOverview.week.3'));
    expect(screen.queryByTestId('programOverview.deload')).toBeNull();
    await fireEvent.press(screen.getByTestId('programOverview.week.4'));
    expect(screen.getByText(en('plan.deload_note'))).toBeOnTheScreen();
  });

  it("a session opens its preview, with Start for today's planned session of a live plan", async () => {
    api.on('GET', programPath, Reply.ok({ program: detailJSON() }));
    api.on('GET', '/health/sessions/w2-1', Reply.ok({ session: { id: 'w2-1', kind: 'strength', scheduledFor: TODAY, status: 'planned', title: 'Upper body' } }));
    await renderOverview('live');
    expect(screen.queryByRole('button', { name: 'Thu, Rest day' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Wed, Upper body, 35 min, planned' }));
    expect(await screen.findByText('preview:w2-1')).toBeOnTheScreen();
    expect(api.sent('/health/sessions/w2-1', 'GET').query.locale).toBe('en');

    // Start: the sheet goes first, then the runner opens on today's session.
    await fireEvent.press(screen.getByRole('button', { name: 'preview start' }));
    await waitFor(() => expect(openRunner).toHaveBeenCalledWith(expect.objectContaining({ id: 'w2-1' }), 'today'));
    expect(screen.queryByText('preview:w2-1')).toBeNull();
  });

  it('a session another day offers no Start; each opening is its own sheet', async () => {
    api.on('GET', programPath, Reply.ok({ program: detailJSON() }));
    api.on('GET', '/health/sessions/w1-1', Reply.ok({ session: { id: 'w1-1', kind: 'strength', scheduledFor: '2026-10-12', status: 'done', title: 'Legs' } }));
    await renderOverview('live');
    await fireEvent.press(screen.getByTestId('programOverview.week.1'));
    await fireEvent.press(screen.getByRole('button', { name: 'Mon, Legs, 40 min, done' }));
    expect(await screen.findByText('preview:w1-1')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'preview start' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'preview close' }));
    expect(screen.queryByText('preview:w1-1')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Mon, Legs, 40 min, done' }));
    expect(await screen.findByText('preview:w1-1')).toBeOnTheScreen();
  });

  it("until PLAN-2's sheet is merged the rows are not buttons at all", async () => {
    setPreviewInstalled(false);
    api.on('GET', programPath, Reply.ok({ program: detailJSON() }));
    await renderOverview('live');
    expect(screen.getByLabelText('Wed, Upper body, 35 min, planned')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Wed, Upper body, 35 min, planned' })).toBeNull();
  });
});

describe('live mode', () => {
  it('Pause asks, posts the status alone, redraws, and reads Plan again', async () => {
    api.on('GET', programPath, Reply.ok({ program: detailJSON() }));
    api.on('POST', programPath, Reply.ok({ program: detailJSON({ status: 'paused' }) }));
    await renderOverview('live');
    await fireEvent.press(button('plan.overview.pause'));
    expect(await screen.findByText(en('plan.pause.body'))).toBeOnTheScreen();
    await fireEvent.press(button('plan.pause.confirm'));
    await waitFor(() => expect(api.sentAll(programPath, 'POST')).toHaveLength(1));
    expect(expectSentToMatchContract('POST', programPath).body).toEqual({ status: 'paused' });
    expect(await screen.findByRole('button', { name: en('plan.overview.resume') })).toBeOnTheScreen();
    await waitFor(() => expect(api.sentAll('/health', 'GET').length).toBeGreaterThan(0));
  });

  it('Resume posts at once; End asks and is destructive', async () => {
    api.on('GET', programPath, Reply.ok({ program: detailJSON({ status: 'paused' }) }));
    api.on('POST', programPath, Reply.ok({ program: detailJSON() }));
    await renderOverview('live');
    await fireEvent.press(button('plan.overview.resume'));
    await waitFor(() => expect(api.sent(programPath, 'POST').body).toEqual({ status: 'active' }));

    await fireEvent.press(await screen.findByRole('button', { name: en('plan.overview.end') }));
    expect(await screen.findByText(en('plan.end.body'))).toBeOnTheScreen();
    const ends = screen.getAllByRole('button', { name: en('plan.end.confirm') });
    await fireEvent.press(ends[ends.length - 1]!);
    await waitFor(() => expect(api.sentAll(programPath, 'POST').map((r) => r.body)).toEqual([{ status: 'active' }, { status: 'abandoned' }]));
  });

  it('Change training days saves through the days sheet and redraws the weeks', async () => {
    api.on('GET', programPath, Reply.ok({ program: detailJSON() }));
    api.on('POST', programPath, Reply.ok({ program: detailJSON({ summaryTitle: 'Moved to Tuesdays' }) }));
    await renderOverview('live');
    await fireEvent.press(button('plan.overview.change_days'));
    await fireEvent.press(screen.getByTestId('days.chip.1'));
    await fireEvent.press(screen.getByTestId('days.chip.2'));
    await fireEvent.press(screen.getByTestId('days.save'));
    expect(await screen.findByRole('header', { name: 'Moved to Tuesdays' })).toBeOnTheScreen();
    expect(api.sent(programPath, 'POST').body).toEqual({ trainingDays: [2, 4] });
  });
});

describe("proposal mode, from Plan's review row (iOS `.proposalReview`)", () => {
  const adoptPath = `${programPath}/adopt`;

  it('rows have no dates; Start only goes back: nothing posted, no permission asked', async () => {
    const outcomes: string[] = [];
    onProposalOutcome(PROGRAM, (outcome) => outcomes.push(outcome));
    useHealthStore.setState({
      today: decodeHealthDay(dayJSON(TODAY, { program: { id: 'live-1', status: 'active', weekNo: 2, weeks: 4 }, proposal: null })),
    });
    api.on('GET', programPath, Reply.ok({ program: detailJSON({ status: 'proposed', startsOn: null, endsOn: null }) }));
    api.on('POST', adoptPath, Reply.problem(409, 'program_already_active'));
    await renderOverview('proposal');
    await fireEvent.press(screen.getByTestId('programOverview.week.1'));
    expect(screen.queryByText('Mon 12 Oct')).toBeNull();
    expect(screen.queryByRole('button', { name: en('plan.overview.pause') })).toBeNull();

    await fireEvent.press(button('program.proposal.start'));
    expect(await screen.findByText('root')).toBeOnTheScreen();
    await act(async () => settle());
    expect(api.sentAll(adoptPath)).toHaveLength(0);
    expect(notificationsState.requestCount()).toBe(0);
    expect(screen.queryByText(en('program.replace.title'))).toBeNull();
    expect(useIntentStore.getState().pendingPlanAction).toBeNull();
    expect(outcomes).toEqual([]);
  });

  it('a revision is labelled Switch, and only goes back too', async () => {
    api.on('GET', programPath, Reply.ok({ program: detailJSON({ status: 'proposed', revisionOf: 'a1b2c3d4-0000-4000-8000-000000000001' }) }));
    await renderOverview('proposal');
    await fireEvent.press(button('program.revision.start'));
    expect(await screen.findByText('root')).toBeOnTheScreen();
    expect(screen.queryByText(en('program.revision.switch.title'))).toBeNull();
    expect(api.sentAll(adoptPath)).toHaveLength(0);
  });

  it('Discard only goes back: no question, nothing posted', async () => {
    api.on('GET', programPath, Reply.ok({ program: detailJSON({ status: 'proposed' }) }));
    await renderOverview('proposal');
    await fireEvent.press(button('program.proposal.discard'));
    expect(await screen.findByText('root')).toBeOnTheScreen();
    expect(screen.queryByText(en('program.discard.body'))).toBeNull();
    expect(api.sentAll(`${programPath}/discard`)).toHaveLength(0);
  });
});

describe("proposal mode, from a card's See all weeks (the card's flow)", () => {
  const adoptPath = `${programPath}/adopt`;

  it('rows have no dates; Start adopts, tells the card, and goes back', async () => {
    const outcomes: string[] = [];
    onProposalOutcome(PROGRAM, (outcome) => outcomes.push(outcome));
    api.on('GET', programPath, Reply.ok({ program: detailJSON({ status: 'proposed', startsOn: null, endsOn: null }) }));
    api.on('POST', adoptPath, Reply.ok({ program: { id: PROGRAM, status: 'active', startsOn: '2026-10-22', weekPlans: [] }, replaced: null }));
    await renderOverview('proposal', { fromCard: 'coach' });
    await fireEvent.press(screen.getByTestId('programOverview.week.1'));
    expect(screen.queryByText('Mon 12 Oct')).toBeNull();
    expect(screen.queryByRole('button', { name: en('plan.overview.pause') })).toBeNull();

    await fireEvent.press(button('program.proposal.start'));
    await waitFor(() => expect(outcomes).toEqual(['started']));
    expect(api.sent(adoptPath, 'POST').body).toEqual({ replaceActive: false });
    expect(useIntentStore.getState().pendingPlanAction?.action).toEqual({ kind: 'showAdoptedBanner', startsOn: '2026-10-22' });
    expect(await screen.findByText('root')).toBeOnTheScreen();
  });

  it('a running plan the store did not know of: the 409 asks to replace', async () => {
    api.on('GET', programPath, Reply.ok({ program: detailJSON({ status: 'proposed' }) }));
    api.on('POST', adoptPath, Reply.problem(409, 'program_already_active'));
    await renderOverview('proposal', { fromCard: 'coach' });
    await fireEvent.press(button('program.proposal.start'));
    expect(await screen.findByText(en('program.replace.body'))).toBeOnTheScreen();
  });

  it('a revision is switched to, and asks first', async () => {
    api.on('GET', programPath, Reply.ok({ program: detailJSON({ status: 'proposed', revisionOf: 'a1b2c3d4-0000-4000-8000-000000000001', startsOnIfAdoptedNow: '2026-10-22' }) }));
    await renderOverview('proposal', { fromCard: 'plan' });
    await fireEvent.press(button('program.revision.start'));
    expect(await screen.findByText(en('program.revision.switch.title'))).toBeOnTheScreen();
    expect(api.sentAll(adoptPath)).toHaveLength(0);
  });

  it('Discard asks, discards, tells the card, and goes back', async () => {
    const outcomes: string[] = [];
    onProposalOutcome(PROGRAM, (outcome) => outcomes.push(outcome));
    api.on('GET', programPath, Reply.ok({ program: detailJSON({ status: 'proposed' }) }));
    api.on('POST', `${programPath}/discard`, Reply.ok({ ok: true }));
    await renderOverview('proposal', { fromCard: 'coach' });
    await fireEvent.press(button('program.proposal.discard'));
    expect(await screen.findByText(en('program.discard.body'))).toBeOnTheScreen();
    const discards = screen.getAllByRole('button', { name: en('program.discard.confirm') });
    await fireEvent.press(discards[discards.length - 1]!);
    await waitFor(() => expect(outcomes).toEqual(['discarded']));
    expect(await screen.findByText('root')).toBeOnTheScreen();
  });

  it("Start sends the opening card's reminder choice: switched off, no permission is asked", async () => {
    noteReminderDraft(PROGRAM, { remindersOn: false, minutes: 480 }, {});
    api.on('GET', programPath, Reply.ok({ program: detailJSON({ status: 'proposed' }) }));
    api.on('POST', adoptPath, Reply.ok({ program: { id: PROGRAM, status: 'active', startsOn: '2026-10-22', weekPlans: [] }, replaced: null }));
    await renderOverview('proposal', { fromCard: 'plan' });
    await fireEvent.press(button('program.proposal.start'));
    await waitFor(async () => expect(await AsyncStorage.getItem(ReminderKeys.workoutDay(MEMBER))).toBe('false'));
    expect(await AsyncStorage.getItem(ReminderKeys.time(MEMBER))).toBe('480');
    expect(notificationsState.requestCount()).toBe(0);
  });
});

describe('past mode', () => {
  it('a past plan: its kicker and title, no actions, no Start in a preview', async () => {
    signIn(memberProfile());
    api.on('GET', programPath, Reply.ok({ program: detailJSON({ status: 'completed' }) }));
    api.on('GET', '/health/sessions/w2-1', Reply.ok({ session: { id: 'w2-1', kind: 'strength', scheduledFor: TODAY, status: 'planned' } }));
    await renderOverview('past');
    expect(screen.getByRole('header', { name: en('plan.past_plan').toUpperCase() })).toBeOnTheScreen();
    expect(screen.getAllByText(en('plan.past_plan').toUpperCase())).toHaveLength(2);
    expect(screen.queryByRole('button', { name: en('plan.overview.end') })).toBeNull();
    expect(screen.queryByRole('button', { name: en('program.proposal.start') })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Wed, Upper body, 35 min, planned' }));
    expect(await screen.findByText('preview:w2-1')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'preview start' })).toBeNull();
  });
});
