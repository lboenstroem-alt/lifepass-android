/**
 * The weekly check-in sheet on screen, opened the way Plan opens it
 * (`openWeeklyCheckIn` drawn by the review slot's host), and in Body and
 * goals' Log weight mode: what it opens with, what OP-23 and OP-24 are sent,
 * the cross-fade to the fresh review, every refusal (offline, a deleted
 * weigh-in, the membership gate, anything else), a close while it saves, and
 * when TalkBack hears the range error.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, Reply, type StubReply } from '@test/server';
import { AccessibilityInfo } from 'react-native';

import { expectSentToMatchContract, stubApiClientPerTest } from '../../../../api/testing';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { useHealthStore, type CheckInState, type WeighInState } from '../../../../health';
import { translate } from '../../../../i18n';
import { colors } from '../../../../theme';
import { recordAnalytics, freshPlan, settle, signIn } from '../../__tests__/planFixtures';
import {
  openWeeklyCheckIn,
  resetWeeklyCheckInPresenterForTests,
  useWeeklyCheckInPresenter,
} from '../presenter';
import WeeklyCheckInHost from '../WeeklyCheckInHost';
import WeeklyCheckInSheet from '../WeeklyCheckInSheet';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);

const WEIGH_IN = {
  due: true,
  lastWeightKg: 72.5,
  lastMeasuredAt: '2026-10-12T08:00:00Z',
  lastSource: 'self_reported',
  heightCm: 178,
  heightMeasuredAt: '2026-04-01T08:00:00Z',
  heightConfirmDue: false,
};

const REVIEW = {
  id: 'r-2',
  weekStartsOn: '2026-10-12',
  hasPlan: true,
  sessionsPlanned: 3,
  sessionsDone: 2,
  checkInsCount: 1,
  insight: { key: 'insight.steady', text: 'A steady week.' },
};

/** Puts a Today read in the store with this weigh-in and check-in state. */
function today(weighIn: Record<string, unknown> = WEIGH_IN, checkIn: Record<string, unknown> = { due: true, weekStartsOn: '2026-10-12' }) {
  const state = useHealthStore.getState();
  useHealthStore.setState({
    today: {
      ...(state.today ?? ({} as never)),
      contractVersion: '2026-09-v1',
      date: '2026-10-19',
      today: '2026-10-19',
      weighIn: decodeWeighIn(weighIn),
      checkIn: decodeCheckIn(checkIn),
    } as never,
  });
}

function decodeWeighIn(json: Record<string, unknown>): WeighInState {
  return {
    due: (json.due as boolean) ?? null,
    lastWeightKg: (json.lastWeightKg as number) ?? null,
    lastMeasuredAt: json.lastMeasuredAt ? new Date(json.lastMeasuredAt as string) : null,
    lastSource: (json.lastSource as WeighInState['lastSource']) ?? null,
    heightCm: (json.heightCm as number) ?? null,
    heightMeasuredAt: json.heightMeasuredAt ? new Date(json.heightMeasuredAt as string) : null,
    heightConfirmDue: (json.heightConfirmDue as boolean) ?? null,
  };
}

function decodeCheckIn(json: Record<string, unknown>): CheckInState {
  return {
    due: (json.due as boolean) ?? null,
    weekStartsOn: (json.weekStartsOn as string) ?? null,
    recentWeightKg: (json.recentWeightKg as number) ?? null,
  };
}

const checkinAnswer = () => Reply.ok({ measurement: null, review: REVIEW, weighIn: { ...WEIGH_IN, due: false }, checkIn: { due: false } });

async function openFromPlan(entry: 'plan' | 'review_card' | 'notification' = 'plan') {
  await render(<WeeklyCheckInHost />);
  await act(async () => {
    openWeeklyCheckIn(entry);
  });
}

const field = () => screen.getByTestId('plan.checkin.weight.input');
const save = () => screen.getByTestId('plan.checkin.save');

beforeEach(() => {
  freshPlan();
  bottomSheetMock.reset();
  resetWeeklyCheckInPresenterForTests();
  signIn();
});

afterEach(async () => {
  await act(async () => settle());
});

describe('the weekly check-in, from Plan', () => {
  it('opens prefilled with the last weight, says when it was, and reports the door it came through', async () => {
    const events = recordAnalytics();
    today();
    await openFromPlan('review_card');
    expect(screen.getByRole('header', { name: en('checkin.title') })).toBeOnTheScreen();
    expect(screen.getByText(en('checkin.sub'))).toBeOnTheScreen();
    expect(field().props.value).toBe('72.5');
    expect(screen.getByTestId('plan.checkin.weight.line')).toHaveTextContent(en('checkin.last', { kg: '72.5', date: 'Mon 12 Oct' }));
    expect(screen.queryByTestId('plan.checkin.height')).toBeNull();
    expect(events).toContainEqual({ event: 'weekly_checkin_opened', params: { entry: 'review_card' } });
  });

  it('a weight and a rating: OP-23 with its key, then the fresh review, Done, and the day read again', async () => {
    const events = recordAnalytics();
    today();
    api.on('POST', '/health/checkin', checkinAnswer());
    api.on('GET', '/health', Reply.ok({ date: '2026-10-19', today: '2026-10-19' }));
    await openFromPlan();

    await fireEvent.changeText(field(), '71,9');
    await fireEvent.press(screen.getByTestId('plan.checkin.rating.great'));
    expect(screen.getByTestId('plan.checkin.rating.great')).toBeSelected();
    await fireEvent.press(save());

    expect(await screen.findByTestId('plan.checkin.review')).toBeOnTheScreen();
    const sent = expectSentToMatchContract('POST', '/health/checkin');
    expect(sent.rawBody).toBe('{"weekRating":"great","weightKg":71.9}');
    expect(sent.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByRole('header', { name: en('review.title') })).toBeOnTheScreen();
    expect(screen.getByText(en('review.sessions', { done: 2, planned: 3 }))).toBeOnTheScreen();
    expect(screen.getByText('A steady week.')).toBeOnTheScreen();
    // The kicker and the card's own title are not repeated inside the sheet.
    expect(screen.queryByText(en('review.kicker', { date: 'Mon 12 Oct' }).toUpperCase())).toBeNull();
    expect(events.map((e) => e.event)).toEqual(
      expect.arrayContaining(['weekly_checkin_opened', 'weigh_in_logged', 'weekly_review_viewed']),
    );
    expect(events.find((e) => e.event === 'weigh_in_logged')?.params).toEqual({ with_rating: true });
    await waitFor(() => expect(api.sentAll('/health', 'GET').length).toBeGreaterThan(0));

    await fireEvent.press(screen.getByTestId('plan.checkin.done'));
    await waitFor(() => expect(useWeeklyCheckInPresenter.getState().request).toBeNull());
  });

  it('a weight from the last three days is prefilled and skipped: Save waits for a rating, and no weight is sent', async () => {
    today({ ...WEIGH_IN, heightConfirmDue: true }, { due: true, recentWeightKg: 72.1 });
    api.on('POST', '/health/checkin', checkinAnswer());
    await openFromPlan();
    expect(field().props.value).toBe('72.1');
    expect(screen.getByTestId('plan.checkin.skip')).toBeChecked();
    expect(screen.getByTestId('plan.checkin.weight.line')).toHaveTextContent(en('checkin.recent_weight'));
    // The height question waits for a weight to go with.
    expect(screen.queryByTestId('plan.checkin.height')).toBeNull();
    expect(save()).toBeDisabled();

    await fireEvent.press(screen.getByTestId('plan.checkin.rating.ok'));
    await fireEvent.press(save());
    await screen.findByTestId('plan.checkin.review');
    expect(api.sent('/health/checkin', 'POST').rawBody).toBe('{"weekRating":"ok"}');
  });

  it('un-skipping brings the weight back and the height question with it; Yes confirms, Change sends the new height', async () => {
    today({ ...WEIGH_IN, heightConfirmDue: true }, { due: true, recentWeightKg: 72.1 });
    api.on('POST', '/health/checkin', checkinAnswer());
    await openFromPlan();
    await fireEvent.press(screen.getByTestId('plan.checkin.skip'));
    expect(screen.getByTestId('plan.checkin.skip')).not.toBeChecked();
    expect(screen.getByText(en('checkin.height_q', { cm: 178 }))).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('plan.checkin.height.yes'));
    expect(screen.getByTestId('plan.checkin.height.yes')).toBeSelected();
    await fireEvent.press(screen.getByTestId('plan.checkin.height.change'));
    expect(screen.getByTestId('plan.checkin.height.yes')).not.toBeSelected();
    await fireEvent.changeText(screen.getByTestId('plan.checkin.height.field.input'), '181');
    await fireEvent.press(save());
    await screen.findByTestId('plan.checkin.review');
    const sent = expectSentToMatchContract('POST', '/health/checkin');
    expect(sent.body).toEqual({ weightKg: 72.1, heightCm: 181 });
  });

  it('skipping the weight forgets a Yes already given, so nothing pretends to be answered', async () => {
    today({ ...WEIGH_IN, heightConfirmDue: true });
    api.on('POST', '/health/checkin', checkinAnswer());
    await openFromPlan();
    await fireEvent.press(screen.getByTestId('plan.checkin.height.yes'));
    await fireEvent.press(screen.getByTestId('plan.checkin.skip'));
    expect(screen.queryByTestId('plan.checkin.height')).toBeNull();
    await fireEvent.press(screen.getByTestId('plan.checkin.skip'));
    expect(screen.getByTestId('plan.checkin.height.yes')).not.toBeSelected();
  });

  it('a weight outside 30 to 300 kg says so and holds Save; a second tap on a rating clears it', async () => {
    today();
    await openFromPlan();
    await fireEvent.changeText(field(), '301');
    expect(screen.getByTestId('plan.checkin.weight.error')).toHaveTextContent(en('body.err.weight'));
    await fireEvent.press(screen.getByTestId('plan.checkin.rating.tough'));
    expect(save()).toBeDisabled();
    await fireEvent.changeText(field(), '7.2.5');
    expect(screen.getByTestId('plan.checkin.weight.error')).toBeOnTheScreen();
    await fireEvent.changeText(field(), '');
    expect(screen.queryByTestId('plan.checkin.weight.error')).toBeNull();
    expect(save()).toBeEnabled();
    await fireEvent.press(screen.getByTestId('plan.checkin.rating.tough'));
    expect(screen.getByTestId('plan.checkin.rating.tough')).not.toBeSelected();
    expect(save()).toBeDisabled();
    expect(api.sentAll('/health/checkin')).toHaveLength(0);
  });

  it('the steppers move 0.1 kg and the rating steps with TalkBack', async () => {
    today();
    await openFromPlan();
    await fireEvent.press(screen.getByRole('button', { name: en('a11y.increase_weight') }));
    expect(field().props.value).toBe('72.6');
    await fireEvent.press(screen.getByRole('button', { name: en('a11y.decrease_weight') }));
    await fireEvent.press(screen.getByRole('button', { name: en('a11y.decrease_weight') }));
    expect(field().props.value).toBe('72.4');
    await fireEvent(screen.getByTestId('plan.checkin.rating.ok'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(screen.getByTestId('plan.checkin.rating.great')).toBeSelected();
    await fireEvent(screen.getByTestId('plan.checkin.rating.great'), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(screen.getByTestId('plan.checkin.rating.ok')).toBeSelected();
  });

  it('offline says the action needs a connection, and a retry is the same weigh-in (same key)', async () => {
    today();
    // Later routes win: the one-shot failure answers first.
    api.on('POST', '/health/checkin', checkinAnswer());
    api.once('POST', '/health/checkin', Reply.fail());
    await openFromPlan();
    await fireEvent.press(save());
    expect(await screen.findByTestId('plan.checkin.error')).toHaveTextContent(en('health.offline.action_hint'));
    const first = api.sent('/health/checkin', 'POST').headers['idempotency-key'];
    await fireEvent.press(save());
    await screen.findByTestId('plan.checkin.review');
    const sent = api.sentAll('/health/checkin', 'POST');
    expect(sent).toHaveLength(2);
    expect(sent[1]!.headers['idempotency-key']).toBe(first);
  });

  it('a weigh-in deleted elsewhere mints a new key and says the data changed; the sheet stays', async () => {
    today();
    api.on('POST', '/health/checkin', checkinAnswer());
    api.once('POST', '/health/checkin', Reply.problem(409, 'health_measurement_deleted'));
    await openFromPlan();
    await fireEvent.press(save());
    await waitFor(() => expect(useHealthStore.getState().toastKey).toBe('health.err.changed'));
    expect(screen.queryByTestId('plan.checkin.error')).toBeNull();
    expect(useWeeklyCheckInPresenter.getState().visible).toBe(true);
    const first = api.sent('/health/checkin', 'POST').headers['idempotency-key'];
    await fireEvent.press(save());
    await screen.findByTestId('plan.checkin.review');
    expect(api.sent('/health/checkin', 'POST').headers['idempotency-key']).not.toBe(first);
  });

  it('a refusal for want of a membership closes the sheet (the gate answers it)', async () => {
    today();
    api.on('POST', '/health/checkin', Reply.problem(403, 'no_active_plan_or_pass'));
    await openFromPlan();
    await fireEvent.press(save());
    await waitFor(() => expect(useWeeklyCheckInPresenter.getState().request).toBeNull());
  });

  it('anything else says something went wrong and keeps what was typed', async () => {
    today();
    api.on('POST', '/health/checkin', Reply.problem(500, 'internal_error'));
    await openFromPlan();
    await fireEvent.changeText(field(), '70');
    await fireEvent.press(save());
    expect(await screen.findByTestId('plan.checkin.error')).toHaveTextContent(en('common.error_body'));
    expect(field().props.value).toBe('70');
  });

  it('an answer without a review closes the sheet', async () => {
    today();
    api.on('POST', '/health/checkin', Reply.ok({ measurement: null, review: null, weighIn: WEIGH_IN, checkIn: { due: false } }));
    await openFromPlan();
    await fireEvent.press(save());
    await waitFor(() => expect(useWeeklyCheckInPresenter.getState().request).toBeNull());
  });

  it('one sheet at a time; every opening starts afresh with its own key', async () => {
    today();
    api.on('POST', '/health/checkin', Reply.fail());
    await openFromPlan();
    expect(openWeeklyCheckIn('plan')).toBe(false);
    await fireEvent.changeText(field(), '80');
    await fireEvent.press(save());
    await screen.findByTestId('plan.checkin.error');
    const first = api.sent('/health/checkin', 'POST').headers['idempotency-key'];

    const id = useWeeklyCheckInPresenter.getState().request!.id;
    await act(async () => {
      useWeeklyCheckInPresenter.setState({ visible: false });
    });
    await waitFor(() => expect(useWeeklyCheckInPresenter.getState().request).toBeNull());
    expect(useWeeklyCheckInPresenter.getState().request?.id).not.toBe(id);

    await act(async () => {
      openWeeklyCheckIn('plan');
    });
    expect(field().props.value).toBe('72.5');
    expect(screen.queryByTestId('plan.checkin.error')).toBeNull();
    await fireEvent.press(save());
    await screen.findByTestId('plan.checkin.error');
    expect(api.sent('/health/checkin', 'POST').headers['idempotency-key']).not.toBe(first);
  });

  it('the member can close it while it saves, as on iOS: the save runs on, the day is read again, nothing more is drawn', async () => {
    const events = recordAnalytics();
    today();
    let answer: (reply: StubReply) => void = () => undefined;
    api.on('POST', '/health/checkin', () => new Promise<StubReply>((resolve) => (answer = resolve)));
    api.on('GET', '/health', Reply.ok({ date: '2026-10-19', today: '2026-10-19' }));
    await openFromPlan();
    await fireEvent.press(save());
    await waitFor(() => expect(api.sentAll('/health/checkin', 'POST')).toHaveLength(1));
    // Nothing locks the sheet while the request is out.
    expect(bottomSheetMock.latest()!.enablePanDownToClose).toBe(true);

    await act(async () => bottomSheetMock.latest()!.onDismiss!());
    await waitFor(() => expect(useWeeklyCheckInPresenter.getState().request).toBeNull());
    const readsBefore = api.sentAll('/health', 'GET').length;

    await act(async () => {
      answer(checkinAnswer());
      await settle();
    });
    await waitFor(() => expect(api.sentAll('/health', 'GET').length).toBeGreaterThan(readsBefore));
    expect(events.find((e) => e.event === 'weigh_in_logged')?.params).toEqual({ with_rating: false });
    expect(screen.queryByTestId('plan.checkin.review')).toBeNull();
    expect(screen.queryByTestId('plan.checkin.sheet')).toBeNull();
    // A single POST: the close did not resend anything.
    expect(api.sentAll('/health/checkin', 'POST')).toHaveLength(1);
  });

  it('closed while it saves, a weigh-in deleted elsewhere still says the data changed', async () => {
    today();
    let answer: (reply: StubReply) => void = () => undefined;
    api.on('POST', '/health/checkin', () => new Promise<StubReply>((resolve) => (answer = resolve)));
    await openFromPlan();
    await fireEvent.press(save());
    await waitFor(() => expect(api.sentAll('/health/checkin', 'POST')).toHaveLength(1));
    await act(async () => bottomSheetMock.latest()!.onDismiss!());
    await waitFor(() => expect(useWeeklyCheckInPresenter.getState().request).toBeNull());

    await act(async () => {
      answer(Reply.problem(409, 'health_measurement_deleted'));
      await settle();
    });
    await waitFor(() => expect(useHealthStore.getState().toastKey).toBe('health.err.changed'));
  });

  it('nothing opens without a host', () => {
    expect(openWeeklyCheckIn('notification')).toBe(false);
    expect(useWeeklyCheckInPresenter.getState().request).toBeNull();
  });
});

describe('Log weight (Body and goals)', () => {
  function renderLogWeight(handlers: { onClose: () => void; onWeightLogged: () => void }) {
    return render(
      <WeeklyCheckInSheet
        visible
        mode="weightOnly"
        weighIn={decodeWeighIn({ ...WEIGH_IN, heightConfirmDue: true })}
        checkIn={decodeCheckIn({ due: true, recentWeightKg: 72.1 })}
        onClose={handlers.onClose}
        onWeightLogged={handlers.onWeightLogged}
      />,
    );
  }

  it('the field and Save only: OP-24 self-reported, then it closes', async () => {
    const events = recordAnalytics();
    api.on('POST', '/health/measurements', Reply.ok({ measurement: { id: 'm-1', weightKg: 71.4, source: 'self_reported' } }, 201));
    const onClose = jest.fn();
    const onWeightLogged = jest.fn();
    await renderLogWeight({ onClose, onWeightLogged });
    expect(screen.getByRole('header', { name: en('checkin.weight_title') })).toBeOnTheScreen();
    // A recent weight prefills, but never skips, the one field this mode has.
    expect(screen.getByTestId('checkin.sheet.weight.input').props.value).toBe('72.1');
    expect(screen.queryByTestId('checkin.sheet.skip')).toBeNull();
    expect(screen.queryByTestId('checkin.sheet.rating')).toBeNull();
    expect(screen.queryByTestId('checkin.sheet.height')).toBeNull();
    expect(screen.queryByText(en('checkin.sub'))).toBeNull();

    await fireEvent.changeText(screen.getByTestId('checkin.sheet.weight.input'), '71,4');
    await fireEvent.press(screen.getByRole('button', { name: en('body.save') }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onWeightLogged).toHaveBeenCalledWith(expect.objectContaining({ id: 'm-1' }));
    const sent = expectSentToMatchContract('POST', '/health/measurements');
    expect(sent.body).toEqual({ weightKg: 71.4, source: 'self_reported' });
    expect(api.sentAll('/health/checkin')).toHaveLength(0);
    expect(events).toContainEqual({ event: 'weigh_in_logged', params: { with_rating: false } });
  });

  it('an empty field holds Save', async () => {
    await render(
      <WeeklyCheckInSheet visible mode="weightOnly" weighIn={null} checkIn={null} onClose={jest.fn()} onWeightLogged={jest.fn()} />,
    );
    expect(screen.getByRole('button', { name: en('body.save') })).toBeDisabled();
  });
});

describe('the range error, for TalkBack', () => {
  it('is said once the value has stood for a second, not on every key while typing', async () => {
    const spoken = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    await render(
      <WeeklyCheckInSheet visible weighIn={decodeWeighIn(WEIGH_IN)} checkIn={null} onClose={jest.fn()} />,
    );
    const input = () => screen.getByTestId('checkin.sheet.weight.input');
    const said = () => spoken.mock.calls.filter(([text]) => text === en('body.err.weight')).length;
    jest.useFakeTimers();
    try {
      // "7", then "72": out of range for a moment, then fine again. Nothing said.
      await fireEvent.changeText(input(), '');
      await fireEvent.changeText(input(), '7');
      await act(async () => {
        jest.advanceTimersByTime(400);
      });
      await fireEvent.changeText(input(), '72');
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
      expect(said()).toBe(0);

      // "720" stands: said once, and not again while it stays wrong.
      await fireEvent.changeText(input(), '720');
      await act(async () => {
        jest.advanceTimersByTime(999);
      });
      expect(said()).toBe(0);
      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(said()).toBe(1);
      await fireEvent.changeText(input(), '7200');
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
      expect(said()).toBe(1);

      // Gone and back: said again.
      await fireEvent.changeText(input(), '72');
      await fireEvent.changeText(input(), '7');
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(said()).toBe(2);
    } finally {
      jest.useRealTimers();
      spoken.mockRestore();
    }
  });

  it('the field keeps its border; the line under it is what says the weight is wrong (iOS)', async () => {
    await render(<WeeklyCheckInSheet visible weighIn={null} checkIn={null} onClose={jest.fn()} />);
    await fireEvent.changeText(screen.getByTestId('checkin.sheet.weight.input'), '301');
    expect(screen.getByTestId('checkin.sheet.weight.error')).toHaveTextContent(en('body.err.weight'));
    expect(screen.getByTestId('checkin.sheet.weight.field')).not.toHaveStyle({ borderColor: colors.destructive });
  });
});
