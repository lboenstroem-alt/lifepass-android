/**
 * The preview card as drawn (iOS `PlanEditPreviewCard`): the server's words
 * of the change (summary, groups, "before → after", the member's own
 * exercise tagged), the equipment it will and will not use again, what could
 * not be done on its own lines, the variant switch, and each state (Apply
 * waiting while today's workout is open, "Changed · Undo" with the summary,
 * Undone with the days kept, Cancelled, Replaced, No longer open). The
 * actions are the flow's (./planEditFlow.test.ts); here only that each
 * control calls the right one. And the consent bubble.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { setCurrentLanguage, translate, type Params } from '../../../../i18n';
import { useAppStore } from '../../../../stores/appStore';
import { useRunnerProgress } from '../../../runner';
import type { CoachFlowBubble } from '../../store/messages';
import { PlanEditMessageKind, type PlanEditCardPayload } from '../flow';
import PlanEditCard, { itemText, variantLabel } from '../PlanEditCard';
import PlanEditConsentBubble from '../PlanEditConsentBubble';
import { decodePreview } from '../types';

import { EDIT_A, EDIT_B, PROGRAM_ID, previewJson, TODAY_SESSION } from './planEditFixtures';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('../flow', () => ({
  ...jest.requireActual('../flow'),
  applyCard: jest.fn(async () => undefined),
  cancelCard: jest.fn(),
  undoCard: jest.fn(async () => undefined),
  selectVariant: jest.fn(),
  grantConsentFor: jest.fn(async () => undefined),
  declineConsentFor: jest.fn(),
}));

const flow = jest.requireMock('../flow') as Record<
  'applyCard' | 'cancelCard' | 'undoCard' | 'selectVariant' | 'grantConsentFor' | 'declineConsentFor',
  jest.Mock
>;

const en = (key: string, params?: Params) => translate(key, 'en', params);

function message(payload: Partial<PlanEditCardPayload> = {}, variants = [decodePreview(previewJson(), 'v')]): CoachFlowBubble {
  return {
    id: 'm1',
    role: 'assistant',
    text: '',
    isHealth: true,
    flow: 'planEdit',
    kind: PlanEditMessageKind.preview,
    payload: {
      programId: PROGRAM_ID,
      requestId: 'r1',
      variants,
      selected: 0,
      status: 'pending',
      applied: null,
      errorKey: null,
      undoBlockedKey: null,
      keptRows: 0,
      ...payload,
    } satisfies PlanEditCardPayload,
  };
}

const applied = (extra: Partial<NonNullable<PlanEditCardPayload['applied']>> = {}) => ({
  editId: EDIT_A,
  undoUntil: new Date('2099-01-01'),
  undoable: true,
  summary: 'Push-ups on your Push days.',
  ...extra,
});

beforeEach(() => {
  setCurrentLanguage('en');
  for (const mock of Object.values(flow)) if (jest.isMockFunction(mock)) mock.mockClear();
  useRunnerProgress.setState({ summary: null, profileId: null });
});

describe('the open card', () => {
  it("draws the change in the server's words, with the app's own frame around it", async () => {
    await render(<PlanEditCard message={message()} busy={false} />);
    expect(screen.getByText(en('coach.planEdit.cardTitle').toUpperCase())).toBeOnTheScreen();
    expect(screen.getByText('Push-ups instead of barbell bench press on Push days.')).toBeOnTheScreen();
    expect(screen.getByText('Push, every time from Sat 24 Oct')).toBeOnTheScreen();
    expect(screen.getByText('Barbell bench press → Push-up')).toBeOnTheScreen();
    expect(screen.getByText('Zottman curls')).toBeOnTheScreen();
    expect(screen.getByText(en('coach.planEdit.ownTag'))).toBeOnTheScreen();
    expect(screen.getByText(en('coach.planEdit.wontUse', { labels: 'Barbell' }))).toBeOnTheScreen();
  });

  it('says what it can use again, what could not be done on lines of its own, and a cycle\'s note', async () => {
    const variant = decodePreview(
      previewJson({
        exclusions: { added: [], removed: [{ kind: 'equipment', id: 'dumbbell', label: 'Dumbbells' }] },
        becomesCustom: true,
        becomesCustomNote: 'Your plan will repeat every 4 days.',
        notApplied: [{ reason: 'over_limit', text: '50 sets was capped at 6.' }],
        notAppliedNote: "Some of it couldn't be done:",
      }),
      'v',
    );
    await render(<PlanEditCard message={message({}, [variant])} busy={false} />);
    expect(screen.getByText(en('coach.planEdit.useAgain', { labels: 'Dumbbells' }))).toBeOnTheScreen();
    expect(screen.getByText('Your plan will repeat every 4 days.')).toBeOnTheScreen();
    expect(screen.getByText("Some of it couldn't be done:")).toBeOnTheScreen();
    expect(screen.getByText('50 sets was capped at 6.')).toBeOnTheScreen();
  });

  it('Apply and Cancel call the flow with the card; Apply waits while a reply is in flight', async () => {
    await render(<PlanEditCard message={message()} busy={false} />);
    await fireEvent.press(screen.getByTestId('coach.planEdit.apply'));
    expect(flow.applyCard).toHaveBeenCalledWith('m1');
    await fireEvent.press(screen.getByTestId('coach.planEdit.cancel'));
    expect(flow.cancelCard).toHaveBeenCalledWith('m1');
    await render(<PlanEditCard message={message()} busy />);
    expect(screen.getByTestId('coach.planEdit.apply')).toBeDisabled();
  });

  it("with two variants, a switch with each one's label", async () => {
    const variants = [
      decodePreview(previewJson({ editId: EDIT_A, label: 'Our exercise: Dumbbell bench press' }), 'a'),
      decodePreview(previewJson({ editId: EDIT_B, label: null, recommended: false }), 'b'),
    ];
    await render(<PlanEditCard message={message({}, variants)} busy={false} />);
    expect(screen.getByText('Our exercise: Dumbbell bench press')).toBeOnTheScreen();
    expect(screen.getByText(en('coach.planEdit.variantOwn'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('coach.planEdit.variant.1'));
    expect(flow.selectVariant).toHaveBeenCalledWith('m1', 1);
  });

  it("Apply waits while today's workout is open in the runner, and says why", async () => {
    useRunnerProgress.setState({
      summary: { sessionId: TODAY_SESSION, exercise: 2, total: 5, title: 'Push', scheduledFor: '2026-10-23' },
      profileId: 'p',
    });
    const variant = decodePreview(previewJson({ touchesToday: true, todaySessionId: TODAY_SESSION }), 'v');
    await render(<PlanEditCard message={message({}, [variant])} busy={false} />);
    expect(screen.getByText(en('coach.planEdit.runnerOpen'))).toBeOnTheScreen();
    expect(screen.getByTestId('coach.planEdit.apply')).toBeDisabled();
  });

  it('a refusal shows under it', async () => {
    await render(<PlanEditCard message={message({ errorKey: 'health.offline.action_hint' })} busy={false} />);
    expect(screen.getByText(en('health.offline.action_hint'))).toBeOnTheScreen();
  });
});

describe('what became of it', () => {
  it('applied: "Changed · Undo" with the summary, while the server says it can be undone', async () => {
    await render(<PlanEditCard message={message({ status: 'applied', applied: applied() })} busy={false} />);
    expect(screen.getByText(en('coach.planEdit.changed'))).toBeOnTheScreen();
    expect(screen.getByText('Push-ups on your Push days.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('coach.planEdit.undo'));
    expect(flow.undoCard).toHaveBeenCalledWith('m1');
    expect(screen.queryByTestId('coach.planEdit.apply')).toBeNull();
  });

  it('applied past its window, or refused for good: "Changed" alone, and why', async () => {
    await render(<PlanEditCard message={message({ status: 'applied', applied: applied({ undoUntil: new Date('2020-01-01') }) })} busy={false} />);
    expect(screen.queryByTestId('coach.planEdit.undo')).toBeNull();
    await render(
      <PlanEditCard message={message({ status: 'applied', applied: applied(), undoBlockedKey: 'coach.planEdit.error.undoChanged' })} busy={false} />,
    );
    expect(screen.queryByTestId('coach.planEdit.undo')).toBeNull();
    expect(screen.getByText(en('coach.planEdit.error.undoChanged'))).toBeOnTheScreen();
  });

  it('undone, with the days kept when there were some', async () => {
    await render(<PlanEditCard message={message({ status: 'undone', keptRows: 2 })} busy={false} />);
    expect(screen.getByText(en('coach.planEdit.undone'))).toBeOnTheScreen();
    expect(screen.getByText(en('coach.planEdit.keptRows'))).toBeOnTheScreen();
  });

  it.each([
    ['cancelled', 'coach.planEdit.cancelled'],
    ['superseded', 'coach.planEdit.superseded'],
    ['stale', 'coach.planEdit.staleCard'],
  ] as const)('%s says so, with no buttons', async (status, key) => {
    await render(<PlanEditCard message={message({ status })} busy={false} />);
    expect(screen.getByText(en(key))).toBeOnTheScreen();
    expect(screen.queryByTestId('coach.planEdit.apply')).toBeNull();
  });
});

describe('the lines', () => {
  it('a rest day, a title, the cycle and the days are one line: what they become', () => {
    expect(itemText({ type: 'rest', before: 'Push', after: 'Rest day', own: false })).toBe('Rest day');
    expect(itemText({ type: 'cycle', before: null, after: 'Repeats every 4 days', own: false })).toBe('Repeats every 4 days');
    expect(itemText({ type: 'dose', before: '3 × 10', after: '4 × 10', own: false })).toBe('3 × 10 → 4 × 10');
    expect(itemText({ type: 'remove', before: 'Plank', after: null, own: false })).toBe('Plank');
  });

  it("a variant without a label is ours (or the recommended one), then the member's own", () => {
    const t = (key: string) => en(key);
    expect(variantLabel(decodePreview(previewJson({ label: null, recommended: false }), 'v'), 0, t)).toBe(en('coach.planEdit.variantOurs'));
    expect(variantLabel(decodePreview(previewJson({ label: null, recommended: false }), 'v'), 1, t)).toBe(en('coach.planEdit.variantOwn'));
    expect(variantLabel(decodePreview(previewJson({ label: null, recommended: true }), 'v'), 1, t)).toBe(en('coach.planEdit.variantOurs'));
  });
});

describe('the consent', () => {
  const consent = (status: 'idle' | 'granting' | 'granted' | 'declined' = 'idle'): CoachFlowBubble => ({
    id: 'c1',
    role: 'assistant',
    text: '',
    flow: 'planEdit',
    kind: PlanEditMessageKind.consent,
    payload: { requestId: 'r1', status, errorKey: null },
  });

  it('names the plan change (v4), and grants on one tap or says not now', async () => {
    await render(<PlanEditConsentBubble message={consent()} busy={false} />);
    expect(screen.getByText(en('coach.planEdit.consent.title'))).toBeOnTheScreen();
    expect(screen.getByText(en('healthconsent.ai.plan_edit'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('coach.planEdit.consent'));
    expect(flow.grantConsentFor).toHaveBeenCalledWith('c1');
    await fireEvent.press(screen.getByTestId('coach.planEdit.consentNotNow'));
    expect(flow.declineConsentFor).toHaveBeenCalledWith('c1');
  });

  it('also shows the describe line to a consent older than v3 (v4 covers both)', async () => {
    const withConsent = (version: string) =>
      useAppStore.setState((state) => ({
        profile: { ...(state.profile ?? {}), health: { ...(state.profile?.health ?? {}), consent: { version, consentedAt: '2026-09-20T10:00:00Z', ageSource: 'kennitala' } } } as never,
      }));
    withConsent('2026-09-v2');
    const first = await render(<PlanEditConsentBubble message={consent()} busy={false} />);
    expect(screen.getByText(en('healthconsent.ai.describe'))).toBeOnTheScreen();
    expect(screen.getByText(en('healthconsent.ai.plan_edit'))).toBeOnTheScreen();
    await first.unmount();
    withConsent('2026-09-v3');
    const second = await render(<PlanEditConsentBubble message={consent()} busy={false} />);
    expect(screen.queryByText(en('healthconsent.ai.describe'))).toBeNull();
    expect(screen.getByText(en('healthconsent.ai.plan_edit'))).toBeOnTheScreen();
    await second.unmount();
    useAppStore.setState({ profile: null } as never);
  });

  it('goes once answered', async () => {
    await render(<PlanEditConsentBubble message={consent('granted')} busy={false} />);
    expect(screen.queryByTestId('coach.planEdit.consentBubble')).toBeNull();
  });
});
