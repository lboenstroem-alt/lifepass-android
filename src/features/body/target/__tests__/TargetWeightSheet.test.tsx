/**
 * The target-weight sheet on screen, opened the way every caller opens it
 * (`openTargetSheet` drawn by `BodySheetsHost`): save and remove through
 * `PUT /health/target-weight`, the field checked by the server's rules
 * before anything is sent, a refusal that keeps the sheet open, a route the
 * server no longer has, the goal a target serves (and the plan whose goal is
 * not in hand), and pick mode, which hands the value back and sends nothing.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { decodeProfile } from '../../../../api/profile';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import type { TargetWeightView } from '../../../../health';
import { resetHealthStoreForTests } from '../../../../health/store';
import { restoreTestFontScale, setTestFontScale } from '../../../../hooks/testing';
import { translate } from '../../../../i18n';
import { resetAppStoreForTests, selectSupportsTargetWeight, useAppStore } from '../../../../stores/appStore';
import { BodySheetsHost, openTargetSheet, type TargetSheetMode } from '../../sheets';
import { resetBodySheetPresenterForTests, useBodySheetPresenter } from '../../sheet/presenter';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const PROGRAM = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const en = (key: string, params?: Record<string, string>) => translate(key, 'en', params);

function signIn(options: { weightKg?: number | null; heightCm?: number | null; features?: string[]; livePlan?: boolean } = {}) {
  const features = options.features ?? ['target_weight'];
  const json = {
    id: MEMBER,
    locale: 'en',
    kennitalaVerified: true,
    marketingConsent: false,
    health: {
      access: 'entitled',
      consent: { version: '2026-09-v1', consentedAt: '2026-09-01T09:00:00Z', ageSource: 'kennitala' },
      latest:
        options.weightKg === null
          ? null
          : { weightKg: options.weightKg ?? 80, heightCm: options.heightCm ?? 180, measuredAt: '2026-10-01T08:00:00Z' },
      features,
    },
  };
  const profile = decodeProfile(json);
  useAppStore.setState({
    isAuthenticated: true,
    userId: MEMBER,
    serverFeatures: features,
    profile:
      options.livePlan && profile.health
        ? {
            ...profile,
            health: {
              ...profile.health,
              program: { id: PROGRAM, status: 'active', weekNo: 1, weeks: 4, summaryTitle: null, today: null },
            },
          }
        : profile,
  });
}

const stored = (overrides: Record<string, unknown> = {}) => ({
  targetWeightKg: 72,
  direction: 'lose',
  setAt: '2026-09-20T08:00:00Z',
  reachedAt: null,
  outsideHealthyRange: false,
  appliesTo: 'goal',
  ...overrides,
});

/** The pick mode's `existing`, as the Coach holds it from the Today read. */
const view = (overrides: Partial<TargetWeightView> = {}): TargetWeightView => ({
  targetWeightKg: 75,
  direction: 'lose',
  setAt: null,
  reachedAt: null,
  outsideHealthyRange: false,
  appliesTo: 'goal',
  eta: null,
  ...overrides,
});

function goalEnvelope(goal: Record<string, unknown> | null, targetWeight: Record<string, unknown> | null = null) {
  return Reply.ok({ goal, targetWeight, features: ['target_weight'] });
}

async function open(mode: TargetSheetMode) {
  await render(<BodySheetsHost />);
  await act(async () => openTargetSheet(mode));
}

const button = (key: string) => screen.getByRole('button', { name: en(key) });
const field = () => screen.getByTestId('target.sheet.field.input');

beforeEach(() => {
  bottomSheetMock.reset();
  setTestFontScale(1);
  resetAppStoreForTests();
  resetHealthStoreForTests();
  resetBodySheetPresenterForTests();
});

afterEach(() => {
  restoreTestFontScale();
});

describe('save mode', () => {
  it('the stored target prefills for its goal; Save sends it on the 0.1 kg grid and the caller re-reads once the sheet has gone', async () => {
    signIn();
    api.on('GET', '/health/nutrition-goal', goalEnvelope({ goal: 'lose', activity: 'light' }, stored()));
    api.on('PUT', '/health/target-weight', Reply.ok({ targetWeight: stored({ targetWeightKg: 74.5 }), goal: null, features: ['target_weight'] }));
    const saved = jest.fn();
    const removed = jest.fn();
    await open({ kind: 'save', onSaved: saved, onRemove: removed });

    expect(screen.getByRole('header', { name: en('target.sheet.title') })).toBeOnTheScreen();
    expect(await screen.findByTestId('target.sheet.field.input')).toBeOnTheScreen();
    expect(field().props.value).toBe('72');
    expect(screen.getByTestId('target.sheet.for_goal')).toHaveTextContent(
      en('target.sheet.for_goal', { goal: en('goal.lose') }),
    );
    expect(screen.getByText(en('target.privacy'))).toBeOnTheScreen();

    await fireEvent.changeText(field(), '74,54');
    await fireEvent.press(button('target.sheet.save'));

    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(removed).not.toHaveBeenCalled();
    const sent = api.sent('/health/target-weight', 'PUT');
    expect(sent.rawBody).toBe('{"targetWeightKg":74.5}');
    expect(sent.query).toMatchObject({ locale: 'en' });
    expect(sent.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(useBodySheetPresenter.getState().request).toBeNull();
  });

  it('Remove target asks first, then sends an explicit null and tells the caller it was a removal', async () => {
    signIn();
    api.on('GET', '/health/nutrition-goal', goalEnvelope({ goal: 'lose', activity: 'light' }, stored()));
    api.on('PUT', '/health/target-weight', Reply.ok({ targetWeight: null, goal: null, features: ['target_weight'] }));
    const order: string[] = [];
    await open({ kind: 'save', onSaved: () => order.push('saved'), onRemove: () => order.push('removed') });
    await screen.findByTestId('target.sheet.field.input');

    await fireEvent.press(screen.getByTestId('target.sheet.remove'));
    expect(screen.getByText(en('target.sheet.remove_title'))).toBeOnTheScreen();
    expect(api.sentAll('/health/target-weight')).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('target.sheet.remove.confirm'));

    await waitFor(() => expect(order).toEqual(['saved', 'removed']));
    expect(api.sent('/health/target-weight', 'PUT').rawBody).toBe('{"targetWeightKg":null}');
  });

  it('a target the rules refuse holds Save with its line, and nothing is sent', async () => {
    signIn({ weightKg: 80, heightCm: 170 });
    api.on('GET', '/health/nutrition-goal', goalEnvelope({ goal: 'lose', activity: 'light' }));
    await open({ kind: 'save' });
    await screen.findByTestId('target.sheet.field.input');
    // No stored target: the field opens empty, and Save waits for a value.
    expect(field().props.value).toBe('');
    expect(button('target.sheet.save')).toBeDisabled();
    expect(screen.queryByTestId('target.sheet.remove')).toBeNull();

    await fireEvent.changeText(field(), '79,5');
    expect(screen.getByText(en('target.err.lose_direction'))).toBeOnTheScreen();
    expect(button('target.sheet.save')).toBeDisabled();

    await fireEvent.changeText(field(), '50');
    expect(screen.getByText(en('target.err.bmi_low', { kg: '53.5' }))).toBeOnTheScreen();

    await fireEvent.changeText(field(), '70');
    expect(screen.queryByTestId('target.sheet.field.error')).toBeNull();
    expect(button('target.sheet.save')).toBeEnabled();
    expect(api.sentAll('/health/target-weight')).toHaveLength(0);
  });

  it('program_refused keeps the sheet open with the reason; invalid_target_weight reads target.err.server', async () => {
    signIn();
    api.on('GET', '/health/nutrition-goal', goalEnvelope({ goal: 'gain', activity: 'light' }));
    api.once('PUT', '/health/target-weight', Reply.problem(422, 'program_refused', { reason: 'target_weight_bmi_high' }));
    const saved = jest.fn();
    await open({ kind: 'save', onSaved: saved });
    await screen.findByTestId('target.sheet.field.input');
    await fireEvent.changeText(field(), '95');
    await fireEvent.press(button('target.sheet.save'));

    expect(await screen.findByTestId('target.sheet.refusal')).toHaveTextContent(en('program.refused.target_bmi_high'));
    expect(saved).not.toHaveBeenCalled();
    expect(useBodySheetPresenter.getState().visible).toBe(true);
    // The typed value is still there to change.
    expect(field().props.value).toBe('95');

    api.once('PUT', '/health/target-weight', Reply.problem(422, 'program_refused', { reason: 'target_weight_bmi_low' }));
    await fireEvent.press(button('target.sheet.save'));
    await waitFor(() =>
      expect(screen.getByTestId('target.sheet.refusal')).toHaveTextContent(en('program.refused.target_bmi_low')),
    );

    api.once('PUT', '/health/target-weight', Reply.problem(400, 'invalid-target-weight'));
    await fireEvent.press(button('target.sheet.save'));
    expect(await screen.findByTestId('target.sheet.error')).toHaveTextContent(en('target.err.server'));
    expect(screen.queryByTestId('target.sheet.refusal')).toBeNull();
  });

  it('a 404 that is not a problem: the route is gone, the feature list is stale and the UI it gated hides', async () => {
    signIn();
    api.on('GET', '/health/nutrition-goal', goalEnvelope({ goal: 'lose', activity: 'light' }));
    api.on('PUT', '/health/target-weight', Reply.raw(404, '<html>Not found</html>'));
    await open({ kind: 'save' });
    await screen.findByTestId('target.sheet.field.input');
    await fireEvent.changeText(field(), '75');
    expect(selectSupportsTargetWeight(useAppStore.getState())).toBe(true);
    await fireEvent.press(button('target.sheet.save'));

    expect(await screen.findByTestId('target.sheet.error')).toHaveTextContent(en('common.error_body'));
    expect(selectSupportsTargetWeight(useAppStore.getState())).toBe(false);
  });

  it('offline says the action needs a connection', async () => {
    signIn();
    api.on('GET', '/health/nutrition-goal', goalEnvelope({ goal: 'lose', activity: 'light' }));
    api.on('PUT', '/health/target-weight', Reply.fail());
    await open({ kind: 'save' });
    await screen.findByTestId('target.sheet.field.input');
    await fireEvent.changeText(field(), '75');
    await fireEvent.press(button('target.sheet.save'));
    expect(await screen.findByTestId('target.sheet.error')).toHaveTextContent(en('health.offline.action_hint'));
  });

  it('no goal that takes a target: the sheet says to set one first, offers no Save, and Cancel reports a close', async () => {
    signIn();
    api.on('GET', '/health/nutrition-goal', goalEnvelope({ goal: 'maintain', activity: 'light' }));
    const cancelled = jest.fn();
    await open({ kind: 'save', onCancel: cancelled });

    expect(await screen.findByTestId('target.sheet.needs_goal')).toHaveTextContent(en('target.sheet.needs_goal'));
    expect(screen.queryByTestId('target.sheet.field.input')).toBeNull();
    expect(screen.queryByRole('button', { name: en('target.sheet.save') })).toBeNull();
    expect(screen.queryByTestId('target.sheet.for_goal')).toBeNull();

    await fireEvent.press(button('common.cancel'));
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(api.sentAll('/health/target-weight')).toHaveLength(0);
  });

  it('a reached target opens the field empty, with the note, and can still be removed', async () => {
    signIn();
    api.on(
      'GET',
      '/health/nutrition-goal',
      goalEnvelope({ goal: 'lose', activity: 'light' }, stored({ reachedAt: '2026-10-10T08:00:00Z' })),
    );
    await open({ kind: 'save' });
    expect(await screen.findByTestId('target.sheet.reached')).toHaveTextContent(en('target.reached_prefill_note'));
    expect(field().props.value).toBe('');
    expect(screen.getByTestId('target.sheet.remove')).toBeOnTheScreen();
  });

  it('a plan runs whose goal is not in hand: the day is read, and offline the field still shows for the server to decide', async () => {
    signIn({ livePlan: true });
    api.on('GET', '/health/nutrition-goal', goalEnvelope(null));
    api.on('GET', '/health', Reply.fail());
    await open({ kind: 'save' });

    expect(await screen.findByTestId('target.sheet.field.input')).toBeOnTheScreen();
    expect(api.sentAll('/health', 'GET')).toHaveLength(1);
    expect(screen.queryByTestId('target.sheet.needs_goal')).toBeNull();
    // No goal word: the plan's goal is not known here.
    expect(screen.queryByTestId('target.sheet.for_goal')).toBeNull();
    // The typed value says which way it points, so the rules still hold.
    await fireEvent.changeText(field(), '79,5');
    expect(screen.getByText(en('target.err.lose_direction'))).toBeOnTheScreen();
    await fireEvent.changeText(field(), '75');
    expect(button('target.sheet.save')).toBeEnabled();
  });

  it('a server that has not advertised target_weight is never written to', async () => {
    signIn({ features: [] });
    api.on('GET', '/health/nutrition-goal', Reply.ok({ goal: { goal: 'lose', activity: 'light' }, targetWeight: null, features: [] }));
    await open({ kind: 'save' });
    await screen.findByTestId('target.sheet.field.input');
    await fireEvent.changeText(field(), '75');
    await fireEvent.press(button('target.sheet.save'));
    expect(await screen.findByTestId('target.sheet.error')).toHaveTextContent(en('common.error_body'));
    expect(api.sentAll('/health/target-weight')).toHaveLength(0);
  });
});

describe('pick mode (the Coach confirms first)', () => {
  it('hands the value back once the sheet has gone and sends nothing', async () => {
    signIn();
    const picked: number[] = [];
    await open({ kind: 'pick', goal: 'lose_weight', existing: view(), onPicked: (kg) => picked.push(kg) });

    expect(field().props.value).toBe('75');
    expect(screen.getByTestId('target.sheet.for_goal')).toHaveTextContent(
      en('target.sheet.for_goal', { goal: en('program.goal.lose_weight') }),
    );
    await fireEvent.changeText(field(), '74.26');
    await fireEvent.press(button('target.sheet.use'));

    expect(picked).toEqual([74.3]);
    expect(api.requests).toHaveLength(0);
    expect(useBodySheetPresenter.getState().request).toBeNull();
  });

  it('Remove answers onRemove, Cancel answers onCancel, and neither sends anything', async () => {
    signIn();
    const answers: string[] = [];
    const mode: TargetSheetMode = {
      kind: 'pick',
      goal: 'gain_weight',
      existing: view({ targetWeightKg: 88, direction: 'gain' }),
      onPicked: () => answers.push('picked'),
      onRemove: () => answers.push('removed'),
      onCancel: () => answers.push('cancelled'),
    };
    await open(mode);
    expect(field().props.value).toBe('88');
    await fireEvent.press(screen.getByTestId('target.sheet.remove'));
    await fireEvent.press(screen.getByTestId('target.sheet.remove.confirm'));
    expect(answers).toEqual(['removed']);

    await act(async () => openTargetSheet(mode));
    await fireEvent.press(button('common.cancel'));
    expect(answers).toEqual(['removed', 'cancelled']);
    expect(api.requests).toHaveLength(0);
  });

  it('swiped away, it answers onCancel exactly once and the presenter is free again', async () => {
    signIn();
    const answers: string[] = [];
    const mode: TargetSheetMode = {
      kind: 'pick',
      goal: 'lose_weight',
      existing: view(),
      onPicked: () => answers.push('picked'),
      onCancel: () => answers.push('cancelled'),
    };
    await open(mode);
    await act(async () => bottomSheetMock.latest()?.onDismiss?.());
    expect(answers).toEqual(['cancelled']);
    expect(useBodySheetPresenter.getState()).toEqual({ request: null, visible: false });

    await act(async () => openTargetSheet(mode));
    expect(field().props.value).toBe('75');
    expect(answers).toEqual(['cancelled']);
    expect(api.requests).toHaveLength(0);
  });

  it('a standing target that points the other way does not prefill', async () => {
    signIn();
    await open({ kind: 'pick', goal: 'gain_weight', existing: view(), onPicked: jest.fn() });
    expect(field().props.value).toBe('');
    expect(button('target.sheet.use')).toBeDisabled();
  });
});
