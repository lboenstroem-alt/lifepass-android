/**
 * Adjust my plan on the Coach tab, with the real screen, store and flow (iOS
 * CoachView's question bubbles and the proposal card): the empty state's
 * "Adjust my plan" opens the menu, the chips walk to a confirmation that
 * names each change, and "Show me the updated plan" posts once and lands the
 * revision as the card.
 *
 * PLAN-4's proposal card is a stand-in here: this file tests what the Coach
 * hands it. The target sheet is a stand-in that hands a value back.
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
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { resetIntentStoreForTests } from '../../../../stores/intentStore';
import { openTargetSheet, type TargetSheetMode } from '../../../body/sheets';
import { claimCoachForMember } from '../../register';
import { setProgramContextForTests } from '../../program/context';
import { resetProgram } from '../../program/wizard';
import { pendingCoachSaves, resetCoachStoreForTests } from '../../store/coachStore';
import { resetAdjust } from '../flow';
import { adjustingContext, en, liveProgram, PROGRAM_ID, programJson } from './adjustHarness';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: require('../../../../screens/coach/__tests__/fakeSpeech').fakeSpeech,
}));
jest.mock('../../../favourites', () => ({
  useFavourite: () => ({ isFavourite: false, loading: false, toggle: async () => undefined }),
}));
jest.mock('../../../body/sheets', () => ({ ...jest.requireActual('../../../body/sheets'), openTargetSheet: jest.fn() }));
// PLAN-4's card, as a stand-in that shows what it was given.
jest.mock('../../../plan/proposal/ProgramProposalCard', () => {
  const { Text: Label, View: Box } = require('react-native');
  return {
    __esModule: true,
    default: (props: { palette: string; proposal: { program: { summaryTitle: string; revisionOf: string | null } } }) => (
      <Box testID="stub.proposal">
        <Label>{`${props.palette} ${props.proposal.program.summaryTitle} revises=${props.proposal.program.revisionOf ?? 'none'}`}</Label>
      </Box>
    ),
  };
});
/* eslint-enable @typescript-eslint/no-require-imports */

stubApiClientPerTest();

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const openTargetSheetMock = openTargetSheet as jest.MockedFunction<typeof openTargetSheet>;

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

beforeEach(async () => {
  resetAppStoreForTests();
  resetIntentStoreForTests();
  resetCoachStoreForTests();
  resetProgram();
  resetAdjust();
  resetSpeechModuleForTests();
  openTargetSheetMock.mockReset();
  setProgramContextForTests(adjustingContext());
  // A plan running on a server that revises: the empty state says "Adjust my plan".
  useAppStore.setState({
    isAuthenticated: true,
    userId: MEMBER,
    serverFeatures: ['plan_revision', 'target_weight'],
    profile: decodeProfile({
      id: MEMBER,
      email: 'member@example.com',
      kennitalaVerified: false,
      marketingConsent: false,
      locale: 'en',
      health: { program: { id: PROGRAM_ID, status: 'active' } },
    }),
  });
  await claimCoachForMember(MEMBER, false);
});

afterEach(async () => {
  await act(async () => dismissAllDialogs());
  await pendingCoachSaves();
  setProgramContextForTests(null);
  resetAdjust();
  resetProgram();
});

it('walks from the chip to the updated plan', async () => {
  api.on(
    'POST',
    `/health/programs/${PROGRAM_ID}/revise`,
    Reply.ok(
      {
        program: {
          ...programJson({
            id: '7d4e2c1a-5b6f-4e3d-8c2b-1a0f9e8d7c60',
            status: 'proposed',
            weeks: 8,
            summaryTitle: 'Build muscle over eight weeks',
            intro: 'The same plan, run over eight weeks.',
            revisionOf: PROGRAM_ID,
          }),
          weekPlans: [{ weekNo: 1, days: [{ id: 's1', weekday: 1, kind: 'strength', title: 'A', minutes: 40 }] }],
        },
        replayed: false,
      },
      201,
    ),
  );
  await renderCoach();
  await press(en('coach.chip.adjust_plan'));
  expect(screen.getByText(`${en('program.adjust.title')}\n${en('program.adjust.now', { summary: 'Build muscle, 3 days a week' })}`)).toBeOnTheScreen();

  await press(en('program.adjust.opt.length'));
  expect(screen.getByText(en('program.adjust.q.length'))).toBeOnTheScreen();
  await press(en('program.length.8'));
  expect(
    screen.getByText(
      [en('program.adjust.confirm'), en('program.adjust.line.length', { new: '8', old: '4' }), en('program.adjust.confirm_note')].join('\n'),
    ),
  ).toBeOnTheScreen();

  await press(en('program.adjust.show'));
  expect(api.sentAll(`/health/programs/${PROGRAM_ID}/revise`)).toHaveLength(1);
  expect(screen.getByText(en('program.adjust.building'))).toBeOnTheScreen();
  expect(screen.getByText('The same plan, run over eight weeks.')).toBeOnTheScreen();
  expect(screen.getByText(`coach Build muscle over eight weeks revises=${PROGRAM_ID}`)).toBeOnTheScreen();
  // The confirmation closed with the tap: its chips stay as a record, and none sends twice.
  expect(screen.getByRole('button', { name: en('program.adjust.show') })).toBeDisabled();
});

it('asks the safety question and the target, never showing a weight', async () => {
  setProgramContextForTests(adjustingContext({ liveProgram: liveProgram({ goal: 'get_fitter' }) }));
  await renderCoach();
  await press(en('coach.chip.adjust_plan'));
  await press(en('program.adjust.opt.goal'));
  await press(en('program.goal.lose_weight'));
  expect(screen.getByText(en('program.adjust.q.safety'))).toBeOnTheScreen();
  await press(en('program.adjust.safety.no'));
  await press(en('program.adjust.target.set'));
  const mode = openTargetSheetMock.mock.calls[0]![0] as Extract<TargetSheetMode, { kind: 'pick' }>;
  await act(async () => mode.onPicked(74.2));
  await settle();
  expect(screen.getByText(new RegExp(en('program.adjust.line.target')))).toBeOnTheScreen();
  expect(screen.queryByText(/74/)).toBeNull();
  expect(api.requests).toHaveLength(0);
});

it('says the typed words are not used, and asks again', async () => {
  await renderCoach();
  await press(en('coach.chip.adjust_plan'));
  await fireEvent.changeText(screen.getByTestId('coach.input'), 'I weigh 90 kg');
  await fireEvent(screen.getByTestId('coach.input'), 'submitEditing');
  await settle();
  expect(screen.getByText(en('program.typed_hint'))).toBeOnTheScreen();
  expect(screen.queryByText('I weigh 90 kg')).toBeNull();
  expect(screen.getAllByText(en('program.adjust.title'), { exact: false })).toHaveLength(2);
  expect(api.requests).toHaveLength(0);
});
