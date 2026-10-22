/**
 * The Log a workout sheet on screen (iOS LogWorkoutSheet): what it draws for
 * each day, what Save sends (the contract's own schema checks the body), the
 * key it sends it under, and what each answer does to the sheet. Every
 * request goes to the stub server; nothing here talks to production.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { expectRequestValid } from '@test/contract';
import { api, Reply } from '@test/server';
import { useState } from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';

import { stubApiClientPerTest } from '../../../../api/testing';
import { UiKitProvider } from '../../../../components/ui';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { decodeSessionView, useHealthStore, type SessionView } from '../../../../health';
import { resetHealthStoreForTests } from '../../../../health/store';
import { restoreTestFontScale, setTestFontScale } from '../../../../hooks/testing';
import { translate } from '../../../../i18n';
import { addServerDays, todayServerDay } from '../../../../i18n/format';
import { setAnalyticsObserver } from '../../../../lib/analytics';
import { recordAnalytics, settle } from '../../__tests__/planFixtures';
import LogWorkoutSheet from '../../sheets/LogWorkoutSheet';
import type { PlanSessionRef } from '../../sheets/types';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);
const ID = '3f2a9c4e-8b7d-4e61-a5f0-1c2d3e4f5a6b';
const PATH = `/health/sessions/${ID}`;
const TODAY = todayServerDay();
const YESTERDAY = addServerDays(TODAY, -1)!;

const rest = (json: Record<string, unknown> = {}): SessionView =>
  decodeSessionView({ id: ID, scheduledFor: TODAY, kind: 'rest', status: 'rest', title: null, canLogExtra: true, ...json }, 'session');

/** The server's answer: the row with the new extra on it. */
const ANSWER = {
  session: {
    id: ID,
    scheduledFor: TODAY,
    kind: 'rest',
    status: 'rest',
    canLogExtra: true,
    extras: [{ id: 'extra-0001', index: 0, minutes: 45, kind: 'strength', title: 'Gym', canRemove: true }],
  },
  changed: [],
  replayed: false,
};

const LIMIT = Reply.problem(400, 'invalid_session_action', {
  errors: [{ field: 'asExtra', message: 'at most 5 extra workouts fit on one day' }],
});

type HarnessProps = {
  session?: SessionView;
  cardDate?: string;
  pullCandidate?: PlanSessionRef | null;
};

const handlers = {
  onResult: jest.fn(),
  onChangedElsewhere: jest.fn(),
  onPull: jest.fn(),
  onClose: jest.fn(),
};

function Harness({ session = rest(), cardDate = TODAY, pullCandidate = null }: HarnessProps) {
  const [visible, setVisible] = useState(true);
  return (
    <UiKitProvider>
      <LogWorkoutSheet
        visible={visible}
        onClose={() => {
          handlers.onClose();
          setVisible(false);
        }}
        session={session}
        cardDate={cardDate}
        pullCandidate={pullCandidate}
        onPull={handlers.onPull}
        onResult={handlers.onResult}
        onChangedElsewhere={handlers.onChangedElsewhere}
      />
    </UiKitProvider>
  );
}

async function press(name: string) {
  await fireEvent.press(screen.getByRole('button', { name }));
  await act(async () => settle());
}

async function pressID(testID: string) {
  await fireEvent.press(screen.getByTestId(testID));
  await act(async () => settle());
}

const saveButton = () => screen.getByTestId('logworkout.save');
const title = () => screen.queryByRole('header', { name: en('logworkout.title') });

beforeEach(() => {
  setTestFontScale(1);
  bottomSheetMock.reset();
  resetHealthStoreForTests();
  setAnalyticsObserver(null);
  Object.values(handlers).forEach((handler) => handler.mockReset());
});

afterEach(async () => {
  restoreTestFontScale();
  setAnalyticsObserver(null);
  await settle();
});

describe('what it draws', () => {
  it("today's rest day: the title, Today, the six types, the four durations and the footer line", async () => {
    await render(<Harness />);
    expect(title()).toBeOnTheScreen();
    expect(screen.getByTestId('logworkout.date')).toHaveTextContent('Today');
    for (const label of ['Gym', 'Class', 'Swim', 'Run or walk', 'Outdoors']) {
      expect(screen.getByRole('button', { name: label })).toBeOnTheScreen();
    }
    for (const minutes of [30, 45, 60, 90]) {
      // TalkBack hears "45 minutes" for the "45 min" chip.
      expect(screen.getByText(`${minutes} min`)).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: `${minutes} minutes` })).toBeOnTheScreen();
    }
    expect(screen.getAllByRole('button', { name: 'Other' })).toHaveLength(2);
    expect(screen.getByText(en('logworkout.footer'))).toBeOnTheScreen();
    expect(screen.queryByTestId('logworkout.already')).toBeNull();
    expect(screen.queryByTestId('logworkout.pull')).toBeNull();
  });

  it('Save waits for a type and a duration', async () => {
    await render(<Harness />);
    expect(saveButton()).toBeDisabled();
    await press('Swim');
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Swim' })).toBeSelected();
    await press('30 minutes');
    expect(saveButton()).toBeEnabled();
  });

  it("yesterday's card says Yesterday", async () => {
    await render(<Harness cardDate={YESTERDAY} session={rest({ scheduledFor: YESTERDAY })} />);
    expect(screen.getByTestId('logworkout.date')).toHaveTextContent('Yesterday');
  });

  it('a row the watch or a door scan counted says so, a hand-logged one does not', async () => {
    const done = (doneSource: string) => rest({ kind: 'strength', status: 'done', doneSource, title: 'Legs' });
    const { unmount } = await render(<Harness session={done('wearable')} />);
    expect(screen.getByText(en('logworkout.already_watch'))).toBeOnTheScreen();
    await unmount();

    await render(<Harness session={done('check_in')} />);
    expect(screen.getByText(en('logworkout.already_visit'))).toBeOnTheScreen();
  });
});

describe('Save', () => {
  it('posts done as an extra with the kind, the minutes and the cleaned note, and hands the answer over', async () => {
    const events = recordAnalytics();
    api.on('POST', PATH, Reply.ok(ANSWER));
    await render(<Harness />);
    await press('Gym');
    await press('45 minutes');
    await fireEvent.changeText(screen.getByTestId('logworkout.note'), '  Leg day​ with Sam  ');
    await pressID('logworkout.save');

    const sent = api.sent(PATH, 'POST');
    expectRequestValid(sent);
    expect(sent.body).toEqual({ action: 'done', asExtra: true, kind: 'strength', minutes: 45, note: 'Leg day with Sam' });
    expect(sent.headers['idempotency-key']).toMatch(/^[a-z0-9-]{8,128}$/);

    expect(handlers.onResult).toHaveBeenCalledTimes(1);
    expect(handlers.onResult.mock.calls[0][0]).toEqual(
      expect.objectContaining({ session: expect.objectContaining({ id: ID, extras: [expect.objectContaining({ title: 'Gym' })] }) }),
    );
    expect(useHealthStore.getState().toastKey).toBe('logworkout.saved');
    expect(handlers.onClose).toHaveBeenCalled();
    expect(title()).toBeNull();
    // A fixed word for each param, never the minutes or the note.
    expect(events).toEqual([{ event: 'plan_extra_logged', params: { kind: 'strength', entry: 'rest', relative: 'today' } }]);
  });

  it("yesterday's card files the workout at noon of its date", async () => {
    const events = recordAnalytics();
    api.on('POST', PATH, Reply.ok(ANSWER));
    await render(<Harness cardDate={YESTERDAY} session={rest({ scheduledFor: YESTERDAY, status: 'skipped', kind: 'strength' })} />);
    await press('Class');
    await press('60 minutes');
    await pressID('logworkout.save');

    const sent = api.sent(PATH, 'POST');
    expectRequestValid(sent);
    expect(sent.body).toEqual({ action: 'done', asExtra: true, kind: 'class', minutes: 60, clientCompletedAt: `${YESTERDAY}T12:00:00Z` });
    expect(events).toEqual([{ event: 'plan_extra_logged', params: { kind: 'class', entry: 'skipped', relative: 'past' } }]);
  });

  it('a double tap posts once', async () => {
    api.on('POST', PATH, Reply.delayed(50, Reply.ok(ANSWER)));
    await render(<Harness />);
    await press('Swim');
    await press('30 minutes');
    await fireEvent.press(saveButton());
    await fireEvent.press(saveButton());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 80)));
    await act(async () => settle());
    expect(api.sentAll(PATH, 'POST')).toHaveLength(1);
  });

  it('while saving nothing can be changed and the sheet cannot be cancelled', async () => {
    api.on('POST', PATH, Reply.delayed(100, Reply.ok(ANSWER)));
    await render(<Harness />);
    await press('Swim');
    await press('30 minutes');
    await fireEvent.press(saveButton());
    await act(async () => settle());
    expect(screen.getByRole('button', { name: 'Gym' })).toBeDisabled();
    expect(screen.getByRole('button', { name: en('common.cancel') })).toBeDisabled();
    expect(screen.getByTestId('logworkout.note')).toHaveProp('editable', false);
    expect(handlers.onClose).not.toHaveBeenCalled();
    // The answer lands, and the sheet closes.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 150)));
    await act(async () => settle());
    expect(handlers.onResult).toHaveBeenCalledTimes(1);
  });
});

describe('refusals', () => {
  it('the 5-a-day refusal keeps the sheet open with the limit line; a retry reuses the key, a change mints one', async () => {
    api.on('POST', PATH, LIMIT);
    const spoken = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await render(<Harness />);
    await press('Gym');
    await press('45 minutes');
    await pressID('logworkout.save');
    expect(screen.getByTestId('logworkout.error')).toHaveTextContent(en('logworkout.limit'));
    expect(title()).toBeOnTheScreen();
    expect(handlers.onResult).not.toHaveBeenCalled();
    expect(spoken).toHaveBeenCalledWith(en('logworkout.limit'));
    spoken.mockRestore();
    const first = api.sent(PATH, 'POST').headers['idempotency-key'];

    await pressID('logworkout.save');
    const retry = api.sent(PATH, 'POST').headers['idempotency-key'];
    expect(retry).toBe(first);

    await press('60 minutes');
    // A new choice clears the line.
    expect(screen.queryByTestId('logworkout.error')).toBeNull();
    await pressID('logworkout.save');
    expect(api.sent(PATH, 'POST').headers['idempotency-key']).not.toBe(first);
  });

  it('offline says it needs a connection and keeps the sheet', async () => {
    api.on('POST', PATH, Reply.fail());
    await render(<Harness />);
    await press('Gym');
    await press('45 minutes');
    await pressID('logworkout.save');
    expect(screen.getByTestId('logworkout.error')).toHaveTextContent(en('health.offline.action_hint'));
    expect(title()).toBeOnTheScreen();
    expect(saveButton()).toBeEnabled();
  });

  it('changed elsewhere closes the sheet and asks Plan to read again', async () => {
    api.on('POST', PATH, Reply.problem(409, 'session_action_not_allowed', { reason: 'too_old' }));
    await render(<Harness />);
    await press('Gym');
    await press('45 minutes');
    await pressID('logworkout.save');
    expect(handlers.onChangedElsewhere).toHaveBeenCalledTimes(1);
    expect(handlers.onResult).not.toHaveBeenCalled();
    expect(useHealthStore.getState().toastKey).toBe('health.err.changed');
    expect(title()).toBeNull();
  });

  it('the membership gate closes it too', async () => {
    api.on('POST', PATH, Reply.problem(403, 'no_active_plan_or_pass'));
    await render(<Harness />);
    await press('Gym');
    await press('45 minutes');
    await pressID('logworkout.save');
    expect(handlers.onChangedElsewhere).toHaveBeenCalledTimes(1);
    expect(title()).toBeNull();
  });

  it('a 400 on another field, or a server error, is the general line', async () => {
    api.on('POST', PATH, Reply.problem(400, 'invalid_session_action', { errors: [{ field: 'note', message: 'too long' }] }));
    await render(<Harness />);
    await press('Gym');
    await press('45 minutes');
    await pressID('logworkout.save');
    expect(screen.getByTestId('logworkout.error')).toHaveTextContent(en('common.error_body'));

    api.on('POST', PATH, Reply.problem(500, 'internal_error'));
    await pressID('logworkout.save');
    expect(screen.getByTestId('logworkout.error')).toHaveTextContent(en('common.error_body'));
    expect(title()).toBeOnTheScreen();
  });
});

describe('other minutes', () => {
  it('Other opens the field; 1 to 300 is taken, anything else says so', async () => {
    api.on('POST', PATH, Reply.ok(ANSWER));
    await render(<Harness />);
    await press('Gym');
    expect(screen.queryByTestId('logworkout.minutes.field')).toBeNull();
    await pressID('logworkout.minutes.other');
    const field = screen.getByTestId('logworkout.minutes.field');
    // The unit beside the field is drawn, but TalkBack reads the field's own label.
    expect(screen.getByText('min', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(saveButton()).toBeDisabled();

    await fireEvent.changeText(field, '400');
    expect(screen.getByText(en('logworkout.minutes_range'))).toBeOnTheScreen();
    expect(saveButton()).toBeDisabled();

    await fireEvent.changeText(field, '4 2');
    expect(screen.queryByText(en('logworkout.minutes_range'))).toBeNull();
    expect(screen.getByTestId('logworkout.minutes.field')).toHaveProp('value', '42');
    await pressID('logworkout.save');
    expect(api.sent(PATH, 'POST').body).toEqual({ action: 'done', asExtra: true, kind: 'strength', minutes: 42 });
  });

  it('a preset chip after Other puts the field away', async () => {
    await render(<Harness />);
    await pressID('logworkout.minutes.other');
    expect(screen.getByTestId('logworkout.minutes.field')).toBeOnTheScreen();
    await press('90 minutes');
    expect(screen.queryByTestId('logworkout.minutes.field')).toBeNull();
  });
});

describe('the note', () => {
  it('shows its count from 120 and stops at 140', async () => {
    await render(<Harness />);
    const note = screen.getByTestId('logworkout.note');
    await fireEvent.changeText(note, 'a'.repeat(119));
    expect(screen.queryByTestId('logworkout.note.count')).toBeNull();
    await fireEvent.changeText(note, 'a'.repeat(125));
    expect(screen.getByTestId('logworkout.note.count')).toHaveTextContent(en('logworkout.note_count', { count: '125' }));
    await fireEvent.changeText(note, 'a'.repeat(200));
    expect(screen.getByTestId('logworkout.note')).toHaveProp('value', 'a'.repeat(140));
    expect(screen.getByTestId('logworkout.note.count')).toHaveTextContent(en('logworkout.note_count', { count: '140' }));
  });

  it('grows to four lines at any text size before it scrolls', async () => {
    const { unmount } = await render(<Harness />);
    const style = () => StyleSheet.flatten(screen.getByTestId('logworkout.note').props.style);
    const atDefault = style().maxHeight as number;
    await unmount();
    setTestFontScale(2);
    await render(<Harness />);
    expect(style().maxHeight as number).toBeGreaterThan(atDefault * 1.5);
    // Every choice is still there at the largest text sizes.
    expect(screen.getByRole('button', { name: 'Run or walk' })).toBeOnTheScreen();
    expect(screen.getByTestId('logworkout.save')).toBeOnTheScreen();
  });

  it('Return ends the note instead of adding a line', async () => {
    await render(<Harness />);
    await fireEvent.changeText(screen.getByTestId('logworkout.note'), 'Leg day\n');
    expect(screen.getByTestId('logworkout.note')).toHaveProp('value', 'Leg day');
  });
});

describe('the pull line', () => {
  const saturday = { id: 's-sat', scheduledFor: '2026-10-17', kind: 'strength' as const, status: 'planned' as const };

  it("on today's rest day it names the later session and hands over to the pull", async () => {
    await render(<Harness pullCandidate={saturday} />);
    const line = "Was it Saturday's session? Do it today instead";
    expect(screen.getByText(line)).toBeOnTheScreen();
    await press(line);
    expect(handlers.onClose).toHaveBeenCalled();
    expect(handlers.onPull).toHaveBeenCalledTimes(1);
  });

  it('not on a past card, nor on a day that is not a rest day', async () => {
    const { unmount } = await render(<Harness cardDate={YESTERDAY} session={rest({ scheduledFor: YESTERDAY })} pullCandidate={saturday} />);
    expect(screen.queryByTestId('logworkout.pull')).toBeNull();
    await unmount();

    await render(<Harness session={rest({ kind: 'strength', status: 'done', title: 'Legs' })} pullCandidate={saturday} />);
    expect(screen.queryByTestId('logworkout.pull')).toBeNull();
  });
});

it('Cancel closes the sheet without a request', async () => {
  await render(<Harness />);
  await press('Gym');
  await press(en('common.cancel'));
  expect(handlers.onClose).toHaveBeenCalledTimes(1);
  expect(title()).toBeNull();
  expect(api.sentAll(PATH, 'POST')).toHaveLength(0);
});
