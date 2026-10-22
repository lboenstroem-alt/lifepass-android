/**
 * "Log weight" (iOS `WeeklyCheckInSheet(mode: .weightOnly)`): the prefill,
 * the range, the last weigh-in line (never "From Apple Health"), the body
 * sent, one Idempotency-Key per opening (a new one after a weigh-in deleted
 * elsewhere), the offline line, a membership refusal closing the sheet, and
 * a sheet the member can always close, a save in flight or not (iOS sets no
 * `interactiveDismissDisabled` on it).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { api, Reply, type StubReply } from '@test/server';
import type { ReactElement } from 'react';

import { stubApiClientPerTest } from '../../../../api/testing';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import type { CheckInState, WeighInState } from '../../../../health';
import { resetHealthStoreForTests, useHealthStore } from '../../../../health/store';
import { setCurrentLanguage, translate } from '../../../../i18n';
import * as analytics from '../../../../lib/analytics';
import { resetAppStoreForTests } from '../../../../stores/appStore';
import { settle, signIn } from '../../__tests__/harness';
import LogWeightSheet, { logWeightPrefill, logWeightValidity } from '../LogWeightSheet';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

// A page with a navigator, sheets and the network: room for a busy machine.
jest.setTimeout(30_000);

const en = (key: string, params?: Record<string, string>) => translate(key, 'en', params);

const weighInState = (overrides: Partial<WeighInState> = {}): WeighInState => ({
  due: false,
  lastWeightKg: 72.5,
  lastMeasuredAt: new Date('2026-09-17T08:00:00Z'),
  lastSource: 'self_reported',
  heightCm: 178,
  heightMeasuredAt: null,
  heightConfirmDue: false,
  ...overrides,
});

const checkInState = (recentWeightKg: number | null): CheckInState => ({ due: false, weekStartsOn: null, recentWeightKg });

const MEASUREMENT = { measurement: { id: 'm-9', weightKg: 71.8, heightCm: null, source: 'self_reported', measuredAt: '2026-10-21T08:00:00Z', createdAt: '2026-10-21T08:00:00Z' } };

beforeEach(() => {
  bottomSheetMock.reset();
  resetAppStoreForTests();
  resetHealthStoreForTests();
  signIn();
});

async function open(props: Partial<Parameters<typeof LogWeightSheet>[0]> = {}) {
  const onClose = jest.fn();
  const onWeightLogged = jest.fn();
  const view = await render(
    <LogWeightSheet visible onClose={onClose} weighIn={weighInState()} checkIn={checkInState(null)} onWeightLogged={onWeightLogged} {...props} />,
  );
  return { onClose, onWeightLogged, view };
}

const field = () => screen.getByTestId('bodygoals.logWeight.field.input');

describe('the field', () => {
  it('opens on a weight from the last three days, else the last weigh-in, in the account language', () => {
    expect(logWeightPrefill(weighInState(), checkInState(71.9), 'en')).toBe('71.9');
    expect(logWeightPrefill(weighInState(), checkInState(null), 'is')).toBe('72,5');
    expect(logWeightPrefill(null, null, 'en')).toBe('');
  });

  it('30 to 300 kg; comma or dot; empty is not an error, just nothing to save', () => {
    expect(logWeightValidity('72,5')).toEqual({ value: 72.5, isValid: true });
    expect(logWeightValidity('72.5')).toEqual({ value: 72.5, isValid: true });
    expect(logWeightValidity('29.9')).toEqual({ value: 29.9, isValid: false });
    expect(logWeightValidity('300')).toEqual({ value: 300, isValid: true });
    expect(logWeightValidity('')).toEqual({ value: null, isValid: true });
    expect(logWeightValidity('7.2.5')).toEqual({ value: null, isValid: false });
  });

  it('shows the last weigh-in, the range error, and never names Apple Health', async () => {
    await open({ weighIn: weighInState({ lastSource: 'wearable' }) });
    expect(screen.getByText(en('checkin.weight_title'))).toBeTruthy();
    expect(screen.getByTestId('bodygoals.logWeight.last').props.children).toBe('Last: 72.5 kg on Thu 17 Sept');
    await fireEvent.changeText(field(), '12');
    expect(screen.getByText(en('body.err.weight'))).toBeTruthy();
    expect(screen.queryByTestId('bodygoals.logWeight.last')).toBeNull();
  });
});

describe('saving', () => {
  it('sends the weight as self reported under one key, reports it, hands the weigh-in back and closes', async () => {
    const track = jest.spyOn(analytics, 'track');
    api.on('POST', '/health/measurements', Reply.ok(MEASUREMENT, 201));
    const { onClose, onWeightLogged } = await open();
    await fireEvent.changeText(field(), '71,8');
    await fireEvent.press(screen.getByTestId('bodygoals.logWeight.save'));
    await settle();
    const sent = api.sent('/health/measurements', 'POST');
    expect(sent.body).toEqual({ weightKg: 71.8, source: 'self_reported' });
    expect(sent.headers['idempotency-key']).toBeTruthy();
    expect(track).toHaveBeenCalledWith('weigh_in_logged', { with_rating: false });
    expect(onWeightLogged).toHaveBeenCalledWith(expect.objectContaining({ id: 'm-9', weightKg: 71.8 }));
    expect(onClose).toHaveBeenCalled();
  });

  it('a retry after a failure reuses the key; a weigh-in deleted elsewhere gets a new one and the notice', async () => {
    api.once('POST', '/health/measurements', Reply.problem(500, 'internal_error'));
    await open();
    await fireEvent.press(screen.getByTestId('bodygoals.logWeight.save'));
    await settle();
    expect(screen.getByText(en('common.error_body'))).toBeTruthy();
    const first = api.sent('/health/measurements', 'POST').headers['idempotency-key'];

    api.once('POST', '/health/measurements', Reply.problem(409, 'health_measurement_deleted'));
    await fireEvent.press(screen.getByTestId('bodygoals.logWeight.save'));
    await settle();
    expect(api.sent('/health/measurements', 'POST').headers['idempotency-key']).toBe(first);
    expect(useHealthStore.getState().toastKey).toBe('health.err.changed');

    api.once('POST', '/health/measurements', Reply.ok(MEASUREMENT, 201));
    await fireEvent.press(screen.getByTestId('bodygoals.logWeight.save'));
    await settle();
    expect(api.sent('/health/measurements', 'POST').headers['idempotency-key']).not.toBe(first);
  });

  it('a membership refusal closes the sheet (the store has corrected the access)', async () => {
    api.on('POST', '/health/measurements', Reply.problem(403, 'no_active_plan_or_pass', { memberPricing: 'not_member' }));
    const { onClose, onWeightLogged } = await open();
    await fireEvent.press(screen.getByTestId('bodygoals.logWeight.save'));
    await settle();
    expect(onClose).toHaveBeenCalled();
    expect(onWeightLogged).not.toHaveBeenCalled();
  });

  it('a save in flight never locks the sheet; a late answer still reaches the page but never closes a new opening', async () => {
    let release: (reply: StubReply) => void = () => undefined;
    api.on('POST', '/health/measurements', () => new Promise<StubReply>((resolve) => (release = resolve)));
    const { onClose, onWeightLogged, view } = await open();
    await fireEvent.press(screen.getByTestId('bodygoals.logWeight.save'));
    await settle();
    expect(screen.getByTestId('bodygoals.logWeight.save').props.accessibilityState).toMatchObject({ busy: true });
    const modal = bottomSheetMock.latest()!;
    expect(modal.enablePanDownToClose).toBe(true);
    expect((modal.backdropComponent!({}) as ReactElement<{ pressBehavior?: string }>).props.pressBehavior).toBe('close');

    // The member closes it and opens it again before the answer lands.
    const props = { onClose, weighIn: weighInState(), checkIn: checkInState(null), onWeightLogged };
    await view.rerender(<LogWeightSheet visible={false} {...props} />);
    await view.rerender(<LogWeightSheet visible {...props} />);
    await act(async () => release(Reply.ok(MEASUREMENT, 201)));
    await settle();
    expect(onWeightLogged).toHaveBeenCalledWith(expect.objectContaining({ id: 'm-9' }));
    expect(onClose).not.toHaveBeenCalled();
    // The new opening is untouched: idle, its own Save.
    expect(screen.getByTestId('bodygoals.logWeight.save').props.accessibilityState).not.toMatchObject({ busy: true });
  });

  it('Save is off without a valid weight', async () => {
    await open({ weighIn: null, checkIn: null });
    const save = screen.getByTestId('bodygoals.logWeight.save');
    expect(save.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('in Icelandic', async () => {
    setCurrentLanguage('is');
    signIn({ locale: 'is' });
    await open();
    expect(screen.getByText('Skrá þyngd')).toBeTruthy();
    expect(screen.getByTestId('bodygoals.logWeight.last').props.children).toBe('Síðast: 72,5 kg þann fim., 17. sep.');
  });
});
