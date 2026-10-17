/**
 * The Coach's send pipeline order (iOS CoachViewModel.send): open questions
 * and starts interleave, so a typed request for weeks offers the programme
 * even while the venue or day-plan wizard has a question open.
 */
import {
  inactiveFlow,
  runSendPipeline,
  SEND_PIPELINE,
  type CoachFlow,
  type CoachFlowId,
  type CoachSendOptions,
} from '../types';

const TYPED: CoachSendOptions = { detectPlanRequest: true, detectScheduleQuestion: true };
const PARKED: CoachSendOptions = { detectPlanRequest: false, detectScheduleQuestion: false };

/** Four flows that record what the pipeline asked of them. */
function flows(overrides: Partial<Record<CoachFlowId, Partial<CoachFlow>>>, log: string[]) {
  const make = (id: CoachFlowId): CoachFlow => ({
    ...inactiveFlow(id),
    takeTyped: () => {
      log.push(`${id}.open`);
      return true;
    },
    ...overrides[id],
  });
  return { program: make('program'), adjust: make('adjust'), venueWizard: make('venueWizard'), dayPlan: make('dayPlan') };
}

describe('the send pipeline', () => {
  it('is iOS order: the programme offer comes before the venue and day-plan open questions', () => {
    expect(SEND_PIPELINE).toEqual([
      'program.open',
      'adjust.open',
      'program.start',
      'venueWizard.open',
      'dayPlan.open',
      'dayPlan.start',
      'venueWizard.start',
    ]);
  });

  it('a request for weeks while the venue wizard asks something offers the programme, abandoning the question first', async () => {
    const log: string[] = [];
    const set = flows(
      {
        venueWizard: { hasOpenQuestion: () => true },
        program: {
          startFrom: (_text, _options, context) => {
            context.abandonOpenQuestions();
            log.push('program offered');
            return true;
          },
        },
      },
      log,
    );
    const took = await runSendPipeline(set, 'a 4 week plan', TYPED, { abandonOpenQuestions: () => log.push('abandoned') });
    expect(took).toBe('program.start');
    expect(log).toEqual(['abandoned', 'program offered']);
  });

  it('a parked prompt never starts a wizard by a plan request: the open venue question takes it', async () => {
    const log: string[] = [];
    const programStart = jest.fn(() => true);
    const set = flows({ venueWizard: { hasOpenQuestion: () => true }, program: { startFrom: programStart } }, log);
    expect(await runSendPipeline(set, 'a 4 week plan', PARKED, { abandonOpenQuestions: jest.fn() })).toBe(
      'venueWizard.open',
    );
    expect(programStart).not.toHaveBeenCalled();
  });

  it('nothing taken leaves the words for the model', async () => {
    const set = { program: inactiveFlow('program'), adjust: inactiveFlow('adjust'), venueWizard: inactiveFlow('venueWizard'), dayPlan: inactiveFlow('dayPlan') };
    expect(await runSendPipeline(set, 'how are you', TYPED, { abandonOpenQuestions: jest.fn() })).toBeNull();
  });
});
