/**
 * The No energy sheet's rules (iOS NoEnergySheet): which choices the server
 * allows, the blocked line, the swap copy, and how each refusal is read.
 */
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { postSessionAction, SessionAction } from '../../../../health';
import { blockedLineKey, moveCopy, noEnergyFailure, offersMove, offersSkip, SKIP_REASON_CHOICES } from '../rules';

stubApiClientPerTest();

const ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const open = { moveRefused: null, startsInSkipMode: false } as const;

/** What `postSessionAction` throws for a reply. */
async function refusal(reply: ReturnType<typeof Reply.problem>): Promise<unknown> {
  api.on('POST', `/health/sessions/${ID}`, reply);
  return postSessionAction(ID, SessionAction.move, 'no-energy-key-0001').catch((error: unknown) => error);
}

describe('which choices appear', () => {
  it('move only when the server says canMove, and never from a missed row or after a refusal', () => {
    expect(offersMove({ canMove: true }, open)).toBe(true);
    expect(offersMove({ canMove: false }, open)).toBe(false);
    expect(offersMove({ canMove: null }, open)).toBe(false);
    expect(offersMove({ canMove: true }, { moveRefused: null, startsInSkipMode: true })).toBe(false);
    expect(offersMove({ canMove: true }, { moveRefused: 'limit', startsInSkipMode: false })).toBe(false);
  });

  it('skip unless the server says no', () => {
    expect(offersSkip({ canSkip: true })).toBe(true);
    expect(offersSkip({ canSkip: null })).toBe(true);
    expect(offersSkip({})).toBe(true);
    expect(offersSkip({ canSkip: false })).toBe(false);
  });

  it('the reasons are Time, Tired, Sore and Other, in that order', () => {
    expect(SKIP_REASON_CHOICES).toEqual(['time', 'tired', 'sore', 'other']);
  });
});

describe('the blocked line', () => {
  it("reads the server's reason when the move is off", () => {
    expect(blockedLineKey({ canMove: false, moveBlockedReason: 'limit' }, open)).toBe('noenergy.move_limit');
    expect(blockedLineKey({ canMove: false, moveBlockedReason: 'past_week' }, open)).toBe('noenergy.move_past_week');
    expect(blockedLineKey({ canMove: false, moveBlockedReason: 'plan_end' }, open)).toBe('noenergy.move_unavailable');
    expect(blockedLineKey({ canMove: false, moveBlockedReason: null }, open)).toBeNull();
  });

  it('says nothing while the move is on, unless it was just refused', () => {
    expect(blockedLineKey({ canMove: true, moveBlockedReason: 'limit' }, open)).toBeNull();
    expect(blockedLineKey({ canMove: true }, { moveRefused: 'past_week', startsInSkipMode: false })).toBe('noenergy.move_past_week');
    expect(blockedLineKey({ canMove: false, moveBlockedReason: 'limit' }, { moveRefused: 'past_week', startsInSkipMode: false })).toBe(
      'noenergy.move_past_week',
    );
  });

  it('never on a missed row, which only skips', () => {
    expect(blockedLineKey({ canMove: false, moveBlockedReason: 'limit' }, { moveRefused: null, startsInSkipMode: true })).toBeNull();
  });
});

describe('move or swap', () => {
  it('a swap when tomorrow holds a session', () => {
    expect(moveCopy(null)).toEqual({ titleKey: 'noenergy.move', subtitleKey: 'noenergy.move_sub', params: {} });
    expect(moveCopy(undefined).titleKey).toBe('noenergy.move');
    expect(moveCopy('Legs')).toEqual({ titleKey: 'noenergy.swap', subtitleKey: 'noenergy.swap_sub', params: { title: 'Legs' } });
  });
});

describe('refusals', () => {
  it('a move refused for the limit or the week turns into the skip offer', async () => {
    expect(noEnergyFailure(await refusal(Reply.problem(409, 'session_move_limit')))).toEqual({ kind: 'moveRefused', reason: 'limit' });
    expect(noEnergyFailure(await refusal(Reply.problem(409, 'session-move-past-week')))).toEqual({
      kind: 'moveRefused',
      reason: 'past_week',
    });
  });

  it('session_action_not_allowed means the card is stale', async () => {
    expect(noEnergyFailure(await refusal(Reply.problem(409, 'session_action_not_allowed', { reason: 'not_today' })))).toEqual({
      kind: 'changed',
    });
  });

  it('no answer is offline; anything else is the general line', async () => {
    expect(noEnergyFailure(await refusal(Reply.fail()))).toEqual({ kind: 'offline' });
    expect(noEnergyFailure(await refusal(Reply.problem(500, 'internal_error')))).toEqual({ kind: 'other', api: true });
    expect(noEnergyFailure(new Error('boom'))).toEqual({ kind: 'other', api: false });
  });
});
