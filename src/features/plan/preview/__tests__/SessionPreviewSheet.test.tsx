/**
 * The session preview (iOS SessionPreviewSheet): every block with its dose,
 * equipment and first cue, or "Logged without set details."; at most one
 * action; Start runs once the sheet has gone; a pull applies its answer and
 * closes, a refusal hides the button with the "changed" toast, and offline
 * keeps it with the hint.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { expectRequestValid } from '@test/contract';
import { api, Reply } from '@test/server';
import { useState } from 'react';

import { stubApiClientPerTest } from '../../../../api/testing';
import { UiKitProvider } from '../../../../components/ui';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { decodeSessionView, useHealthStore, type SessionActionResponse } from '../../../../health';
import { resetHealthStoreForTests } from '../../../../health/store';
import { restoreTestFontScale, setTestFontScale } from '../../../../hooks/testing';
import { translate } from '../../../../i18n';
import { recordAnalytics, settle } from '../../__tests__/planFixtures';
import SessionPreviewSheet from '../SessionPreviewSheet';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);
const ID = '0b5e4a3c-1d2e-4f50-8a6b-7c8d9e0f1a2b';

const session = (json: Record<string, unknown> = {}) =>
  decodeSessionView(
    {
      id: ID,
      title: 'Legs',
      minutes: 35,
      intensity: 'easy',
      canPull: true,
      blocks: [
        { exerciseId: 'squat', name: 'Goblet squat', sets: 3, reps: 10, loadHint: 'moderate', equipmentLabel: 'Kettlebell', cues: ['Chest up', 'Knees out'] },
        { exerciseId: 'swim', name: 'Front crawl', sets: 4, meters: 50 },
      ],
      ...json,
    },
    'session',
  );

function Harness(props: {
  json?: Record<string, unknown>;
  canStart?: boolean;
  onStart?: () => void;
  onPulled?: (r: SessionActionResponse) => void;
  onChangeWithCoach?: () => void;
}) {
  const [visible, setVisible] = useState(true);
  return (
    <UiKitProvider>
      <SessionPreviewSheet
        visible={visible}
        onClose={() => setVisible(false)}
        session={session(props.json)}
        entry="rest_row"
        canStart={props.canStart}
        onStart={props.onStart}
        onPulled={props.onPulled}
        onChangeWithCoach={props.onChangeWithCoach}
      />
    </UiKitProvider>
  );
}

beforeEach(() => {
  bottomSheetMock.reset();
  setTestFontScale(1);
  resetHealthStoreForTests();
});

afterEach(async () => {
  restoreTestFontScale();
  await settle();
});

it('shows the title, the meta line, every block and the disclaimer', async () => {
  await render(<Harness json={{ lighter: true }} />);
  expect(screen.getByRole('header', { name: 'Legs' })).toBeOnTheScreen();
  expect(screen.getByText('35 min · Easy')).toBeOnTheScreen();
  expect(screen.getByText(en('plan.lighter_chip'))).toBeOnTheScreen();
  expect(screen.getByText('3 × 10 · Moderate')).toBeOnTheScreen();
  expect(screen.getByText('Kettlebell')).toBeOnTheScreen();
  expect(screen.getByText('Chest up')).toBeOnTheScreen();
  expect(screen.queryByText('Knees out')).toBeNull();
  expect(screen.getByText('4 × 50 m')).toBeOnTheScreen();
  expect(screen.getByText(en('health.disclaimer'))).toBeOnTheScreen();
});

it('a session without blocks says so', async () => {
  await render(<Harness json={{ blocks: [] }} />);
  expect(screen.getByText(en('history.detail.no_sets'))).toBeOnTheScreen();
});

it("Start is the one action for today's session, and runs once the sheet has gone", async () => {
  const onStart = jest.fn();
  await render(<Harness canStart onStart={onStart} />);
  expect(screen.queryByRole('button', { name: en('plan.do_today') })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: en('plan.start') }));
  await act(async () => settle());
  expect(onStart).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('header', { name: 'Legs' })).toBeNull();
});

it('Do it today pulls the session and hands the answer over', async () => {
  const events = recordAnalytics();
  const onPulled = jest.fn();
  api.on('POST', `/health/sessions/${ID}`, Reply.ok({ session: { id: ID, status: 'planned' }, upcoming: [] }));
  await render(<Harness onPulled={onPulled} />);
  await fireEvent.press(screen.getByRole('button', { name: en('plan.do_today') }));
  await act(async () => settle());
  const sent = api.sent(`/health/sessions/${ID}`, 'POST');
  expect(sent.body).toEqual({ action: 'pull' });
  expectRequestValid(sent);
  expect(onPulled).toHaveBeenCalledWith(expect.objectContaining({ session: expect.objectContaining({ id: ID }) }));
  expect(events).toContainEqual({ event: 'workout_pulled', params: { entry: 'rest_row' } });
  expect(screen.queryByRole('header', { name: 'Legs' })).toBeNull();
});

it('a refusal hides the button with the changed toast', async () => {
  api.on('POST', `/health/sessions/${ID}`, Reply.problem(409, 'today_not_free'));
  await render(<Harness />);
  await fireEvent.press(screen.getByRole('button', { name: en('plan.do_today') }));
  await act(async () => settle());
  expect(screen.queryByRole('button', { name: en('plan.do_today') })).toBeNull();
  expect(useHealthStore.getState().toastKey).toBe('health.err.changed');
});

it('offline keeps the button and says it needs a connection', async () => {
  api.on('POST', `/health/sessions/${ID}`, Reply.fail());
  await render(<Harness />);
  await fireEvent.press(screen.getByRole('button', { name: en('plan.do_today') }));
  await act(async () => settle());
  expect(screen.getByText(en('health.offline.action_hint'))).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: en('plan.do_today') })).toBeOnTheScreen();
});

it('nothing to do when the session cannot be pulled', async () => {
  await render(<Harness json={{ canPull: false }} />);
  expect(screen.queryByRole('button', { name: en('plan.do_today') })).toBeNull();
  expect(screen.queryByRole('button', { name: en('plan.start') })).toBeNull();
});

describe('COACH-6', () => {
  it('a session with no length never says "0 min"', async () => {
    await render(<Harness json={{ minutes: null, intensity: 'hard' }} />);
    expect(screen.queryByText(/0 min/)).toBeNull();
    expect(screen.getByText(en('plan.intensity.hard'))).toBeOnTheScreen();
  });

  it('tags the member\'s own exercise', async () => {
    await render(<Harness json={{ blocks: [{ exerciseId: 'custom-kick-up', name: 'Kick-ups', sets: 1, seconds: 300, own: true }] }} />);
    expect(screen.getByText('Kick-ups')).toBeOnTheScreen();
    expect(screen.getByText(en('coach.planEdit.ownTag'))).toBeOnTheScreen();
  });

  it('"Change with Coach" runs once the sheet has gone, and only when offered', async () => {
    const onChange = jest.fn();
    await render(<Harness onChangeWithCoach={onChange} />);
    await fireEvent.press(screen.getByRole('button', { name: en('coach.planEdit.changeWithCoach') }));
    await act(async () => settle());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('header', { name: 'Legs' })).toBeNull();
  });

  it('is not there without the handler', async () => {
    await render(<Harness />);
    expect(screen.queryByRole('button', { name: en('coach.planEdit.changeWithCoach') })).toBeNull();
  });
});
