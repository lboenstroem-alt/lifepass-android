/**
 * The proposal card (iOS ProgramProposalCard) in both palettes, against the
 * real health store, intent store and stub server: what it shows, Start in
 * each of its three shapes (adopt, replace, switch), the 409 that asks the
 * replace question, the reminder permission and preferences (written only
 * after a successful adopt), the refusals, Not now and Discard, the
 * collapsed outcomes, Change days redrawing the card, an outcome decided
 * in the weeks screen, and the reminder choice it lends that screen (only
 * while the card is on screen).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { notificationsState } from '@test/mocks/expoNotifications';
import { api, Reply } from '@test/server';
import { Text } from 'react-native';

import { expectSentToMatchContract, stubApiClientPerTest } from '../../../../api/testing';
import { resetUiKit, UiKitProvider } from '../../../../components/ui';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { decodeHealthDay, decodeHealthProposal, ReminderKeys, useHealthStore } from '../../../../health';
import { translate } from '../../../../i18n';
import { setAnalyticsObserver } from '../../../../lib/analytics';
import { useIntentStore } from '../../../../stores/intentStore';
import { ChangeDaysHost } from '../../days';
import { readAdoptedBannerKey, reminderDeniedKey } from '../../shell/adoptedBanner';
import { dayJSON, freshPlan, MEMBER, recordAnalytics, settle, signIn, TODAY } from '../../__tests__/planFixtures';
import ProgramProposalCard, { type ProgramProposalCardProps } from '../ProgramProposalCard';
import { setPreviewInstalled } from '../../programOverview/__tests__/fakePreviewSheet';
import { reminderDraft, reportProposalOutcome, resetProposalBridges } from '../proposalActions';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
// PLAN-2's sheet is on its own branch: a stand-in that keeps its promises.
jest.mock('../../programOverview/sessionPreview', () => {
  const actual = jest.requireActual('../../programOverview/sessionPreview');
  const fake = jest.requireActual('../../programOverview/__tests__/fakePreviewSheet');
  return { ...actual, useSessionPreview: (testID?: string) => actual.useSessionPreview(testID, fake.installedSheet()) };
});

stubApiClientPerTest();

const PROPOSAL = '0b7d6a52-1c3e-4f5a-9b8c-7d6e5f4a3b2c';
const LIVE = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const en = (key: string, params?: Record<string, string>) => translate(key, 'en', params);
const button = (key: string, params?: Record<string, string>) => screen.getByRole('button', { name: en(key, params) });
const adoptPath = `/health/programs/${PROPOSAL}/adopt`;

function proposalJSON(extra: Record<string, unknown> = {}) {
  return {
    id: PROPOSAL,
    status: 'proposed',
    summaryTitle: 'Four weeks to stronger legs',
    weeks: 4,
    daysPerWeek: 3,
    trainingDays: [5, 1, 3],
    typicalMinutes: 40,
    startsOnIfAdoptedNow: '2026-10-22',
    targets: { kcalLow: 1800, kcalHigh: 2100, proteinG: 120 },
    revisionOf: null,
    week1: [
      { id: 's-1', weekday: 1, kind: 'strength', title: 'Legs', minutes: 40 },
      { id: 's-2', weekday: 2, kind: 'rest' },
      { id: 's-3', weekday: 3, kind: 'cardio', title: 'Easy run', minutes: 30 },
    ],
    ...extra,
  };
}

function setDay(options: { proposal?: Record<string, unknown> | null; live?: boolean } = {}) {
  useHealthStore.setState({
    today: decodeHealthDay(
      dayJSON(TODAY, {
        program: options.live ? { id: LIVE, status: 'active', weekNo: 2, weeks: 4 } : null,
        proposal: options.proposal === undefined ? proposalJSON() : options.proposal,
      }),
    ),
    selectedDate: TODAY,
    loadState: { kind: 'loaded', at: new Date(0) },
  });
}

function adopted(startsOn = '2026-10-22', replaced: { id: string } | null = null) {
  return Reply.ok({ program: { id: PROPOSAL, status: 'active', startsOn, weekPlans: [] }, week: null, day: null, upcoming: [], replaced });
}

const Stack = createNativeStackNavigator();

function StandIn({ route }: { route: { name: string; params?: object } }) {
  return <Text>{`route:${route.name}:${JSON.stringify(route.params ?? {})}`}</Text>;
}

async function renderCard(props: Partial<ProgramProposalCardProps> = {}) {
  const Card = () => <ProgramProposalCard palette="plan" {...props} />;
  await render(
    <NavigationContainer>
      <UiKitProvider>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Card" component={Card} />
          <Stack.Screen name="ProgramOverview" component={StandIn as never} />
        </Stack.Navigator>
        <ChangeDaysHost />
      </UiKitProvider>
    </NavigationContainer>,
  );
  await act(async () => settle());
}

beforeEach(() => {
  freshPlan();
  resetProposalBridges();
  setPreviewInstalled(true);
  bottomSheetMock.reset();
  resetUiKit();
  notificationsState.reset();
  signIn();
  api.on('GET', '/health', Reply.ok(dayJSON(TODAY, { program: null, proposal: null })));
});

afterEach(async () => {
  await AsyncStorage.clear();
});

describe('what it shows', () => {
  it('the plan, week one, the target with its Estimate chip, the disclaimer and the reminder', async () => {
    setDay();
    await renderCard();
    expect(screen.getByText(en('program.proposal.kicker', { weeks: '4' }).toUpperCase())).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Four weeks to stronger legs' })).toBeOnTheScreen();
    expect(screen.getByText('Mon, Wed, Fri · about 40 min')).toBeOnTheScreen();
    expect(screen.getByLabelText('Mon, Legs, 40 min')).toBeOnTheScreen();
    expect(screen.getByLabelText('Tue, Rest day')).toBeOnTheScreen();
    expect(screen.getByText('About 1,800 to 2,100 kcal a day, 120 g protein')).toBeOnTheScreen();
    expect(screen.getByText(en('health.estimate'))).toBeOnTheScreen();
    expect(screen.getByText(en('health.disclaimer'))).toBeOnTheScreen();
    expect(screen.getByRole('switch', { name: en('program.proposal.reminders') }).props.accessibilityState.checked).toBe(true);
    expect(screen.getByText('07:00')).toBeOnTheScreen();
    expect(button('program.proposal.start')).toBeEnabled();
  });

  it('nothing without a proposal', async () => {
    setDay({ proposal: null });
    await renderCard();
    expect(screen.queryByTestId('program.proposal')).toBeNull();
  });

  it('a proposal named by id and not in the Today read is read whole', async () => {
    setDay({ proposal: null });
    api.on(
      'GET',
      `/health/programs/${PROPOSAL}`,
      Reply.ok({ program: { ...proposalJSON(), week1: undefined, weekPlans: [{ weekNo: 1, days: proposalJSON().week1 }] } }),
    );
    await renderCard({ programId: PROPOSAL });
    expect(await screen.findByRole('header', { name: 'Four weeks to stronger legs' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Wed, Easy run, 30 min')).toBeOnTheScreen();
    expect(api.sent(`/health/programs/${PROPOSAL}`, 'GET').query.locale).toBe('en');
  });

  it('a session row opens its preview (no Start from a proposal); a rest row is not a button', async () => {
    api.on('GET', '/health/sessions/s-1', Reply.ok({ session: { id: 's-1', kind: 'strength', scheduledFor: TODAY, status: 'planned', title: 'Legs', blocks: [] } }));
    setDay();
    await renderCard();
    expect(screen.getByRole('button', { name: 'Mon, Legs, 40 min' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Tue, Rest day' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Mon, Legs, 40 min' }));
    expect(await screen.findByText('preview:s-1')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'preview start' })).toBeNull();
    expect(api.sent('/health/sessions/s-1', 'GET').query.locale).toBe('en');
  });

  it("until PLAN-2's sheet is merged the rows are not buttons at all", async () => {
    setPreviewInstalled(false);
    setDay();
    await renderCard();
    expect(screen.queryByRole('button', { name: 'Mon, Legs, 40 min' })).toBeNull();
    expect(screen.getByLabelText('Mon, Legs, 40 min')).toBeOnTheScreen();
  });

  it('on Plan, Not now never collapses the card: Plan reads again', async () => {
    setDay();
    await renderCard();
    await fireEvent.press(button('program.proposal.not_now'));
    await waitFor(() => expect(api.sentAll('/health', 'GET').length).toBeGreaterThan(0));
    expect(screen.queryByText(en('program.proposal.saved'))).toBeNull();
  });

  it("See all weeks opens the programme overview in proposal mode, as this card's", async () => {
    setDay();
    await renderCard();
    await fireEvent.press(button('program.proposal.see_all'));
    expect(
      await screen.findByText(`route:ProgramOverview:${JSON.stringify({ programId: PROPOSAL, mode: 'proposal', fromCard: 'plan' })}`),
    ).toBeOnTheScreen();
  });

  it('waits for the stored choice: nothing drawn at the defaults first, so a toggle stored off never flips', async () => {
    await AsyncStorage.multiSet([
      [ReminderKeys.workoutDay(MEMBER), 'false'],
      [ReminderKeys.time(MEMBER), '480'],
    ]);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The storage mock's getItem is a jest.fn already: hold its own implementation back until `release`.
    const getItem = jest.mocked(AsyncStorage.getItem);
    const read = getItem.getMockImplementation()!;
    getItem.mockImplementation((...args) => gate.then(() => read(...args)));
    try {
      setDay();
      await renderCard();
      expect(screen.queryByTestId('program.proposal')).toBeNull();
      expect(screen.queryByRole('switch')).toBeNull();

      await act(async () => {
        release();
        await settle();
      });
      expect(screen.getByRole('switch', { name: en('program.proposal.reminders') }).props.accessibilityState.checked).toBe(false);
      expect(screen.getByText('08:00')).toBeOnTheScreen();
    } finally {
      getItem.mockImplementation(read);
    }
  });
});

describe("the reminder choice the weeks screen's Start sends", () => {
  it('is the card\'s toggle while the card is on screen, noted again as See all weeks opens', async () => {
    setDay();
    await renderCard();
    expect(reminderDraft(PROPOSAL)).toEqual({ remindersOn: true, minutes: 420 });
    await fireEvent.press(screen.getByRole('switch', { name: en('program.proposal.reminders') }));
    await fireEvent.press(button('program.proposal.see_all'));
    expect(reminderDraft(PROPOSAL)).toEqual({ remindersOn: false, minutes: 420 });
  });

  it('goes with the card: toggled off, then Not now in the Coach, nothing is remembered', async () => {
    setDay();
    await renderCard({ palette: 'coach' });
    await fireEvent.press(screen.getByRole('switch', { name: en('program.proposal.reminders') }));
    expect(reminderDraft(PROPOSAL)).toEqual({ remindersOn: false, minutes: 420 });
    await fireEvent.press(button('program.proposal.not_now'));
    expect(screen.getByText(en('program.proposal.saved'))).toBeOnTheScreen();
    expect(reminderDraft(PROPOSAL)).toBeNull();
  });

  it('goes when the card unmounts', async () => {
    setDay();
    await renderCard();
    expect(reminderDraft(PROPOSAL)).not.toBeNull();
    await act(async () => screen.unmount());
    expect(reminderDraft(PROPOSAL)).toBeNull();
  });
});

describe('Start', () => {
  it('with no live plan: asks for notifications, adopts, writes the reminders, and hands Plan the banner', async () => {
    const events = recordAnalytics();
    notificationsState.answerNextRequestWith('granted');
    api.on('POST', adoptPath, adopted('2026-10-22'));
    setDay();
    await renderCard();

    await fireEvent.press(button('program.proposal.start'));
    await waitFor(() => expect(api.sentAll(adoptPath, 'POST')).toHaveLength(1));
    const sent = expectSentToMatchContract('POST', adoptPath);
    expect(sent.body).toEqual({ replaceActive: false });
    expect(sent.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(notificationsState.requestCount()).toBe(1);

    await waitFor(() => expect(useIntentStore.getState().pendingPlanAction?.action).toEqual({ kind: 'showAdoptedBanner', startsOn: '2026-10-22' }));
    expect(useIntentStore.getState().pendingTab).toBe('Plan');
    expect(await AsyncStorage.getItem(ReminderKeys.workoutDay(MEMBER))).toBe('true');
    expect(await AsyncStorage.getItem(ReminderKeys.time(MEMBER))).toBe('420');
    expect(await AsyncStorage.getItem(reminderDeniedKey(MEMBER))).toBe('false');
    expect(await readAdoptedBannerKey(MEMBER)).toBe('plan.adopted.banner');
    expect(events.map((e) => [e.event, e.params])).toEqual(
      expect.arrayContaining([
        ['program_proposal_action', { action: 'start' }],
        ['program_adopted', { entry: 'plan', replaced: false }],
      ]),
    );
  });

  it('a 409 program_already_active asks to replace, then posts again with replaceActive and a new key', async () => {
    api.on('POST', adoptPath, Reply.problem(409, 'program_already_active'));
    setDay();
    await renderCard();
    await fireEvent.press(button('program.proposal.start'));
    expect(await screen.findByText(en('program.replace.body'))).toBeOnTheScreen();

    api.on('POST', adoptPath, adopted('2026-10-22', { id: LIVE }));
    await fireEvent.press(button('program.replace.confirm'));
    await waitFor(() => expect(api.sentAll(adoptPath, 'POST')).toHaveLength(2));
    const [first, second] = api.sentAll(adoptPath, 'POST');
    expect(first!.body).toEqual({ replaceActive: false });
    expect(second!.body).toEqual({ replaceActive: true });
    expect(second!.headers['idempotency-key']).not.toBe(first!.headers['idempotency-key']);
    await waitFor(() => expect(useIntentStore.getState().pendingTab).toBe('Plan'));
  });

  it('a live plan known: the replace question comes first, and Cancel sends nothing', async () => {
    setDay({ live: true });
    await renderCard();
    await fireEvent.press(button('program.proposal.start'));
    expect(await screen.findByText(en('program.replace.title'))).toBeOnTheScreen();
    await fireEvent.press(button('common.cancel'));
    await act(async () => settle());
    expect(api.sentAll(adoptPath)).toHaveLength(0);
  });

  it('a revision always asks to switch, naming the day it would start, even with no live plan', async () => {
    api.on('POST', adoptPath, adopted('2026-10-22', { id: LIVE }));
    setDay({ proposal: proposalJSON({ revisionOf: LIVE }) });
    await renderCard();
    expect(screen.getByText(en('program.revision.kicker', { weeks: '4' }).toUpperCase())).toBeOnTheScreen();
    await fireEvent.press(button('program.revision.start'));
    expect(await screen.findByText(en('program.revision.switch.body', { date: 'Thu 22 Oct' }))).toBeOnTheScreen();
    expect(api.sentAll(adoptPath)).toHaveLength(0);
    await fireEvent.press(button('program.revision.switch.confirm'));
    await waitFor(() => expect(api.sent(adoptPath, 'POST').body).toEqual({ replaceActive: true }));
  });

  it('reminders off: no permission is asked, and the banner promises nothing', async () => {
    api.on('POST', adoptPath, adopted());
    setDay();
    await renderCard();
    await fireEvent.press(screen.getByRole('switch', { name: en('program.proposal.reminders') }));
    await fireEvent.press(button('program.proposal.start'));
    await waitFor(() => expect(api.sentAll(adoptPath, 'POST')).toHaveLength(1));
    await waitFor(async () => expect(await AsyncStorage.getItem(ReminderKeys.workoutDay(MEMBER))).toBe('false'));
    expect(notificationsState.requestCount()).toBe(0);
    expect(await AsyncStorage.getItem(reminderDeniedKey(MEMBER))).toBe('false');
    expect(await readAdoptedBannerKey(MEMBER)).toBe('plan.adopted.banner_plain');
  });

  it('a phone that refuses notifications is recorded, so the banner says to check Plan daily', async () => {
    notificationsState.answerNextRequestWith('denied');
    api.on('POST', adoptPath, adopted());
    setDay();
    await renderCard();
    await fireEvent.press(button('program.proposal.start'));
    await waitFor(async () => expect(await AsyncStorage.getItem(reminderDeniedKey(MEMBER))).toBe('true'));
    expect(await readAdoptedBannerKey(MEMBER)).toBe('plan.adopted.banner_no_notes');
  });

  it('the reminder preferences are written ONLY after a successful adopt', async () => {
    api.on('POST', adoptPath, Reply.problem(500, 'internal_error'));
    setDay();
    await renderCard();
    await fireEvent.press(button('program.proposal.start'));
    expect(await screen.findByText(en('common.error_body'))).toBeOnTheScreen();
    expect(await AsyncStorage.getItem(ReminderKeys.workoutDay(MEMBER))).toBeNull();
    expect(await AsyncStorage.getItem(reminderDeniedKey(MEMBER))).toBeNull();
    expect(useIntentStore.getState().pendingPlanAction).toBeNull();
  });

  it('once the server has adopted, bookkeeping that throws never turns the start into a failure', async () => {
    setAnalyticsObserver((event) => {
      if (event === 'program_adopted') throw new Error('analytics param refused');
    });
    api.on('POST', adoptPath, adopted('2026-10-22'));
    setDay();
    await renderCard({ palette: 'coach' });
    await fireEvent.press(button('program.proposal.start'));
    expect(await screen.findByText(en('program.proposal.started'))).toBeOnTheScreen();
    expect(screen.queryByText(en('common.error_body'))).toBeNull();
    expect(useIntentStore.getState().pendingPlanAction?.action).toEqual({ kind: 'showAdoptedBanner', startsOn: '2026-10-22' });
    expect(useIntentStore.getState().pendingTab).toBe('Plan');
    expect(api.sentAll(adoptPath, 'POST')).toHaveLength(1);
  });

  it('a stale revision keeps the card with its line', async () => {
    api.on('POST', adoptPath, Reply.problem(409, 'program_action_not_allowed', { reason: 'revision_stale' }));
    setDay({ proposal: proposalJSON({ revisionOf: LIVE }) });
    await renderCard();
    await fireEvent.press(button('program.revision.start'));
    await fireEvent.press(await screen.findByRole('button', { name: en('program.revision.switch.confirm') }));
    expect(await screen.findByText(en('program.revision.stale'))).toBeOnTheScreen();
    expect(button('program.revision.start')).toBeEnabled();
  });

  it('offline keeps the card with "This needs a connection."', async () => {
    api.on('POST', adoptPath, Reply.fail());
    setDay();
    await renderCard();
    await fireEvent.press(button('program.proposal.start'));
    expect(await screen.findByText(en('health.offline.action_hint'))).toBeOnTheScreen();
  });
});

describe('in the Coach (its palette, the outcome on the message)', () => {
  it('a plan changed elsewhere collapses to its line with Open Plan, and leaves Plan its toast', async () => {
    api.on('POST', adoptPath, Reply.problem(409, 'program_action_not_allowed', { reason: 'already_adopted' }));
    setDay();
    const onOutcome = jest.fn();
    const onOpenPlan = jest.fn();
    await renderCard({ palette: 'coach', onOutcome, onOpenPlan });
    await fireEvent.press(button('program.proposal.start'));
    expect(await screen.findByText(en('program.proposal.changed'))).toBeOnTheScreen();
    expect(onOutcome).toHaveBeenCalledWith('changed');
    expect(useHealthStore.getState().toastKey).toBe('health.err.changed');
    await fireEvent.press(button('program.chip.open_plan'));
    expect(onOpenPlan).toHaveBeenCalledTimes(1);
  });

  it('Not now keeps the plan: "Saved." with Open Plan, nothing posted', async () => {
    const events = recordAnalytics();
    setDay();
    const onOutcome = jest.fn();
    await renderCard({ palette: 'coach', onOutcome });
    await fireEvent.press(button('program.proposal.not_now'));
    expect(screen.getByText(en('program.proposal.saved'))).toBeOnTheScreen();
    expect(onOutcome).toHaveBeenCalledWith('saved');
    expect(screen.getByRole('button', { name: en('program.chip.open_plan') })).toBeOnTheScreen();
    expect(events.map((e) => e.params)).toContainEqual({ action: 'not_now' });
  });

  it('Discard asks, posts, and collapses to "Plan discarded." with nowhere to go', async () => {
    api.on('POST', `/health/programs/${PROPOSAL}/discard`, Reply.ok({ ok: true }));
    setDay();
    await renderCard({ palette: 'coach' });
    await fireEvent.press(button('program.proposal.discard'));
    expect(await screen.findByText(en('program.discard.body'))).toBeOnTheScreen();
    // The dialog's answer is "Discard" too: the last button of that name is the dialog's.
    const discards = screen.getAllByRole('button', { name: en('program.discard.confirm') });
    await fireEvent.press(discards[discards.length - 1]!);
    expect(await screen.findByText(en('program.proposal.discarded'))).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en('program.chip.open_plan') })).toBeNull();
    const sent = expectSentToMatchContract('POST', `/health/programs/${PROPOSAL}/discard`);
    expect(sent.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('an outcome the host kept draws the card collapsed from the start', async () => {
    setDay();
    await renderCard({ palette: 'coach', outcome: 'started' });
    expect(screen.getByText(en('program.proposal.started'))).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en('program.proposal.start') })).toBeNull();
  });

  it('Start or Discard in the weeks screen reaches the card', async () => {
    setDay();
    const onOutcome = jest.fn();
    await renderCard({ palette: 'coach', onOutcome });
    await act(async () => reportProposalOutcome(PROPOSAL, 'started'));
    expect(screen.getByText(en('program.proposal.started'))).toBeOnTheScreen();
    expect(onOutcome).toHaveBeenCalledWith('started');
  });

  it('the card a Coach message carries is drawn without the Today read', async () => {
    setDay({ proposal: null });
    const proposal = decodeHealthProposal(proposalJSON({ summaryTitle: 'From the chat' }), 'proposal');
    await renderCard({ palette: 'coach', proposal });
    expect(screen.getByRole('header', { name: 'From the chat' })).toBeOnTheScreen();
  });
});

describe('Change days', () => {
  it('opens the days sheet for the proposal, posts the days alone, and redraws the card from the answer', async () => {
    const events = recordAnalytics();
    api.on(
      'POST',
      `/health/programs/${PROPOSAL}`,
      Reply.ok({ program: { ...proposalJSON({ trainingDays: [2, 4, 6] }), week1: undefined, weekPlans: [{ weekNo: 1, days: [] }] } }),
    );
    setDay();
    const onProgramUpdated = jest.fn();
    await renderCard({ palette: 'coach', onProgramUpdated });
    await fireEvent.press(button('program.proposal.change_days'));
    for (const day of [1, 3, 5, 2, 4, 6]) await fireEvent.press(screen.getByTestId(`days.chip.${day}`));
    await fireEvent.press(screen.getByTestId('days.save'));
    await waitFor(() => expect(screen.getByText('Tue, Thu, Sat · about 40 min')).toBeOnTheScreen());
    expect(api.sent(`/health/programs/${PROPOSAL}`, 'POST').body).toEqual({ trainingDays: [2, 4, 6] });
    expect(onProgramUpdated).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.params)).toContainEqual({ action: 'change_days' });
  });
});
