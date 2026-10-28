/**
 * The change-days sheet's rules (iOS ChangeDaysSheet.swift): the chip rows,
 * a tap, the exact-count rule for Save, and what a refused save means.
 */
import { ProblemError, TransportError } from '../../../../api';
import { DAY_ROWS, daysSaveErrorKey, daysSaveFailure, initialSelection, isValidSelection, toggleDay } from '../daysRules';

function problem(slug: string, status = 409): ProblemError {
  return new ProblemError({ type: `https://lifepass.is/problems/${slug}`, title: slug, status }, status);
}

describe('the chips', () => {
  it('are Monday to Thursday, then Friday to Sunday', () => {
    expect(DAY_ROWS).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7],
    ]);
  });

  it('a tap turns a day on, a second tap off, and the result is in weekday order', () => {
    expect(toggleDay([5, 1], 3)).toEqual([1, 3, 5]);
    expect(toggleDay([1, 3, 5], 3)).toEqual([1, 5]);
    expect(toggleDay([], 7)).toEqual([7]);
  });

  it('opens with what the caller had, in range and in order, without repeats', () => {
    expect(initialSelection([5, 1, 3, 3, 0, 8])).toEqual([1, 3, 5]);
  });
});

describe('Save', () => {
  it('is allowed only with exactly the plan’s number of days', () => {
    expect(isValidSelection([1, 3], 3)).toBe(false);
    expect(isValidSelection([1, 3, 5], 3)).toBe(true);
    expect(isValidSelection([1, 3, 5, 6], 3)).toBe(false);
    expect(isValidSelection([], 0)).toBe(true);
  });
});

describe('a refused save', () => {
  it('a plan ended or deleted elsewhere closes the sheet with no line', () => {
    expect(daysSaveFailure(problem('program_action_not_allowed'))).toBe('changed');
    expect(daysSaveFailure(problem('health-program-not-found', 404))).toBe('changed');
    expect(daysSaveErrorKey('changed')).toBeNull();
  });

  it('no network keeps the sheet with "This needs a connection."', () => {
    expect(daysSaveFailure(new TransportError('offline'))).toBe('offline');
    expect(daysSaveErrorKey('offline')).toBe('health.offline.action_hint');
  });

  it('anything else keeps the sheet with the generic line', () => {
    expect(daysSaveFailure(problem('internal_error', 500))).toBe('other');
    expect(daysSaveFailure(new Error('boom'))).toBe('other');
    expect(daysSaveErrorKey('other')).toBe('common.error_body');
  });
});
