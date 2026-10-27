/**
 * The programme wizard on the Coach tab, with the real screen, store and
 * flow (iOS CoachView's question bubbles, `ProgramMultiChoiceBubble`,
 * `ProgramSummaryBubble` and the proposal card): the chip starts it, the
 * chips and the multi-select walk it, the summary's rows re-ask, Build posts
 * once and the plan lands as a card whose outcome stays on the message.
 *
 * PLAN-4's proposal card is a stand-in here: this file tests what the Coach
 * hands it and keeps from it.
 */
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { api, Reply } from '@test/server';

import { decodeProfile } from '../../../../api/profile';
import { stubApiClientPerTest } from '../../../../api/testing';
import { UiKitProvider, dismissAllDialogs } from '../../../../components/ui';
import CoachScreen from '../../../../screens/coach/CoachScreen';
import { resetSpeechModuleForTests } from '../../../../screens/coach/useDictation';
import { lookup } from '../../../../i18n';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { resetIntentStoreForTests } from '../../../../stores/intentStore';
import { claimCoachForMember } from '../../register';
import { pendingCoachSaves, resetCoachStoreForTests, useCoachStore } from '../../store/coachStore';
import { setProgramContextForTests } from '../context';
import { proposalOf } from '../messages';
import { resetProgram } from '../wizard';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: require('../../../../screens/coach/__tests__/fakeSpeech').fakeSpeech,
}));
// The Coach mounts the Saved sheet, which reads the real store (closed here).
jest.mock('../../../favourites', () => ({
  ...jest.requireActual('../../../favourites'),
  useFavourite: () => ({ isFavourite: false, loading: false, toggle: async () => undefined }),
}));
// PLAN-4's card, as a stand-in that shows what it was given and reports an outcome.
jest.mock('../../../plan/proposal/ProgramProposalCard', () => {
  const { Pressable: Press, Text: Label, View: Box } = require('react-native');
  return {
    __esModule: true,
    default: (props: {
      palette: string;
      proposal: { program: { summaryTitle: string }; week1: unknown[] };
      outcome: string | null;
      onOutcome: (outcome: string) => void;
    }) => (
      <Box testID="stub.proposal">
        <Label>{`${props.palette} ${props.proposal.program.summaryTitle} week1=${props.proposal.week1.length}`}</Label>
        <Label>{`outcome=${props.outcome ?? 'none'}`}</Label>
        <Press accessibilityRole="button" accessibilityLabel="stub not now" onPress={() => props.onOutcome('saved')} />
      </Box>
    ),
  };
});
/* eslint-enable @typescript-eslint/no-require-imports */

stubApiClientPerTest();

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const en = (key: string, params: Record<string, string> = {}) => {
  let text = lookup(key, 'en');
  for (const [name, value] of Object.entries(params)) text = text.replace(`{${name}}`, value);
  return text;
};

type Routes = { CoachMain: undefined };
const Stack = createNativeStackNavigator<Routes>();
const navigation = createNavigationContainerRef<Routes>();

async function renderCoach() {
  await render(
    <NavigationContainer ref={navigation}>
      <UiKitProvider>
        <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
          <Stack.Screen name="CoachMain" component={CoachScreen as never} />
        </Stack.Navigator>
      </UiKitProvider>
    </NavigationContainer>,
  );
  await act(async () => undefined);
}

async function settle() {
  await act(async () => {
    for (let turn = 0; turn < 8; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function press(name: string) {
  const buttons = screen.getAllByRole('button', { name });
  await fireEvent.press(buttons[buttons.length - 1]!);
  await settle();
}

async function check(name: string) {
  const boxes = screen.getAllByRole('checkbox', { name });
  await fireEvent.press(boxes[boxes.length - 1]!);
  await settle();
}

beforeEach(async () => {
  resetAppStoreForTests();
  resetIntentStoreForTests();
  resetCoachStoreForTests();
  resetProgram();
  resetSpeechModuleForTests();
  setProgramContextForTests({ access: 'entitled', hasConsent: true });
  useAppStore.setState({
    isAuthenticated: true,
    userId: MEMBER,
    profile: decodeProfile({ id: MEMBER, email: 'member@example.com', kennitalaVerified: false, marketingConsent: false, locale: 'en' }),
  });
  await claimCoachForMember(MEMBER, false);
});

afterEach(async () => {
  await act(async () => dismissAllDialogs());
  await pendingCoachSaves();
  setProgramContextForTests(null);
  resetProgram();
});

it('walks from the chip to a built plan', async () => {
  api.on(
    'POST',
    '/coach',
    Reply.ok(
      {
        reply: 'Done.',
        program: {
          id: '2b1a7f0e-9d8c-4b5a-8e7f-6a5b4c3d2e10',
          status: 'proposed',
          summaryTitle: 'Strong in four weeks',
          intro: 'Three strength days a week.',
          weekPlans: [{ weekNo: 1, days: [{ id: 's1', weekday: 1, kind: 'strength', title: 'A', minutes: 40 }] }],
        },
        replayed: false,
      },
      201,
    ),
  );
  await renderCoach();
  await press(en('coach.chip.program'));
  expect(screen.getByText(en('program.q.goal'))).toBeOnTheScreen();

  await press(en('program.goal.build_muscle'));
  await press(en('program.focus.full'));
  await press(en('program.days_n', { count: '3' }));
  await press(en('program.exp.some'));

  // The multi-select: checkboxes, a note, Continue waiting for a pick.
  expect(screen.getByText(en('program.q.safety_note'))).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: en('common.continue') })).toBeDisabled();
  await check(en('program.safety.injury'));
  await check(en('program.safety.condition'));
  expect(screen.getByRole('checkbox', { name: en('program.safety.injury') })).toBeChecked();
  await check(en('program.safety.nothing'));
  expect(screen.getByRole('checkbox', { name: en('program.safety.injury') })).not.toBeChecked();
  await check(en('program.safety.injury'));
  const continueLabel = `${en('common.continue')}. ${en('a11y.selected_count', { count: '1' })}`;
  await press(continueLabel);

  // 5b: at most three.
  expect(screen.getByText(en('program.q.injury_where'))).toBeOnTheScreen();
  for (const part of ['knee', 'back', 'hip', 'neck']) await check(en(`program.part.${part}`));
  expect(screen.getByText(en('program.part.max'))).toBeOnTheScreen();
  expect(screen.getByRole('checkbox', { name: en('program.part.neck') })).not.toBeChecked();
  await press(`${en('common.continue')}. ${en('a11y.selected_count', { count: '3' })}`);

  await press(en('program.body.skip'));
  await press(en('program.days.default_chip', { days: 'Mon, Wed, Fri' }));

  // The summary.
  expect(screen.getByText(en('program.summary.title'))).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: en('program.summary.days', { count: '3', days: 'Mon, Wed, Fri' }) })).toBeOnTheScreen();
  expect(
    screen.getByRole('button', {
      name: en('program.summary.care', { what: `${en('program.part.back')}, ${en('program.part.knee')}, ${en('program.part.hip')}` }),
    }),
  ).toBeOnTheScreen();

  // A row re-asks its question and comes back to a fresh summary.
  await press(en('program.summary.length', { weeks: '4' }));
  await press(en('program.length.8'));
  expect(screen.getByRole('button', { name: en('program.summary.length', { weeks: '8' }) })).toBeOnTheScreen();

  await press(en('program.summary.build'));
  expect(api.sentAll('/coach')).toHaveLength(1);
  expect(screen.getByText('Three strength days a week.')).toBeOnTheScreen();
  expect(screen.getByText('coach Strong in four weeks week1=1')).toBeOnTheScreen();
  // The summary closed with the build: no second Build button.
  expect(screen.queryByRole('button', { name: en('program.summary.build') })).toBeNull();

  // The card's outcome is kept on the message.
  await press('stub not now');
  expect(screen.getByText('outcome=saved')).toBeOnTheScreen();
  const card = useCoachStore.getState().messages.find((message) => proposalOf(message) !== null);
  expect(proposalOf(card)?.outcome).toBe('saved');
});

it('says the typed words are not used, and asks again', async () => {
  await renderCoach();
  await press(en('coach.chip.program'));
  await fireEvent.changeText(screen.getByTestId('coach.input'), 'I weigh 90 kg');
  await fireEvent(screen.getByTestId('coach.input'), 'submitEditing');
  await settle();
  expect(screen.getByText(en('program.typed_hint'))).toBeOnTheScreen();
  expect(screen.queryByText('I weigh 90 kg')).toBeNull();
  expect(screen.getAllByText(en('program.q.goal'))).toHaveLength(2);
  expect(api.sentAll('/coach')).toHaveLength(0);
});

it('starts over from the summary', async () => {
  await renderCoach();
  await press(en('coach.chip.program'));
  await press(en('program.goal.get_fitter'));
  await press(en('program.focus.core'));
  await press(en('program.days_n', { count: '2' }));
  await press(en('program.exp.new'));
  await check(en('program.safety.nothing'));
  await press(`${en('common.continue')}. ${en('a11y.selected_count', { count: '1' })}`);
  await press(en('program.body.skip'));
  await press(en('program.days.default_chip', { days: 'Mon, Thu' }));
  await press(en('program.summary.start_over'));
  expect(screen.getAllByText(en('program.q.goal'))).toHaveLength(2);
  expect(screen.queryByRole('button', { name: en('program.summary.start_over') })).toBeNull();
});
