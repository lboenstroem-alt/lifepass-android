/**
 * The proposal card's rules (iOS ProgramProposalCard): the collapsed lines,
 * which question Start asks, how a refusal reads, and the reminder times.
 */
import { ProblemError, TransportError } from '../../../../api';
import { decodeProgramSummary } from '../../../../health';
import {
  adoptFailure,
  discardFailure,
  failureErrorKey,
  kickerKey,
  notificationsDeniedAfterAdopt,
  offersOpenPlan,
  outcomeCopyKey,
  overviewStartDecision,
  PROPOSAL_OUTCOMES,
  REMINDER_CHOICES,
  reminderTimeLabel,
  startDecision,
  startKey,
} from '../proposalRules';

const problem = (slug: string, extra: Record<string, unknown> = {}, status = 409) =>
  new ProblemError({ type: `https://lifepass.is/problems/${slug}`, title: slug, status, ...extra }, status);

const plain = decodeProgramSummary({ id: 'p-1' }, 'program');
const revision = decodeProgramSummary({ id: 'p-2', revisionOf: 'p-1' }, 'program');

describe('outcomes', () => {
  it('each outcome has its own collapsed line', () => {
    expect(PROPOSAL_OUTCOMES.map(outcomeCopyKey)).toEqual([
      'program.proposal.started',
      'program.proposal.saved',
      'program.proposal.discarded',
      'program.proposal.changed',
    ]);
  });

  it('started, saved and changed offer Open Plan; discarded does not', () => {
    expect(PROPOSAL_OUTCOMES.filter(offersOpenPlan)).toEqual(['started', 'saved', 'changed']);
  });
});

describe('Start', () => {
  it('a revision always asks the switch question, even when no live plan is known', () => {
    expect(startDecision(revision, false)).toBe('switch');
    expect(startDecision(revision, true)).toBe('switch');
    expect(overviewStartDecision(revision)).toBe('switch');
  });

  it('a live plan asks the replace question; otherwise Start adopts at once', () => {
    expect(startDecision(plain, true)).toBe('replace');
    expect(startDecision(plain, false)).toBe('adopt');
  });

  it('the weeks screen adopts at once and lets the server say a plan is running', () => {
    expect(overviewStartDecision(plain)).toBe('adopt');
  });

  it('a revision is switched to, and says so', () => {
    expect(kickerKey(revision)).toBe('program.revision.kicker');
    expect(startKey(revision)).toBe('program.revision.start');
    expect(kickerKey(plain)).toBe('program.proposal.kicker');
    expect(startKey(plain)).toBe('program.proposal.start');
  });
});

describe('refusals', () => {
  it('a running plan is the replace question', () => {
    expect(adoptFailure(problem('program_already_active'))).toBe('alreadyActive');
    expect(failureErrorKey('alreadyActive')).toBeNull();
  });

  it('a stale revision keeps the card with its line', () => {
    expect(adoptFailure(problem('program_action_not_allowed', { reason: 'revision_stale' }))).toBe('stale');
    expect(failureErrorKey('stale')).toBe('program.revision.stale');
  });

  it('any other refusal of the action, or a plan gone, is "changed"', () => {
    expect(adoptFailure(problem('program_action_not_allowed', { reason: 'already_adopted' }))).toBe('changed');
    expect(adoptFailure(problem('health-program-not-found', {}, 404))).toBe('changed');
    expect(discardFailure(problem('program_action_not_allowed', { reason: 'not_proposed' }))).toBe('changed');
    expect(failureErrorKey('changed')).toBeNull();
  });

  it('offline and anything else keep the card with a line', () => {
    expect(adoptFailure(new TransportError('timeout'))).toBe('offline');
    expect(discardFailure(new TransportError('offline'))).toBe('offline');
    expect(failureErrorKey('offline')).toBe('health.offline.action_hint');
    expect(adoptFailure(problem('internal_error', {}, 500))).toBe('other');
    expect(adoptFailure(new Error('boom'))).toBe('other');
    expect(failureErrorKey('other')).toBe('common.error_body');
  });
});

describe('reminders', () => {
  it('the times run 06:00 to 10:00 in half hours', () => {
    expect(REMINDER_CHOICES.map(reminderTimeLabel)).toEqual([
      '06:00',
      '06:30',
      '07:00',
      '07:30',
      '08:00',
      '08:30',
      '09:00',
      '09:30',
      '10:00',
    ]);
  });

  it('only a toggle left on under a phone that refused is "denied"', () => {
    expect(notificationsDeniedAfterAdopt(true, false)).toBe(true);
    expect(notificationsDeniedAfterAdopt(true, true)).toBe(false);
    expect(notificationsDeniedAfterAdopt(false, false)).toBe(false);
  });
});
