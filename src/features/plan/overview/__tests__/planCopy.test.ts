/**
 * The programme lines every Plan surface prints the same way (iOS
 * `PlanCopy`, PlanOverviewCard, ProgramProposalCard), and the update bodies
 * that must never mix a status with days.
 */
import { decodeProgramSummary } from '../../../../health';
import { translate, type Lang, type Params } from '../../../../i18n';
import {
  dateRange,
  dayRowLabel,
  feelingWord,
  isRestRow,
  proposalMetaLine,
  proposalRowLabel,
  targetsLine,
  targetsText,
  weekdayList,
} from '../planCopy';
import { ProgramUpdate, programUpdateKind } from '../programUpdate';

const tr = (lang: Lang) => (key: string, params?: Params) => translate(key, lang, params);
const en = tr('en');
const is = tr('is');

const program = (json: Record<string, unknown>) => decodeProgramSummary({ id: 'p-1', ...json }, 'program');

describe('dates and days', () => {
  it('reads the dates in full, or nothing while a proposal has none', () => {
    expect(dateRange(program({ startsOn: '2026-09-17', endsOn: '2026-10-14' }), en, 'en')).toBe('17 September to 14 October');
    expect(dateRange(program({ startsOn: '2026-09-17', endsOn: '2026-10-14' }), is, 'is')).toBe('17. september til 14. október');
    expect(dateRange(program({ startsOn: null, endsOn: null }), en, 'en')).toBeNull();
  });

  it('lists the training days in weekday order, whatever order they came in', () => {
    expect(weekdayList([5, 1, 3], 'en')).toBe('Mon, Wed, Fri');
    expect(weekdayList(null, 'en')).toBe('');
  });

  it('the proposal meta line falls back to 40 minutes', () => {
    expect(proposalMetaLine(program({ trainingDays: [2, 4], typicalMinutes: 35 }), en, 'en')).toBe('Tue, Thu · about 35 min');
    expect(proposalMetaLine(program({ trainingDays: [2, 4] }), en, 'en')).toBe('Tue, Thu · about 40 min');
  });
});

describe('the targets line (3.9.1 item 3, in order)', () => {
  it('a withheld target outranks everything', () => {
    const line = targetsLine(program({ targetsWithheld: 'bmi_high', planType: 'gentle', targets: { kcalLow: 1800, kcalHigh: 2100, proteinG: 120 } }));
    expect(line).toEqual({ kind: 'withheld' });
    expect(targetsText(line, en, 'en')).toBe(en('plan.targets.withheld'));
  });

  it('a withheld reason this build does not know is not a withheld target', () => {
    expect(targetsLine(program({ targetsWithheld: 'something_new', targets: { kcalLow: 1800, kcalHigh: 2100, proteinG: 120 } })).kind).toBe('targets');
  });

  it('then a gentle plan', () => {
    expect(targetsLine(program({ planType: 'gentle', targets: { kcalLow: 1800, kcalHigh: 2100, proteinG: 120 } }))).toEqual({ kind: 'gentle' });
  });

  it('then a real target, grouped in the language, protein without decimals', () => {
    const line = targetsLine(program({ targets: { kcalLow: 1800, kcalHigh: 2100, proteinG: 120.4 } }));
    expect(targetsText(line, en, 'en')).toBe('About 1,800 to 2,100 kcal a day, 120 g protein');
    expect(targetsText(line, is, 'is')).toBe('Um 1.800 til 2.100 kcal á dag, 120 g prótein');
  });

  it('else the invitation to add weight and height (a partial target counts as none)', () => {
    expect(targetsLine(program({ targets: { kcalLow: 1800, kcalHigh: null, proteinG: 120 } }))).toEqual({ kind: 'none' });
    expect(targetsText({ kind: 'none' }, en, 'en')).toBe(en('plan.overview.no_targets'));
  });
});

describe('row labels', () => {
  const brief = (json: Record<string, unknown>) => ({ weekday: null, title: null, minutes: null, status: null, kind: null, ...json });

  it('a week row says weekday, title, length and the status as a word', () => {
    expect(dayRowLabel(brief({ weekday: 3, title: 'Full body', minutes: 40, status: 'done' }), 0, en, 'en')).toBe('Wed, Full body, 40 min, done');
  });

  it('a rest row is "Rest day", takes its place in the week as its weekday, and has no length', () => {
    expect(dayRowLabel(brief({}), 1, en, 'en')).toBe('Tue, Rest day');
    expect(isRestRow(brief({}))).toBe(true);
    expect(isRestRow(brief({ kind: 'rest' }))).toBe(true);
    expect(isRestRow(brief({ kind: 'strength' }))).toBe(false);
  });

  it('a proposal row has no status', () => {
    expect(proposalRowLabel(brief({ weekday: 1, title: 'Legs', minutes: 45, status: 'planned' }), 0, en, 'en')).toBe('Mon, Legs, 45 min');
    expect(proposalRowLabel(brief({ weekday: 2 }), 0, en, 'en')).toBe('Tue, Rest day');
  });

  it('a feeling is a word, or nothing', () => {
    expect(feelingWord('too_hard', en)).toBe('Too hard');
    expect(feelingWord('unknown', en)).toBeNull();
    expect(feelingWord(null, en)).toBeNull();
  });
});

describe('the update body never mixes a status with days', () => {
  it('a status change is the status alone', () => {
    expect(ProgramUpdate.status('paused')).toEqual({ status: 'paused' });
    expect(programUpdateKind(ProgramUpdate.status('abandoned'))).toBe('status');
  });

  it('new days are the days alone, sorted, without repeats', () => {
    expect(ProgramUpdate.trainingDays([5, 1, 3, 3])).toEqual({ trainingDays: [1, 3, 5] });
    expect(programUpdateKind(ProgramUpdate.trainingDays([1, 3]))).toBe('details');
  });

  it('a mixed or empty body is recognised for what the server refuses', () => {
    expect(programUpdateKind({ status: 'paused', trainingDays: [1, 2] })).toBe('mixed');
    expect(programUpdateKind({})).toBe('empty');
  });
});
