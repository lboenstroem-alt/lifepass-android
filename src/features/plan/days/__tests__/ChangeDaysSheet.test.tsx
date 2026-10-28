/**
 * The change-days sheet on screen, opened the way every caller opens it
 * (`openChangeDays` drawn by `ChangeDaysHost`): Save only with exactly the
 * plan's number of days, `select` mode that sends nothing, `program` mode
 * whose body is the training days and nothing else, the refusals, the
 * cancel, and one sheet at a time.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, Reply } from '@test/server';

import { expectSentToMatchContract, stubApiClientPerTest } from '../../../../api/testing';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { translate } from '../../../../i18n';
import { setAnalyticsObserver } from '../../../../lib/analytics';
import { ChangeDaysHost, openChangeDays, type ChangeDaysMode } from '..';
import { resetChangeDaysPresenterForTests, useChangeDaysPresenter } from '../presenter';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const PROGRAM = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const en = (key: string, params?: Record<string, string>) => translate(key, 'en', params);

const save = () => screen.getByTestId('days.save');
const chip = (weekday: number) => screen.getByTestId(`days.chip.${weekday}`);

async function open(mode: ChangeDaysMode) {
  await render(<ChangeDaysHost />);
  await act(async () => openChangeDays(mode));
}

function programDetail(trainingDays: number[]) {
  return {
    program: {
      id: PROGRAM,
      status: 'active',
      daysPerWeek: trainingDays.length,
      trainingDays,
      weekPlans: [{ weekNo: 1, days: [] }],
    },
    week: null,
    day: null,
    upcoming: [],
  };
}

beforeEach(() => {
  bottomSheetMock.reset();
  resetChangeDaysPresenterForTests();
  setAnalyticsObserver(null);
});

describe('select mode (the programme wizard)', () => {
  it('Save waits for exactly the count, then hands the days back in weekday order and sends nothing', async () => {
    const picked = jest.fn();
    const cancelled = jest.fn();
    await open({ kind: 'select', daysPerWeek: 3, selected: [1, 3], onPicked: picked, onCancel: cancelled });

    expect(screen.getByRole('header', { name: en('plan.days.title') })).toBeOnTheScreen();
    expect(screen.getByText(en('plan.days.body', { count: '3' }))).toBeOnTheScreen();
    expect(screen.getByText(en('plan.days.note'))).toBeOnTheScreen();
    expect(chip(1).props.accessibilityState.selected).toBe(true);
    expect(chip(2).props.accessibilityState.selected).toBe(false);
    expect(save()).toBeDisabled();

    await fireEvent.press(chip(6));
    expect(save()).toBeEnabled();
    // A fourth day is one too many.
    await fireEvent.press(chip(7));
    expect(save()).toBeDisabled();
    await fireEvent.press(chip(7));

    await fireEvent.press(save());
    await waitFor(() => expect(picked).toHaveBeenCalledWith([1, 3, 6]));
    expect(cancelled).not.toHaveBeenCalled();
    expect(api.sentAll('/health/programs/' + PROGRAM)).toHaveLength(0);
    expect(useChangeDaysPresenter.getState().request).toBeNull();
  });

  it('closed by hand answers the cancel exactly once', async () => {
    const picked = jest.fn();
    const cancelled = jest.fn();
    await open({ kind: 'select', daysPerWeek: 2, selected: [], onPicked: picked, onCancel: cancelled });
    await act(async () => bottomSheetMock.latest()?.onDismiss?.());
    await waitFor(() => expect(cancelled).toHaveBeenCalledTimes(1));
    expect(picked).not.toHaveBeenCalled();
    expect(useChangeDaysPresenter.getState().request).toBeNull();
  });
});

describe('program mode', () => {
  it('posts the training days and NOTHING else, with a fresh Idempotency-Key, and hands back the programme', async () => {
    const events: string[] = [];
    setAnalyticsObserver((event) => events.push(event));
    api.on('POST', `/health/programs/${PROGRAM}`, Reply.ok(programDetail([2, 4, 6])));
    const saved = jest.fn();
    await open({ kind: 'program', programId: PROGRAM, daysPerWeek: 3, selected: [1, 3, 5], onSaved: saved });

    await fireEvent.press(chip(1));
    await fireEvent.press(chip(3));
    await fireEvent.press(chip(5));
    await fireEvent.press(chip(6));
    await fireEvent.press(chip(4));
    await fireEvent.press(chip(2));
    await fireEvent.press(save());

    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    const sent = expectSentToMatchContract('POST', `/health/programs/${PROGRAM}`);
    expect(sent.body).toEqual({ trainingDays: [2, 4, 6] });
    expect(sent.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    const result = saved.mock.calls[0][0];
    expect(result.days).toEqual([2, 4, 6]);
    expect(result.program.program.trainingDays).toEqual([2, 4, 6]);
    expect(events).toEqual(['training_days_changed']);
  });

  it('a plan changed elsewhere closes the sheet and tells the caller', async () => {
    api.on('POST', `/health/programs/${PROGRAM}`, Reply.problem(409, 'program_action_not_allowed', { reason: 'not_live' }));
    const changed = jest.fn();
    const saved = jest.fn();
    const cancelled = jest.fn();
    await open({
      kind: 'program',
      programId: PROGRAM,
      daysPerWeek: 2,
      selected: [1, 4],
      onSaved: saved,
      onChanged: changed,
      onCancel: cancelled,
    });
    await fireEvent.press(save());
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(saved).not.toHaveBeenCalled();
    expect(cancelled).not.toHaveBeenCalled();
    expect(useChangeDaysPresenter.getState().request).toBeNull();
  });

  it('offline keeps the sheet with "This needs a connection.", and a retry mints a new key', async () => {
    api.on('POST', `/health/programs/${PROGRAM}`, Reply.fail());
    await open({ kind: 'program', programId: PROGRAM, daysPerWeek: 2, selected: [1, 4] });
    await fireEvent.press(save());
    expect(await screen.findByText(en('health.offline.action_hint'))).toBeOnTheScreen();
    expect(useChangeDaysPresenter.getState().visible).toBe(true);

    api.on('POST', `/health/programs/${PROGRAM}`, Reply.problem(500, 'internal_error'));
    await fireEvent.press(save());
    expect(await screen.findByText(en('common.error_body'))).toBeOnTheScreen();
    const keys = api.sentAll(`/health/programs/${PROGRAM}`, 'POST').map((r) => r.headers['idempotency-key']);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('one sheet at a time', () => {
  it('a second request while one is up is answered with its cancel', async () => {
    const first = jest.fn();
    const second = jest.fn();
    await open({ kind: 'select', daysPerWeek: 2, selected: [], onPicked: jest.fn(), onCancel: first });
    await act(async () => openChangeDays({ kind: 'select', daysPerWeek: 3, selected: [], onPicked: jest.fn(), onCancel: second }));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(screen.getByText(en('plan.days.body', { count: '2' }))).toBeOnTheScreen();
  });

  it('with no host mounted (signed out) the request is answered with its cancel at once', () => {
    const cancelled = jest.fn();
    openChangeDays({ kind: 'select', daysPerWeek: 2, selected: [], onPicked: jest.fn(), onCancel: cancelled });
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});
