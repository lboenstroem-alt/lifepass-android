/**
 * The preview card as drawn: the server's words of the change (summary,
 * groups, "before → after", the member's own exercise tagged), the
 * equipment it will not use, what could not be done on its own lines, the
 * variant switch, and the buttons for each state (Apply waiting while
 * today's workout is open, "Changed · Undo", Cancelled, Undone). The
 * actions are the flow's (./planEditFlow.test.ts); here only that each
 * control calls the right one.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { setCurrentLanguage, translate, type Params } from '../../../../i18n';
import { useRunnerProgress } from '../../../runner';
import type { CoachFlowBubble } from '../../store/messages';
import { PlanEditMessageKind, type PlanEditCardPayload } from '../flow';
import PlanEditCard, { itemLine, PlanEditNotice, variantLabel } from '../PlanEditCard';
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
}));

const flow = jest.requireMock('../flow') as {
  applyCard: jest.Mock;
  cancelCard: jest.Mock;
  undoCard: jest.Mock;
  selectVariant: jest.Mock;
  grantConsentFor: jest.Mock;
};

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
      ...payload,
    } satisfies PlanEditCardPayload,
  };
}

beforeEach(() => {
  setCurrentLanguage('en');
  for (const mock of [flow.applyCard, flow.cancelCard, flow.undoCard, flow.selectVariant, flow.grantConsentFor]) mock.mockClear();
  useRunnerProgress.setState({ summary: null, profileId: null });
});

describe('the card', () => {
  it('draws the change in the server\'s words, with the app\'s own chrome around it', async () => {
    await render(<PlanEditCard message={message()} busy={false} />);
    expect(screen.getByText(en('coach.planEdit.cardTitle'))).toBeOnTheScreen();
    expect(screen.getByText('Push-ups instead of barbell bench press on Push days.')).toBeOnTheScreen();
    expect(screen.getByText('Push, every time from Sat 24 Oct')).toBeOnTheScreen();
    expect(screen.getByText('Barbell bench press → Push-up')).toBeOnTheScreen();
    expect(screen.getByText('Zottman curls')).toBeOnTheScreen();
    expect(screen.getByText(en('coach.planEdit.ownTag'))).toBeOnTheScreen();
    expect(screen.getByText(en('coach.planEdit.wontUse', { labels: 'Barbell' }))).toBeOnTheScreen();
  });

  it('says what could not be done on lines of its own, and a cycle\'s note', async () => {
    const variant = decodePreview(
      previewJson({
        becomesCustom: true,
        becomesCustomNote: 'Your plan will repeat every 4 days.',
        notApplied: [{ reason: 'over_limit', text: '50 sets was capped at 6.' }],
        notAppliedNote: "Some of it couldn't be done:",
      }),
      'v',
    );
    await render(<PlanEditCard message={message({}, [variant])} busy={false} />);
    expect(screen.getByText('Your plan will repeat every 4 days.')).toBeOnTheScreen();
    expect(screen.getByText("Some of it couldn't be done:")).toBeOnTheScreen();
    expect(screen.getByText('50 sets was capped at 6.')).toBeOnTheScreen();
  });

  it('Apply and Cancel call the flow with the card', async () => {
    await render(<PlanEditCard message={message()} busy={false} />);
    await fireEvent.press(screen.getByTestId('coach.planEdit.apply'));
    expect(flow.applyCard).toHaveBeenCalledWith('m1');
    await fireEvent.press(screen.getByTestId('coach.planEdit.cancel'));
    expect(flow.cancelCard).toHaveBeenCalledWith('m1');
  });

  it('with two variants, a switch with each one\'s label', async () => {
    const variants = [
      decodePreview(previewJson({ editId: EDIT_A, label: 'Our exercise: Dumbbell bench press' }), 'a'),
      decodePreview(previewJson({ editId: EDIT_B, label: null }), 'b'),
    ];
    await render(<PlanEditCard message={message({}, variants)} busy={false} />);
    expect(screen.getByText('Our exercise: Dumbbell bench press')).toBeOnTheScreen();
    expect(screen.getByText(en('coach.planEdit.variantOwn'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('coach.planEdit.variant.1'));
    expect(flow.selectVariant).toHaveBeenCalledWith('m1', 1);
  });

  it('Apply waits while today\'s workout is open in the runner, and says why', async () => {
    useRunnerProgress.setState({
      summary: { sessionId: TODAY_SESSION, exercise: 2, total: 5, title: 'Push', scheduledFor: '2026-10-23' },
      profileId: 'p',
    });
    const variant = decodePreview(previewJson({ touchesToday: true, todaySessionId: TODAY_SESSION }), 'v');
    await render(<PlanEditCard message={message({}, [variant])} busy={false} />);
    expect(screen.getByText(en('coach.planEdit.runnerOpen'))).toBeOnTheScreen();
    expect(screen.getByTestId('coach.planEdit.apply')).toBeDisabled();
  });

  it('applied: "Changed · Undo" while the server says it can be undone', async () => {
    await render(
      <PlanEditCard
        message={message({ status: 'applied', applied: { editId: EDIT_A, undoUntil: new Date('2099-01-01'), undoable: true } })}
        busy={false}
      />,
    );
    expect(screen.getByText(en('coach.planEdit.changed'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('coach.planEdit.undo'));
    expect(flow.undoCard).toHaveBeenCalledWith('m1');
    expect(screen.queryByTestId('coach.planEdit.apply')).toBeNull();
  });

  it('applied past its window: "Changed" alone', async () => {
    await render(
      <PlanEditCard
        message={message({ status: 'applied', applied: { editId: EDIT_A, undoUntil: new Date('2020-01-01'), undoable: true } })}
        busy={false}
      />,
    );
    expect(screen.getByText(en('coach.planEdit.changed'))).toBeOnTheScreen();
    expect(screen.queryByTestId('coach.planEdit.undo')).toBeNull();
  });

  it.each([
    ['cancelled', 'coach.planEdit.cancelled'],
    ['undone', 'coach.planEdit.undone'],
    ['superseded', 'coach.planEdit.superseded'],
  ] as const)('%s says so, with no buttons', async (status, key) => {
    await render(<PlanEditCard message={message({ status })} busy={false} />);
    expect(screen.getByText(en(key))).toBeOnTheScreen();
    expect(screen.queryByTestId('coach.planEdit.apply')).toBeNull();
  });
});

describe('the lines', () => {
  const t = (key: string, params?: Params) => en(key, params);

  it('a rest day, a title, the cycle and the days are one line: what they become', () => {
    expect(itemLine({ type: 'rest', before: 'Push', after: 'Rest day', own: false }, t)).toBe('Rest day');
    expect(itemLine({ type: 'cycle', before: null, after: 'Repeats every 4 days', own: false }, t)).toBe('Repeats every 4 days');
    expect(itemLine({ type: 'dose', before: '3 × 10', after: '4 × 10', own: false }, t)).toBe('3 × 10 → 4 × 10');
    expect(itemLine({ type: 'remove', before: 'Plank', after: null, own: false }, t)).toBe('Plank');
  });

  it('a variant without a label is ours, then the member\'s own', () => {
    const variant = decodePreview(previewJson({ label: null }), 'v');
    expect(variantLabel(variant, 0, t)).toBe(en('coach.planEdit.variantOurs'));
    expect(variantLabel(variant, 1, t)).toBe(en('coach.planEdit.variantOwn'));
  });
});

describe('the notice and the consent', () => {
  it('the notice lists the server\'s lines', async () => {
    const notice: CoachFlowBubble = {
      id: 'n1',
      role: 'assistant',
      text: '',
      flow: 'planEdit',
      kind: PlanEditMessageKind.notice,
      payload: { note: null, lines: ['A class day has no exercises to swap.'] },
    };
    await render(<PlanEditNotice message={notice} busy={false} />);
    expect(screen.getByText('A class day has no exercises to swap.')).toBeOnTheScreen();
  });

  it('the consent names the plan change (v4) and grants on one tap', async () => {
    const consent: CoachFlowBubble = {
      id: 'c1',
      role: 'assistant',
      text: '',
      flow: 'planEdit',
      kind: PlanEditMessageKind.consent,
      payload: { requestId: 'r1', status: 'idle', errorKey: null },
    };
    await render(<PlanEditConsentBubble message={consent} busy={false} />);
    expect(screen.getByText(en('healthconsent.ai.plan_edit'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('coach.planEdit.consent'));
    expect(flow.grantConsentFor).toHaveBeenCalledWith('c1');
  });
});
