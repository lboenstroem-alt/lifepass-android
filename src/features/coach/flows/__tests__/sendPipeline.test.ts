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
  return {
    program: make('program'),
    adjust: make('adjust'),
    planEdit: make('planEdit'),
    venueWizard: make('venueWizard'),
    dayPlan: make('dayPlan'),
  };
}

describe('the send pipeline', () => {
  it('is iOS order: the plan change, then the programme offer, before the venue and day-plan open questions', () => {
    expect(SEND_PIPELINE).toEqual([
      'program.open',
      'adjust.open',
      'planEdit.open',
      'planEdit.start',
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

  it('an active programme with no question open still takes the words, and they go no further (ruling 2)', async () => {
    const log: string[] = [];
    // The summary is up (no question bubble open): the flow says it takes nothing.
    const takeTyped = jest.fn(() => false);
    const later = jest.fn(() => true);
    const set = flows(
      {
        program: { isActive: () => true, hasOpenQuestion: () => false, takeTyped },
        venueWizard: { hasOpenQuestion: () => true, takeTyped: later, startFrom: later },
        dayPlan: { hasOpenQuestion: () => true, takeTyped: later, startFrom: later },
      },
      log,
    );
    expect(await runSendPipeline(set, 'my knee hurts', TYPED, { abandonOpenQuestions: jest.fn() })).toBe('program.open');
    expect(takeTyped).toHaveBeenCalledWith('my knee hurts');
    expect(later).not.toHaveBeenCalled();
  });

  it('Adjust my plan in progress swallows the words the same way', async () => {
    const programStart = jest.fn(() => true);
    const set = flows(
      { adjust: { isActive: () => true, takeTyped: () => false }, program: { startFrom: programStart } },
      [],
    );
    expect(await runSendPipeline(set, 'a 4 week plan', TYPED, { abandonOpenQuestions: jest.fn() })).toBe('adjust.open');
    expect(programStart).not.toHaveBeenCalled();
  });

  it('an open question alone does not hold the programme step: the flow must be in progress', async () => {
    const takeTyped = jest.fn(() => true);
    const set = flows({ program: { isActive: () => false, hasOpenQuestion: () => true, takeTyped } }, []);
    expect(await runSendPipeline(set, 'hello', TYPED, { abandonOpenQuestions: jest.fn() })).toBeNull();
    expect(takeTyped).not.toHaveBeenCalled();
  });

  it('nothing taken leaves the words for the model', async () => {
    const set = {
      program: inactiveFlow('program'),
      adjust: inactiveFlow('adjust'),
      planEdit: inactiveFlow('planEdit'),
      venueWizard: inactiveFlow('venueWizard'),
      dayPlan: inactiveFlow('dayPlan'),
    };
    expect(await runSendPipeline(set, 'how are you', TYPED, { abandonOpenQuestions: jest.fn() })).toBeNull();
  });

  describe('the plan change (COACH-6)', () => {
    it('an open suggestion takes the words before the programme offer', async () => {
      const programStart = jest.fn(() => true);
      const set = flows({ planEdit: { hasOpenQuestion: () => true, takeTyped: () => true }, program: { startFrom: programStart } }, []);
      expect(await runSendPipeline(set, 'no, make it 4 sets', TYPED, { abandonOpenQuestions: jest.fn() })).toBe('planEdit.open');
      expect(programStart).not.toHaveBeenCalled();
    });

    it('words the server says are no plan change go on from the programme offer, never to the plan change twice', async () => {
      const log: string[] = [];
      const start = jest.fn(() => {
        log.push('planEdit.start');
        return true;
      });
      const set = flows(
        {
          planEdit: { hasOpenQuestion: () => true, takeTyped: () => 'passed' as const, startFrom: start },
          program: {
            startFrom: () => {
              log.push('program.start');
              return false;
            },
          },
          venueWizard: {
            startFrom: () => {
              log.push('venueWizard.start');
              return false;
            },
          },
        },
        log,
      );
      expect(await runSendPipeline(set, 'which pools are open now?', TYPED, { abandonOpenQuestions: jest.fn() })).toBeNull();
      expect(start).not.toHaveBeenCalled();
      expect(log).toEqual(['program.start', 'venueWizard.start']);
    });

    it('a plan-change start that passes lets the programme offer and the wizards look', async () => {
      const programStart = jest.fn(() => true);
      const set = flows({ planEdit: { startFrom: () => 'passed' as const }, program: { startFrom: programStart } }, []);
      expect(await runSendPipeline(set, 'a 4 week plan', TYPED, { abandonOpenQuestions: jest.fn() })).toBe('program.start');
    });

    it('a parked prompt never reaches the plan change by its words', async () => {
      const start = jest.fn(() => true);
      const set = flows({ planEdit: { startFrom: start } }, []);
      expect(await runSendPipeline(set, 'swap my exercise', PARKED, { abandonOpenQuestions: jest.fn() })).toBeNull();
      expect(start).not.toHaveBeenCalled();
    });

    it('Adjust my plan hands typed words on when the server changes plans by chat: it closes, and the plan change takes them', async () => {
      const abandon = jest.fn();
      const adjustTyped = jest.fn(() => true);
      const start = jest.fn((_text: string, _options: CoachSendOptions, context: { handedOnFrom?: string | null }) => context.handedOnFrom === 'adjust.open');
      const set = flows({ adjust: { isActive: () => true, handsTypedOn: () => true, takeTyped: adjustTyped }, planEdit: { startFrom: start } }, []);
      expect(await runSendPipeline(set, 'make Thursday lighter', TYPED, { abandonOpenQuestions: abandon })).toBe('planEdit.start');
      expect(abandon).toHaveBeenCalledTimes(1);
      expect(adjustTyped).not.toHaveBeenCalled();
    });

    it('without the feature Adjust my plan swallows the words as before', async () => {
      const start = jest.fn(() => true);
      const set = flows({ adjust: { isActive: () => true, handsTypedOn: () => false, takeTyped: () => true }, planEdit: { startFrom: start } }, []);
      expect(await runSendPipeline(set, 'make Thursday lighter', TYPED, { abandonOpenQuestions: jest.fn() })).toBe('adjust.open');
      expect(start).not.toHaveBeenCalled();
    });

    it('runs from a later step when asked (a chip\'s words that are no plan change)', async () => {
      const planOpen = jest.fn(() => true);
      const programStart = jest.fn(() => true);
      const set = flows({ planEdit: { hasOpenQuestion: () => true, takeTyped: planOpen }, program: { startFrom: programStart } }, []);
      expect(await runSendPipeline(set, 'a 4 week plan', TYPED, { abandonOpenQuestions: jest.fn() }, 'program.start')).toBe('program.start');
      expect(planOpen).not.toHaveBeenCalled();
    });
  });
});
