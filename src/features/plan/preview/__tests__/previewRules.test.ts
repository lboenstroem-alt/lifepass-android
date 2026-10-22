/**
 * The session preview's one action and its refusals (iOS SessionPreviewSheet):
 * a refusal code hides "Do it today"; offline shows the hint and keeps it.
 */
import { DecodingError, ProblemError, TransportError } from '../../../../api';
import { pullFailure, previewAction, PULL_REFUSALS } from '../previewRules';

const problem = (slug: string, status = 409) =>
  new ProblemError({ type: `https://lifepass.is/problems/${slug}`, title: slug, status }, status);

describe('the one action', () => {
  it('is Start for today\'s runner session, else Do it today while the server allows it', () => {
    expect(previewAction({ canPull: true }, { canStart: true, pullHidden: false })).toBe('start');
    expect(previewAction({ canPull: true }, { canStart: false, pullHidden: false })).toBe('pull');
    expect(previewAction({ canPull: true }, { canStart: false, pullHidden: true })).toBeNull();
    expect(previewAction({ canPull: false }, { canStart: false, pullHidden: false })).toBeNull();
    expect(previewAction({ canPull: null }, { canStart: false, pullHidden: false })).toBeNull();
  });
});

describe('a pull that failed', () => {
  it.each(PULL_REFUSALS)('%s hides the button', (slug) => {
    expect(pullFailure(problem(slug))).toEqual({ kind: 'hide' });
  });

  it('folds hyphens the way the server sometimes spells them', () => {
    expect(pullFailure(problem('today-not-free'))).toEqual({ kind: 'hide' });
  });

  it('offline keeps the button and says it needs a connection', () => {
    expect(pullFailure(new TransportError('offline'))).toEqual({ kind: 'message', key: 'health.offline.action_hint' });
  });

  it('anything else is the generic line', () => {
    expect(pullFailure(problem('internal_error', 500))).toEqual({ kind: 'message', key: 'common.error_body' });
    expect(pullFailure(new DecodingError('{}'))).toEqual({ kind: 'message', key: 'common.error_body' });
    expect(pullFailure(new Error('boom'))).toEqual({ kind: 'message', key: 'common.error_body' });
  });

  it('a cancelled request says nothing', () => {
    expect(pullFailure(new TransportError('cancelled'))).toEqual({ kind: 'cancelled' });
  });
});
