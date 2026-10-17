/**
 * Presenting the body and target sheets from anywhere: one at a time, a
 * request that cannot be shown answered at once as a close, and every
 * callback run once the sheet has gone, never twice and never lost.
 */
import {
  attachBodySheetsHost,
  bodySheetClosed,
  cancelAnswer,
  dismissBodySheet,
  presentBodySheet,
  presentTargetSheet,
  resetBodySheetPresenterForTests,
  useBodySheetPresenter,
} from '../presenter';
import type { BodyIntakeResult } from '../types';

let detach: (() => void) | null = null;

beforeEach(() => {
  resetBodySheetPresenterForTests();
  detach = attachBodySheetsHost();
});

afterEach(() => {
  detach?.();
  detach = null;
});

const intake = (results: BodyIntakeResult[]) =>
  ({
    kind: 'intake',
    prefill: { kennitalaVerified: true },
    onResult: (result: BodyIntakeResult) => results.push(result),
  }) as const;

it('shows a request, and runs what the sheet owes only once it has gone', () => {
  const saved = jest.fn();
  presentBodySheet({ kind: 'goal', onSaved: saved });
  const { request, visible } = useBodySheetPresenter.getState();
  expect(visible).toBe(true);
  expect(request?.sheet).toBe('body');

  dismissBodySheet(saved);
  expect(useBodySheetPresenter.getState().visible).toBe(false);
  // Still sliding away: the request stays so its content does not vanish.
  expect(useBodySheetPresenter.getState().request).not.toBeNull();
  expect(saved).not.toHaveBeenCalled();

  bodySheetClosed(request!.id);
  expect(saved).toHaveBeenCalledTimes(1);
  expect(useBodySheetPresenter.getState().request).toBeNull();
  // A late second report changes nothing.
  bodySheetClosed(request!.id);
  expect(saved).toHaveBeenCalledTimes(1);
});

it('one sheet at a time: a request while one is up is answered as a close at once', () => {
  const first: BodyIntakeResult[] = [];
  const second: BodyIntakeResult[] = [];
  presentBodySheet(intake(first));
  presentBodySheet(intake(second));
  expect(second).toEqual([{ kind: 'cancelled' }]);
  expect(first).toEqual([]);

  const cancelled = jest.fn();
  presentTargetSheet({ kind: 'pick', goal: 'lose_weight', onPicked: jest.fn(), onCancel: cancelled });
  expect(cancelled).toHaveBeenCalledTimes(1);
});

it('only the first close of a presentation counts', () => {
  const results: BodyIntakeResult[] = [];
  presentBodySheet(intake(results));
  const id = useBodySheetPresenter.getState().request!.id;
  dismissBodySheet(() => results.push({ kind: 'skipped' }));
  dismissBodySheet(() => results.push({ kind: 'cancelled' }));
  bodySheetClosed(id);
  expect(results).toEqual([{ kind: 'skipped' }]);
});

it('a new request while the last sheet slides away runs what the last one owed first', () => {
  const order: string[] = [];
  presentBodySheet({ kind: 'goal', onSaved: () => order.push('goal saved') });
  const firstId = useBodySheetPresenter.getState().request!.id;
  dismissBodySheet(() => order.push('goal saved'));
  presentTargetSheet({ kind: 'save', onSaved: () => order.push('target saved') });
  expect(order).toEqual(['goal saved']);
  const { request, visible } = useBodySheetPresenter.getState();
  expect(visible).toBe(true);
  expect(request?.sheet).toBe('target');
  // The old sheet's late report belongs to a presentation that is over.
  bodySheetClosed(firstId);
  expect(useBodySheetPresenter.getState().request?.sheet).toBe('target');
  expect(order).toEqual(['goal saved']);
});

it('with no host, nothing is shown and the request is answered as a close', () => {
  detach?.();
  detach = null;
  const results: BodyIntakeResult[] = [];
  presentBodySheet(intake(results));
  expect(results).toEqual([{ kind: 'cancelled' }]);
  expect(useBodySheetPresenter.getState().request).toBeNull();
});

it('a host that goes (sign-out) answers the sheet it was showing', () => {
  const results: BodyIntakeResult[] = [];
  presentBodySheet(intake(results));
  detach?.();
  detach = null;
  expect(results).toEqual([{ kind: 'cancelled' }]);
  expect(useBodySheetPresenter.getState()).toEqual({ request: null, visible: false });
});

it("a close's answer: an intake's cancelled, a target sheet's onCancel, nothing for a save", () => {
  const results: BodyIntakeResult[] = [];
  cancelAnswer({ sheet: 'body', mode: intake(results) })?.();
  expect(results).toEqual([{ kind: 'cancelled' }]);
  expect(cancelAnswer({ sheet: 'body', mode: { kind: 'goal' } })).toBeNull();
  const onCancel = jest.fn();
  cancelAnswer({ sheet: 'target', mode: { kind: 'save', onCancel } })?.();
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it("a caller's failing callback never leaves the presenter stuck", () => {
  presentBodySheet({ kind: 'goal' });
  const id = useBodySheetPresenter.getState().request!.id;
  dismissBodySheet(() => {
    throw new Error('caller bug');
  });
  expect(() => bodySheetClosed(id)).not.toThrow();
  presentBodySheet({ kind: 'goal' });
  expect(useBodySheetPresenter.getState().visible).toBe(true);
});
