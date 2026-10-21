/**
 * The body sheet on screen, opened the way every caller opens it
 * (`openBodySheet` drawn by `BodySheetsHost`): the three modes, the save
 * order, what each save sends, a refusal that keeps the sheet open, the
 * height-only edit, the age band row, and the intake that sends nothing.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { decodeProfile } from '../../../../api/profile';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { decodeProgramSummary, useHealthStore, type HealthDay } from '../../../../health';
import { resetHealthStoreForTests } from '../../../../health/store';
import { restoreTestFontScale, setTestFontScale } from '../../../../hooks/testing';
import { translate } from '../../../../i18n';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { BodySheetsHost, openBodySheet, openTargetSheet, type BodyIntakeResult, type BodySheetMode } from '../../sheets';
import { resetBodySheetPresenterForTests, useBodySheetPresenter } from '../presenter';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const PROGRAM = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const en = (key: string, params?: Record<string, string>) => translate(key, 'en', params);

function signIn(options: { verified?: boolean; weightKg?: number | null; heightCm?: number | null; features?: string[] } = {}) {
  const features = options.features ?? ['target_weight'];
  const json = {
    id: MEMBER,
    locale: 'en',
    kennitalaVerified: options.verified ?? true,
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
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: decodeProfile(json), serverFeatures: features });
}

function goalEnvelope(goal: Record<string, unknown> | null, targetWeight: Record<string, unknown> | null = null) {
  return Reply.ok({ goal, targetWeight, features: ['target_weight'] });
}

async function open(mode: BodySheetMode) {
  await render(<BodySheetsHost />);
  await act(async () => openBodySheet(mode));
}

const button = (key: string) => screen.getByRole('button', { name: en(key) });
const input = (testID: string) => screen.getByTestId(`${testID}.input`);

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

describe('goal mode (the calorie goal without a plan)', () => {
  it('a new goal: a chip, the age band an unverified kennitala needs, then one PUT with goal, details and the touched target', async () => {
    signIn({ verified: false });
    api.on('GET', '/health/nutrition-goal', goalEnvelope(null));
    api.on('PUT', '/health/nutrition-goal', goalEnvelope({ goal: 'lose', activity: 'light' }));
    const saved = jest.fn();
    await open({ kind: 'goal', onSaved: saved });

    expect(await screen.findByRole('header', { name: en('goal.title') })).toBeOnTheScreen();
    await waitFor(() => expect(api.sentAll('/health/nutrition-goal', 'GET')).toHaveLength(1));
    expect(button('goal.save')).toBeDisabled();
    // No target field until a goal points somewhere.
    expect(screen.queryByTestId('body.target.input')).toBeNull();

    await fireEvent.press(screen.getByTestId('body.goal.lose'));
    expect(input('body.target')).toBeOnTheScreen();
    expect(screen.getByText(en('body.err.age'))).toBeOnTheScreen();
    expect(button('goal.save')).toBeDisabled();

    await fireEvent.press(screen.getByTestId('body.age.25_34'));
    await fireEvent.changeText(input('body.target'), '75,0');
    await fireEvent.press(button('goal.save'));

    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    // The weight and height were not changed: no weigh-in.
    expect(api.sentAll('/health/measurements')).toHaveLength(0);
    const sent = api.sent('/health/nutrition-goal', 'PUT');
    expect(sent.body).toEqual({ goal: 'lose', ageBand: '25_34', activity: 'light', customKcal: null, targetWeightKg: 75 });
    expect(sent.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(useBodySheetPresenter.getState().request).toBeNull();
  });

  it('a changed weight is posted first, then the goal', async () => {
    signIn();
    api.on('GET', '/health/nutrition-goal', goalEnvelope({ goal: 'maintain', activity: 'moderate', sex: 'male' }));
    api.on('POST', '/health/measurements', Reply.ok({ measurement: { id: 'm1', weightKg: 81.5, measuredAt: '2026-10-17T08:00:00Z', source: 'self_reported' } }, 201));
    api.on('PUT', '/health/nutrition-goal', goalEnvelope({ goal: 'maintain', activity: 'moderate' }));
    await open({ kind: 'goal' });
    await waitFor(() => expect(screen.getByTestId('body.goal.maintain').props.accessibilityState.selected).toBe(true));

    await fireEvent.changeText(input('body.weight'), '81,5');
    await fireEvent.press(button('goal.save'));
    await waitFor(() => expect(api.sentAll('/health/nutrition-goal', 'PUT')).toHaveLength(1));

    const writes = api.requests.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`);
    expect(writes).toEqual(['POST /health/measurements', 'PUT /health/nutrition-goal']);
    expect(api.sent('/health/measurements', 'POST').body).toEqual({ weightKg: 81.5, heightCm: 180, source: 'self_reported' });
    // The stored details travel back; a verified kennitala sends no age band.
    expect(api.sent('/health/nutrition-goal', 'PUT').body).toEqual({
      goal: 'maintain',
      sex: 'male',
      activity: 'moderate',
      customKcal: null,
    });
  });

  it('program_refused keeps the sheet open, clears nothing, and says why', async () => {
    signIn();
    api.on('GET', '/health/nutrition-goal', goalEnvelope(null));
    api.on('PUT', '/health/nutrition-goal', Reply.problem(422, 'program_refused', { reason: 'bmi_low_lose_weight' }));
    const saved = jest.fn();
    await open({ kind: 'goal', onSaved: saved });
    await waitFor(() => expect(api.sentAll('/health/nutrition-goal', 'GET')).toHaveLength(1));
    await fireEvent.press(screen.getByTestId('body.goal.lose'));
    await fireEvent.press(button('goal.save'));

    expect(await screen.findByText(en('goal.refused.bmi_low'))).toBeOnTheScreen();
    expect(saved).not.toHaveBeenCalled();
    expect(useBodySheetPresenter.getState().visible).toBe(true);
    // The chip the member picked is still picked.
    expect(screen.getByTestId('body.goal.lose').props.accessibilityState.selected).toBe(true);
    // Picking another goal clears the refusal line.
    await fireEvent.press(screen.getByTestId('body.goal.maintain'));
    expect(screen.queryByText(en('goal.refused.bmi_low'))).toBeNull();
  });

  it('a refused target reads the target copy; a server-refused target field reads target.err.server', async () => {
    signIn();
    api.on('GET', '/health/nutrition-goal', goalEnvelope(null));
    api.once('PUT', '/health/nutrition-goal', Reply.problem(422, 'program_refused', { reason: 'target_weight_bmi_high' }));
    await open({ kind: 'goal' });
    await waitFor(() => expect(api.sentAll('/health/nutrition-goal', 'GET')).toHaveLength(1));
    await fireEvent.press(screen.getByTestId('body.goal.gain'));
    await fireEvent.changeText(input('body.target'), '95');
    await fireEvent.press(button('goal.save'));
    expect(await screen.findByText(en('program.refused.target_bmi_high'))).toBeOnTheScreen();

    api.once(
      'PUT',
      '/health/nutrition-goal',
      Reply.problem(400, 'invalid-nutrition-goal', { errors: [{ field: 'targetWeightKg', message: 'too close' }] }),
    );
    await fireEvent.press(button('goal.save'));
    expect(await screen.findByText(en('target.err.server'))).toBeOnTheScreen();
  });

  it('offline says the action needs a connection', async () => {
    signIn();
    api.on('GET', '/health/nutrition-goal', goalEnvelope(null));
    api.on('PUT', '/health/nutrition-goal', Reply.fail());
    await open({ kind: 'goal' });
    await waitFor(() => expect(api.sentAll('/health/nutrition-goal', 'GET')).toHaveLength(1));
    await fireEvent.press(screen.getByTestId('body.goal.maintain'));
    await fireEvent.press(button('goal.save'));
    expect(await screen.findByTestId('body.error')).toHaveTextContent(en('health.offline.action_hint'));
  });

  it('the stored goal prefills the form, the own number included, and Remove goal clears it with its target when no plan uses it', async () => {
    signIn();
    api.on(
      'GET',
      '/health/nutrition-goal',
      goalEnvelope(
        { goal: 'lose', activity: 'active', sex: 'female', customKcal: 2200 },
        { targetWeightKg: 72, direction: 'lose', appliesTo: 'goal' },
      ),
    );
    api.on('PUT', '/health/nutrition-goal', goalEnvelope(null));
    const saved = jest.fn();
    await open({ kind: 'goal', onSaved: saved });

    expect(await screen.findByTestId('body.clear')).toBeOnTheScreen();
    expect(input('body.custom_kcal').props.value).toBe('2200');
    expect(input('body.target').props.value).toBe('72');
    expect(screen.getByTestId('body.activity.active').props.accessibilityState.checked).toBe(true);

    await fireEvent.press(screen.getByTestId('body.clear'));
    expect(screen.getByText(en('goal.clear_title'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('body.clear.confirm'));

    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(api.sent('/health/nutrition-goal', 'PUT').rawBody).toBe('{"goal":null,"targetWeightKg":null}');
  });

  it('Remove goal keeps the target a running plan may still use', async () => {
    signIn();
    useAppStore.setState((s) => ({
      profile: s.profile && {
        ...s.profile,
        health: s.profile.health && {
          ...s.profile.health,
          program: { id: PROGRAM, status: 'active', weekNo: 1, weeks: 4, summaryTitle: null, today: null },
        },
      },
    }));
    api.on(
      'GET',
      '/health/nutrition-goal',
      goalEnvelope({ goal: 'lose', activity: 'light' }, { targetWeightKg: 72, direction: 'lose', appliesTo: 'program' }),
    );
    api.on('PUT', '/health/nutrition-goal', goalEnvelope(null));
    await open({ kind: 'goal' });
    await fireEvent.press(await screen.findByTestId('body.clear'));
    await fireEvent.press(screen.getByTestId('body.clear.confirm'));
    await waitFor(() => expect(api.sentAll('/health/nutrition-goal', 'PUT')).toHaveLength(1));
    expect(api.sent('/health/nutrition-goal', 'PUT').rawBody).toBe('{"goal":null}');
  });

  it('switching the own number off sends an explicit null', async () => {
    signIn();
    api.on('GET', '/health/nutrition-goal', goalEnvelope({ goal: 'maintain', activity: 'light', customKcal: 2200 }));
    api.on('PUT', '/health/nutrition-goal', goalEnvelope({ goal: 'maintain', activity: 'light' }));
    await open({ kind: 'goal' });
    await screen.findByTestId('body.custom_kcal.input');
    await fireEvent.press(screen.getByTestId('body.custom'));
    expect(screen.queryByTestId('body.custom_kcal.input')).toBeNull();
    await fireEvent.press(button('goal.save'));
    await waitFor(() => expect(api.sentAll('/health/nutrition-goal', 'PUT')).toHaveLength(1));
    expect(api.sent('/health/nutrition-goal', 'PUT').body).toMatchObject({ customKcal: null });
  });

  it('an own number outside 1000 to 5000 holds Save with its line', async () => {
    signIn();
    api.on('GET', '/health/nutrition-goal', goalEnvelope({ goal: 'maintain', activity: 'light' }));
    await open({ kind: 'goal' });
    await waitFor(() => expect(screen.getByTestId('body.goal.maintain').props.accessibilityState.selected).toBe(true));
    await fireEvent.press(screen.getByTestId('body.custom'));
    await fireEvent.changeText(input('body.custom_kcal'), '900');
    expect(screen.getByText(en('goal.err.custom'))).toBeOnTheScreen();
    expect(button('goal.save')).toBeDisabled();
  });
});

describe('update mode', () => {
  it('a height-only edit is blocked with the needs-weight line, not the weight line', async () => {
    signIn({ weightKg: null });
    await open({ kind: 'update', programId: null });
    expect(screen.getByText(en('body.more_with_goal'))).toBeOnTheScreen();
    await fireEvent.changeText(input('body.height'), '182');
    expect(screen.getByText(en('body.err.height_needs_weight'))).toBeOnTheScreen();
    expect(screen.queryByText(en('body.err.weight'))).toBeNull();
    expect(button('body.save')).toBeDisabled();
  });

  it('a live programme hears only the details that changed; a weigh-in goes alone', async () => {
    signIn({ verified: false });
    api.on('POST', `/health/programs/${PROGRAM}`, Reply.ok({ program: { id: PROGRAM, status: 'active' } }));
    const saved = jest.fn();
    await open({ kind: 'update', programId: PROGRAM, onSaved: saved });
    // The age band row, for a kennitala that is not verified.
    expect(screen.getByTestId('body.age.18_24')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('body.activity.active'));
    await fireEvent.press(button('body.save'));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(api.sent(`/health/programs/${PROGRAM}`, 'POST').body).toEqual({ body: { activity: 'active' } });
    expect(api.sentAll('/health/measurements')).toHaveLength(0);
  });

  it('nothing changed: no call at all, and the caller still re-reads', async () => {
    signIn();
    const saved = jest.fn();
    await open({ kind: 'update', programId: PROGRAM, onSaved: saved });
    // A verified kennitala: the age comes from it.
    expect(screen.getByText(en('body.age_from_kennitala'))).toBeOnTheScreen();
    expect(screen.queryByTestId('body.age.18_24')).toBeNull();
    await fireEvent.press(button('body.save'));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(api.requests).toHaveLength(0);
  });

  it('Cancel closes with nothing sent and nothing reported', async () => {
    signIn();
    const saved = jest.fn();
    await open({ kind: 'update', programId: null, onSaved: saved });
    await fireEvent.press(button('common.cancel'));
    expect(useBodySheetPresenter.getState().request).toBeNull();
    expect(saved).not.toHaveBeenCalled();
    expect(api.requests).toHaveLength(0);
  });
});

describe('intake mode (the wizard question)', () => {
  const stored = { targetWeightKg: 75, direction: 'lose', setAt: null, reachedAt: null, outsideHealthyRange: false, appliesTo: 'goal', eta: null };

  it('returns the details once the sheet has gone and sends nothing; the stored target prefills untouched', async () => {
    signIn();
    const results: BodyIntakeResult[] = [];
    await open({
      kind: 'intake',
      prefill: { weightKg: 80, heightCm: 180, kennitalaVerified: true, goal: 'lose_weight', target: stored },
      onResult: (result) => results.push(result),
    });
    expect(screen.getByRole('header', { name: en('body.title') })).toBeOnTheScreen();
    expect(input('body.weight').props.value).toBe('80');
    expect(input('body.target').props.value).toBe('75');
    await fireEvent.press(screen.getByTestId('body.sex.female'));
    await fireEvent.press(button('body.use'));

    expect(results).toEqual([
      {
        kind: 'used',
        details: {
          weightKg: 80,
          heightCm: 180,
          ageBand: null,
          sex: 'female',
          activity: 'light',
          targetWeightKg: 75,
          targetWeightTouched: false,
        },
      },
    ]);
    expect(api.requests).toHaveLength(0);
  });

  it('a changed target is touched; a target that breaks the rules holds the button with its line', async () => {
    signIn();
    const results: BodyIntakeResult[] = [];
    await open({
      kind: 'intake',
      prefill: { weightKg: 80, heightCm: 170, kennitalaVerified: true, goal: 'lose_weight', target: stored },
      onResult: (result) => results.push(result),
    });
    await fireEvent.changeText(input('body.target'), '50');
    expect(screen.getByText(en('target.err.bmi_low', { kg: '53.5' }))).toBeOnTheScreen();
    expect(button('body.use')).toBeDisabled();
    await fireEvent.changeText(input('body.target'), '');
    await fireEvent.press(button('body.use'));
    expect(results[0]).toEqual({
      kind: 'used',
      details: expect.objectContaining({ targetWeightKg: null, targetWeightTouched: true }),
    });
  });

  it('no target field for a goal that takes none, or on a server without target_weight', async () => {
    signIn({ features: [] });
    await open({
      kind: 'intake',
      prefill: { weightKg: 80, heightCm: 180, kennitalaVerified: true, goal: 'lose_weight' },
      onResult: jest.fn(),
    });
    expect(screen.queryByTestId('body.target.input')).toBeNull();
  });

  it('opened again, it shows what the wizard was told', async () => {
    signIn();
    await open({
      kind: 'intake',
      prefill: {
        weightKg: 90,
        heightCm: 190,
        kennitalaVerified: false,
        goal: 'build_muscle',
        details: {
          weightKg: 82.5,
          heightCm: 181,
          ageBand: '45_54',
          sex: 'male',
          activity: 'moderate',
          targetWeightKg: null,
          targetWeightTouched: false,
        },
      },
      onResult: jest.fn(),
    });
    expect(input('body.weight').props.value).toBe('82.5');
    expect(input('body.height').props.value).toBe('181');
    expect(screen.getByTestId('body.age.45_54').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('body.sex.male').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('body.activity.moderate').props.accessibilityState.checked).toBe(true);
  });

  it('Skip answers skipped, and an unverified kennitala must give an age band to Use', async () => {
    signIn({ verified: false });
    const results: BodyIntakeResult[] = [];
    await open({
      kind: 'intake',
      prefill: { weightKg: 80, heightCm: 180, kennitalaVerified: false, goal: 'get_fitter' },
      onResult: (result) => results.push(result),
    });
    expect(button('body.use')).toBeDisabled();
    await fireEvent.press(button('body.skip'));
    expect(results).toEqual([{ kind: 'skipped' }]);
  });

  it('a second request while the intake is up is answered cancelled', async () => {
    signIn();
    const first: BodyIntakeResult[] = [];
    const second: BodyIntakeResult[] = [];
    await open({ kind: 'intake', prefill: { kennitalaVerified: true }, onResult: (r) => first.push(r) });
    await act(async () => openBodySheet({ kind: 'intake', prefill: { kennitalaVerified: true }, onResult: (r) => second.push(r) }));
    expect(second).toEqual([{ kind: 'cancelled' }]);
    expect(first).toEqual([]);
  });
});

describe('closing and what comes next', () => {
  /** The member pans the sheet down (or taps the backdrop): the library reports it gone while it is still up. */
  const swipeAway = () => act(async () => bottomSheetMock.latest()?.onDismiss?.());

  it('an intake swiped away answers cancelled exactly once, and the next open works', async () => {
    signIn();
    const results: BodyIntakeResult[] = [];
    await open({ kind: 'intake', prefill: { kennitalaVerified: true }, onResult: (r) => results.push(r) });
    await swipeAway();
    expect(results).toEqual([{ kind: 'cancelled' }]);
    expect(useBodySheetPresenter.getState()).toEqual({ request: null, visible: false });
    expect(screen.queryByRole('header', { name: en('body.title') })).toBeNull();

    const next: BodyIntakeResult[] = [];
    await act(async () => openBodySheet({ kind: 'intake', prefill: { kennitalaVerified: true }, onResult: (r) => next.push(r) }));
    expect(screen.getByRole('header', { name: en('body.title') })).toBeOnTheScreen();
    expect(next).toEqual([]);
    expect(results).toEqual([{ kind: 'cancelled' }]);
  });

  it("a save's callback opens the target sheet, and it shows", async () => {
    signIn();
    const picked: number[] = [];
    await open({
      kind: 'update',
      programId: PROGRAM,
      onSaved: () => openTargetSheet({ kind: 'pick', goal: 'lose_weight', onPicked: (kg) => picked.push(kg) }),
    });
    await fireEvent.press(button('body.save'));
    expect(await screen.findByRole('header', { name: en('target.sheet.title') })).toBeOnTheScreen();
    expect(useBodySheetPresenter.getState().visible).toBe(true);
    expect(useBodySheetPresenter.getState().request?.sheet).toBe('target');
    expect(api.requests).toHaveLength(0);
  });

  it('the field labels are plain text; only the title is a heading, as on iOS', async () => {
    signIn({ verified: false });
    await open({ kind: 'update', programId: PROGRAM });
    expect(screen.getAllByRole('header').map((node) => node.props.children)).toEqual([en('body.title')]);
    expect(screen.getByText(en('body.age'))).toBeOnTheScreen();
    expect(screen.getByText(en('body.sex'))).toBeOnTheScreen();
    expect(screen.getByText(en('body.activity'))).toBeOnTheScreen();
  });
});

describe('the plan note', () => {
  it('while a plan runs, its targets are used instead', async () => {
    signIn();
    useHealthStore.setState({
      today: { program: decodeProgramSummary({ id: PROGRAM, status: 'active', goal: 'get_fitter' }, 'program') } as unknown as HealthDay,
    });
    api.on('GET', '/health/nutrition-goal', goalEnvelope(null));
    await open({ kind: 'goal' });
    expect(await screen.findByText(en('goal.overridden'))).toBeOnTheScreen();
  });
});
