/**
 * PLAN-4's sections on the real Plan page (PLAN-1's PlanScreen, the stub
 * server, the real stores): the proposal as the intro section and Start
 * landing the adopted banner, This plan and the History card under a live
 * plan, and the "new plan" row's Review reaching the programme overview.
 */
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import { Text } from 'react-native';

import { stubApiClientPerTest } from '../../../../api/testing';
import { resetUiKit, UiKitProvider } from '../../../../components/ui';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import * as healthLocalStore from '../../../../health/localStore';
import { translate } from '../../../../i18n';
import PlanScreen from '../../PlanScreen';
import { dayJSON, freshPlan, settle, signIn, TODAY } from '../../__tests__/planFixtures';
import { resetProposalBridges } from '../../proposal/proposalActions';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) }));

stubApiClientPerTest();

const PROPOSAL = '0b7d6a52-1c3e-4f5a-9b8c-7d6e5f4a3b2c';
const LIVE = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);

const PROPOSAL_JSON = {
  id: PROPOSAL,
  status: 'proposed',
  summaryTitle: 'Four weeks to stronger legs',
  weeks: 4,
  daysPerWeek: 3,
  trainingDays: [1, 3, 5],
  typicalMinutes: 40,
  revisionOf: null,
  week1: [{ id: 's-1', weekday: 1, kind: 'strength', title: 'Legs', minutes: 40 }],
};

const LIVE_JSON = {
  id: LIVE,
  status: 'active',
  summaryTitle: 'Stronger in four weeks',
  weekNo: 2,
  weeks: 4,
  daysPerWeek: 3,
  trainingDays: [1, 3, 5],
  startsOn: '2026-10-12',
  endsOn: '2026-11-08',
};

const Stack = createNativeStackNavigator();

function StandIn({ route }: { route: { name: string; params?: object } }) {
  return <Text>{`route:${route.name}:${JSON.stringify(route.params ?? {})}`}</Text>;
}

async function renderPlan() {
  await render(
    <NavigationContainer>
      <UiKitProvider>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="PlanMain" component={PlanScreen as never} />
          {['ProgramOverview', 'WorkoutHistory', 'MealHistory'].map((name) => (
            <Stack.Screen key={name} name={name} component={StandIn as never} />
          ))}
        </Stack.Navigator>
      </UiKitProvider>
    </NavigationContainer>,
  );
  await act(async () => settle());
}

beforeEach(() => {
  freshPlan();
  resetProposalBridges();
  resetUiKit();
  bottomSheetMock.reset();
  signIn();
});

afterEach(async () => {
  await settle();
  await healthLocalStore.settled();
});

it('no plan and a proposal: the proposal card is the intro section, and Start lands the adopted banner', async () => {
  let adoptedYet = false;
  api.on('GET', '/health', () =>
    Reply.ok(
      adoptedYet
        ? dayJSON(TODAY, { program: { ...LIVE_JSON, id: PROPOSAL, startsOn: '2026-10-22' }, proposal: null })
        : dayJSON(TODAY, { program: null, proposal: PROPOSAL_JSON }),
    ),
  );
  api.on('POST', `/health/programs/${PROPOSAL}/adopt`, () => {
    adoptedYet = true;
    return Reply.ok({ program: { id: PROPOSAL, status: 'active', startsOn: '2026-10-22', weekPlans: [] }, replaced: null });
  });
  await renderPlan();
  expect(await screen.findByRole('header', { name: 'Four weeks to stronger legs' })).toBeOnTheScreen();
  expect(screen.queryByRole('header', { name: en('plan.intro.title') })).toBeNull();

  await fireEvent.press(screen.getByRole('switch', { name: en('program.proposal.reminders') }));
  await fireEvent.press(screen.getByRole('button', { name: en('program.proposal.start') }));
  expect(await screen.findByText(en('plan.adopted.banner_plain', { date: 'Thu 22 Oct' }))).toBeOnTheScreen();
  await waitFor(() => expect(screen.queryByRole('button', { name: en('program.proposal.start') })).toBeNull());
});

it('a live plan: This plan and the History card, each row leading to its page', async () => {
  api.on(
    'GET',
    '/health',
    Reply.ok(
      dayJSON(TODAY, {
        program: LIVE_JSON,
        history: { workouts: [{ id: 'h-1', date: '2026-10-18', title: 'Legs', status: 'done', minutes: 40 }], mealDays: [] },
      }),
    ),
  );
  await renderPlan();
  expect(await screen.findByRole('header', { name: 'Stronger in four weeks' })).toBeOnTheScreen();
  expect(screen.getByText('Days: Mon, Wed, Fri')).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: en('history.title') })).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: en('plan.overview.see_all', { weeks: '4' }) }));
  expect(await screen.findByText(`route:ProgramOverview:${JSON.stringify({ programId: LIVE, mode: 'live' })}`)).toBeOnTheScreen();
});

it('a live plan with a proposal waiting: the row, not the card, and Review opens the proposal', async () => {
  api.on('GET', '/health', Reply.ok(dayJSON(TODAY, { program: LIVE_JSON, proposal: PROPOSAL_JSON })));
  await renderPlan();
  expect(await screen.findByText(en('plan.proposal_waiting'))).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: en('program.proposal.start') })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: en('plan.review') }));
  expect(await screen.findByText(`route:ProgramOverview:${JSON.stringify({ programId: PROPOSAL, mode: 'proposal' })}`)).toBeOnTheScreen();
});
