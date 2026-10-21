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

  dismissBodySheet(request!.id, saved);
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
  dismissBodySheet(id, () => results.push({ kind: 'skipped' }));
  dismissBodySheet(id, () => results.push({ kind: 'cancelled' }));
  bodySheetClosed(id);
  expect(results).toEqual([{ kind: 'skipped' }]);
});

it('a new request while the last sheet slides away runs what the last one owed first', () => {
  const order: string[] = [];
  presentBodySheet({ kind: 'goal', onSaved: () => order.push('goal saved') });
  const firstId = useBodySheetPresenter.getState().request!.id;
  dismissBodySheet(firstId, () => order.push('goal saved'));
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
  dismissBodySheet(id, () => {
    throw new Error('caller bug');
  });
  expect(() => bodySheetClosed(id)).not.toThrow();
  presentBodySheet({ kind: 'goal' });
  expect(useBodySheetPresenter.getState().visible).toBe(true);
});

/** Closes the sheet on record the way the host does: the close, then the slide-out's end. */
function closeOnRecord(after: (() => void) | null): void {
  const id = useBodySheetPresenter.getState().request!.id;
  dismissBodySheet(id, after);
  bodySheetClosed(id);
}

describe('a callback that opens the next sheet', () => {
  it("is shown: the goal's onSaved opens the target sheet, and later opens still work", () => {
    const picked = jest.fn();
    presentBodySheet({ kind: 'goal' });
    closeOnRecord(() => presentTargetSheet({ kind: 'pick', goal: 'lose_weight', onPicked: picked }));

    const { request, visible } = useBodySheetPresenter.getState();
    expect(visible).toBe(true);
    expect(request?.sheet).toBe('target');

    closeOnRecord(() => picked(72));
    expect(picked).toHaveBeenCalledWith(72);
    expect(useBodySheetPresenter.getState()).toEqual({ request: null, visible: false });

    const results: BodyIntakeResult[] = [];
    presentBodySheet(intake(results));
    expect(useBodySheetPresenter.getState().visible).toBe(true);
    expect(results).toEqual([]);
  });

  it("an intake's answer opens the next question (the Coach wizard)", () => {
    const cancelled = jest.fn();
    const answers: BodyIntakeResult[] = [];
    const mode = {
      kind: 'intake',
      prefill: { kennitalaVerified: true },
      onResult: (result: BodyIntakeResult) => {
        answers.push(result);
        presentTargetSheet({ kind: 'pick', goal: 'gain_weight', onPicked: jest.fn(), onCancel: cancelled });
      },
    } as const;
    presentBodySheet(mode);
    closeOnRecord(() => mode.onResult({ kind: 'skipped' }));
    expect(answers).toEqual([{ kind: 'skipped' }]);
    expect(useBodySheetPresenter.getState().request?.sheet).toBe('target');
    expect(useBodySheetPresenter.getState().visible).toBe(true);
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('mid-slide: what the last sheet owed runs first and its sheet is shown; the new request is answered once as a close', () => {
    const order: string[] = [];
    const nestedCancel = jest.fn();
    presentBodySheet({ kind: 'goal' });
    const firstId = useBodySheetPresenter.getState().request!.id;
    dismissBodySheet(firstId, () => {
      order.push('goal saved');
      presentTargetSheet({ kind: 'save', onCancel: nestedCancel });
    });

    const late: BodyIntakeResult[] = [];
    presentBodySheet(intake(late));
    expect(order).toEqual(['goal saved']);
    expect(late).toEqual([{ kind: 'cancelled' }]);
    const { request, visible } = useBodySheetPresenter.getState();
    expect(visible).toBe(true);
    expect(request?.sheet).toBe('target');
    expect(nestedCancel).not.toHaveBeenCalled();

    // The first sheet's late report changes nothing.
    bodySheetClosed(firstId);
    expect(useBodySheetPresenter.getState().request?.sheet).toBe('target');

    closeOnRecord(nestedCancel);
    expect(nestedCancel).toHaveBeenCalledTimes(1);
    expect(late).toEqual([{ kind: 'cancelled' }]);
    const again: BodyIntakeResult[] = [];
    presentBodySheet(intake(again));
    expect(useBodySheetPresenter.getState().visible).toBe(true);
    expect(again).toEqual([]);
  });
});

describe('closed by the member (pan down, the backdrop)', () => {
  // The kit's Sheet reports that it has gone first, then that the member
  // closed it; no second report follows.
  function swipeAway(after: (() => void) | null): void {
    const id = useBodySheetPresenter.getState().request!.id;
    bodySheetClosed(id);
    dismissBodySheet(id, after);
  }

  it("answers the caller at once, exactly once, and the next open works", () => {
    const results: BodyIntakeResult[] = [];
    presentBodySheet(intake(results));
    swipeAway(() => results.push({ kind: 'cancelled' }));
    expect(results).toEqual([{ kind: 'cancelled' }]);
    expect(useBodySheetPresenter.getState()).toEqual({ request: null, visible: false });

    const onCancel = jest.fn();
    presentTargetSheet({ kind: 'pick', goal: 'lose_weight', onPicked: jest.fn(), onCancel });
    expect(useBodySheetPresenter.getState().visible).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
    swipeAway(onCancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(useBodySheetPresenter.getState()).toEqual({ request: null, visible: false });
  });

  it('a save in flight when it went: its close answers once the save has come back', () => {
    const saved = jest.fn();
    presentBodySheet({ kind: 'goal', onSaved: saved });
    const id = useBodySheetPresenter.getState().request!.id;
    // Gone; the sheet's own close was refused while saving.
    bodySheetClosed(id);
    expect(saved).not.toHaveBeenCalled();
    dismissBodySheet(id, saved);
    expect(saved).toHaveBeenCalledTimes(1);
    expect(useBodySheetPresenter.getState()).toEqual({ request: null, visible: false });
  });

  it('a save that failed after it went never leaves the presenter stuck', () => {
    const results: BodyIntakeResult[] = [];
    presentBodySheet(intake(results));
    const goneId = useBodySheetPresenter.getState().request!.id;
    bodySheetClosed(goneId);

    const next: BodyIntakeResult[] = [];
    presentBodySheet(intake(next));
    // The gone one's caller hears a close; the new one is shown.
    expect(results).toEqual([{ kind: 'cancelled' }]);
    expect(next).toEqual([]);
    expect(useBodySheetPresenter.getState().visible).toBe(true);

    // A late close from the gone sheet cannot close the new one.
    dismissBodySheet(goneId, () => results.push({ kind: 'skipped' }));
    expect(useBodySheetPresenter.getState().visible).toBe(true);
    expect(results).toEqual([{ kind: 'cancelled' }]);
  });
});
