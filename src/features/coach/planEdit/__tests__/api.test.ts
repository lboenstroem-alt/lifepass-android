/**
 * The five plan-edit operations as the phone sends them (path, method,
 * Idempotency-Key, the exact body keys the strict server schemas take), the
 * answers decoded fail soft, and every refusal mapped to what the member
 * sees. The wire is the spec's OP-58 to OP-62 (API 0.41.0); the vendored
 * contract is 0.34.0 until the server PR lands, so the shapes are checked
 * here against the spec rather than the contract file.
 */
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import {
  applyPlanEdit,
  cleanPlanEditText,
  discardPlanEdit,
  fetchPlanEdits,
  isPlanEditSendable,
  planEditApplyFailure,
  planEditBody,
  planEditFailureCopyKey,
  planEditSendFailure,
  planEditUndoFailure,
  postPlanEdit,
  undoPlanEdit,
} from '../api';
import { decodePlanEditResponse } from '../types';

import {
  applyJson,
  applyPath,
  discardPath,
  EDIT_A,
  EDIT_B,
  EDITS_PATH,
  editViewJson,
  previewJson,
  PROGRAM_ID,
  responseJson,
  TODAY_SESSION,
  undoJson,
  undoPath,
} from './planEditFixtures';

stubApiClientPerTest();

async function failureOf<T>(call: () => Promise<T>): Promise<import('../../../../api').ApiError> {
  try {
    await call();
  } catch (error) {
    return error as import('../../../../api').ApiError;
  }
  throw new Error('the call did not fail');
}

describe('the words', () => {
  it('are cleaned as the server cleans them: NFC, no control characters, whitespace collapsed', () => {
    expect(cleanPlanEditText('  swap\u0007  bench\n\tpress  ')).toBe('swap bench press');
    expect(cleanPlanEditText('Bankdrücken')).toBe('Bankdrücken');
  });

  it('go only as 2 to 500 characters', () => {
    expect(isPlanEditSendable('a')).toBe(false);
    expect(isPlanEditSendable(' ok ')).toBe(true);
    expect(isPlanEditSendable('x'.repeat(500))).toBe(true);
    expect(isPlanEditSendable('x'.repeat(501))).toBe(false);
  });

  it('build a body with only the keys that say something', () => {
    expect(planEditBody({ message: ' swap  it ', language: 'is' })).toEqual({ message: 'swap it', locale: 'is' });
    expect(planEditBody({ message: 'x y', language: 'de', replacesEditId: EDIT_A, sessionId: TODAY_SESSION, exerciseId: 'lat-pulldown' })).toEqual({
      message: 'x y',
      locale: 'en',
      replacesEditId: EDIT_A,
      context: { sessionId: TODAY_SESSION, exerciseId: 'lat-pulldown' },
    });
    expect(planEditBody({ message: 'x y', language: 'en', sessionId: null, exerciseId: null })).not.toHaveProperty('context');
  });
});

describe('OP-58', () => {
  it('posts the words with the caller\'s key and decodes a preview', async () => {
    api.on('POST', EDITS_PATH, Reply.ok(responseJson()));
    const answer = await postPlanEdit(PROGRAM_ID, planEditBody({ message: 'swap bench for push-ups', language: 'en' }), 'edit-key-1');
    const sent = api.sent(EDITS_PATH, 'POST');
    expect(sent.headers['idempotency-key']).toBe('edit-key-1');
    expect(sent.body).toEqual({ message: 'swap bench for push-ups', locale: 'en' });
    expect(answer.kind).toBe('preview');
    expect(answer.variants).toHaveLength(1);
    const variant = answer.variants[0]!;
    expect(variant.editId).toBe(EDIT_A);
    expect(variant.changes[0]!.items).toEqual([
      { type: 'swap', before: 'Barbell bench press', after: 'Push-up', own: false },
      { type: 'add', before: null, after: 'Zottman curls', own: true },
    ]);
    expect(variant.exclusions.added[0]!.label).toBe('Barbell');
    expect(variant.expiresAt?.toISOString()).toBe('2026-10-24T12:00:00.000Z');
    expect(answer.editsLeftToday).toBe(19);
  });
});

describe('decoding OP-58 fail soft', () => {
  it('drops a variant it cannot read, and a preview with none left is no change', () => {
    const one = decodePlanEditResponse(responseJson({ variants: [previewJson(), { editId: 42 }] }));
    expect(one.variants).toHaveLength(1);
    const none = decodePlanEditResponse(responseJson({ variants: [{ summary: 'no id' }] }));
    expect(none.kind).toBe('no_change');
  });

  it('keeps at most two variants and four choices', () => {
    const three = decodePlanEditResponse(responseJson({ variants: [previewJson(), previewJson({ editId: EDIT_B }), previewJson({ editId: 'x' })] }));
    expect(three.variants.map((v) => v.editId)).toEqual([EDIT_A, EDIT_B]);
    const clarify = decodePlanEditResponse(
      responseJson({ kind: 'clarify', variants: [], question: { text: 'Which press?', choices: ['A', 'B', 'C', 'D', 'E', ' '] } }),
    );
    expect(clarify.question).toEqual({ text: 'Which press?', choices: ['A', 'B', 'C', 'D'] });
  });

  it('reads an unknown kind, scope, item type or reason as unknown, and drops an item that says nothing', () => {
    const answer = decodePlanEditResponse(
      responseJson({
        variants: [
          previewJson({
            changes: [{ scope: 'galaxy', label: 'All', dates: [], sessionIds: [], items: [{ type: 'teleport', after: 'X' }, { type: 'swap' }] }],
            notApplied: [{ reason: 'cosmic', text: 'Not this one.' }, { reason: 'unsafe' }],
          }),
        ],
      }),
    );
    const variant = answer.variants[0]!;
    expect(variant.changes[0]!.scope).toBe('unknown');
    expect(variant.changes[0]!.items).toEqual([{ type: 'unknown', before: null, after: 'X', own: false }]);
    expect(variant.notApplied).toEqual([{ reason: 'unknown', text: 'Not this one.' }]);
    expect(decodePlanEditResponse({ kind: 'later' }).kind).toBe('unknown');
  });

  it('a replayed clarify has no question, and not_plan_edit no reply', () => {
    expect(decodePlanEditResponse({ kind: 'clarify', reply: 'Tap a choice or ask me again.', question: null, replayed: true })).toMatchObject({
      kind: 'clarify',
      question: null,
      replayed: true,
    });
    expect(decodePlanEditResponse({ kind: 'not_plan_edit', reply: null, variants: [] })).toMatchObject({ kind: 'not_plan_edit', reply: null });
  });

  it('refuses an answer with no kind (nothing to act on)', () => {
    expect(() => decodePlanEditResponse({ reply: 'hi' })).toThrow();
  });
});

describe('OP-59 to OP-62', () => {
  it('Apply sends confirmCustom only when confirmed, and decodes the edit and the plan', async () => {
    api.on('POST', applyPath(EDIT_A), Reply.ok(applyJson()));
    const applied = await applyPlanEdit(PROGRAM_ID, EDIT_A, { confirmCustom: false }, 'apply-1');
    expect(api.sent(applyPath(EDIT_A)).body).toEqual({});
    expect(api.sent(applyPath(EDIT_A)).headers['idempotency-key']).toBe('apply-1');
    expect(applied.edit).toMatchObject({ id: EDIT_A, status: 'applied', undoable: true });
    expect(applied.program?.excludedEquipment).toEqual(['barbell']);
    expect(applied.features).toEqual(['plan_edit', 'plan_revision']);
    await applyPlanEdit(PROGRAM_ID, EDIT_A, { confirmCustom: true }, 'apply-2');
    expect(api.sent(applyPath(EDIT_A)).body).toEqual({ confirmCustom: true });
  });

  it('Undo and Discard send no body, each with its key', async () => {
    api.on('POST', undoPath(EDIT_A), Reply.ok(undoJson({ keptRows: 2 })));
    api.on('POST', discardPath(EDIT_A), Reply.ok({ edit: { id: EDIT_A, status: 'discarded' } }));
    const undone = await undoPlanEdit(PROGRAM_ID, EDIT_A, 'undo-1');
    expect(undone.keptRows).toBe(2);
    expect(undone.edit.status).toBe('undone');
    expect(api.sent(undoPath(EDIT_A)).rawBody ?? '').toBe('');
    expect(api.sent(undoPath(EDIT_A)).headers['idempotency-key']).toBe('undo-1');
    const discarded = await discardPlanEdit(PROGRAM_ID, EDIT_A, 'discard-1');
    expect(discarded.edit).toEqual({ id: EDIT_A, status: 'discarded' });
    expect(api.sent(discardPath(EDIT_A)).rawBody ?? '').toBe('');
  });

  it('the history reads in the account language and keeps the rows it can read', async () => {
    api.on('GET', EDITS_PATH, Reply.ok({ edits: [editViewJson(), { status: 'applied' }, editViewJson({ id: EDIT_B, status: 'undone' })] }));
    const edits = await fetchPlanEdits(PROGRAM_ID, 'is');
    expect(api.sent(EDITS_PATH, 'GET').query).toEqual({ locale: 'is' });
    expect(edits.map((e) => [e.id, e.status])).toEqual([
      [EDIT_A, 'applied'],
      [EDIT_B, 'undone'],
    ]);
  });
});

describe('the refusals', () => {
  it.each([
    [409, 'plan_edit_consent_required', {}, 'consent'],
    [422, 'plan_edit_personal_data', {}, 'personalData'],
    [429, 'plan_edit_limit', { reason: 'daily' }, 'limit'],
    [429, 'plan_edit_limit', { reason: 'attempts' }, 'limit'],
    [503, 'plan_edit_paused', {}, 'paused'],
    [502, 'coach_upstream_error', {}, 'upstream'],
    [409, 'program_action_not_allowed', { reason: 'not_live' }, 'notLive'],
    [409, 'program_action_not_allowed', { reason: 'paused' }, 'planPaused'],
    [404, 'health_program_not_found', {}, 'notLive'],
    [400, 'invalid-plan-edit', {}, 'passOn'],
    [404, 'not_found', {}, 'passOn'],
    [409, 'health_consent_required', {}, 'refused'],
    [403, 'no_active_plan_or_pass', {}, 'refused'],
    [409, 'account_pending_deletion', {}, 'refused'],
    [429, 'rate_limited', {}, 'rateLimited'],
  ] as const)('OP-58 %i %s (%j) is %s', async (status, slug, extra, expected) => {
    api.on('POST', EDITS_PATH, Reply.problem(status, slug, extra));
    const error = await failureOf(() => postPlanEdit(PROGRAM_ID, { message: 'swap it', locale: 'en' }, 'k'));
    expect(planEditSendFailure(error)).toBe(expected);
  });

  it('OP-58: a 404 that is no problem is the route gone, and no connection is the Coach\'s offline line', async () => {
    api.on('POST', EDITS_PATH, Reply.raw(404, '<html>Not found</html>'));
    expect(planEditSendFailure(await failureOf(() => postPlanEdit(PROGRAM_ID, { message: 'swap it', locale: 'en' }, 'k')))).toBe('passOn');
    api.on('POST', EDITS_PATH, Reply.fail());
    expect(planEditSendFailure(await failureOf(() => postPlanEdit(PROGRAM_ID, { message: 'swap it', locale: 'en' }, 'k')))).toBe('offline');
  });

  it.each([
    [409, 'plan_edit_stale', {}, 'stale'],
    [404, 'plan_edit_not_found', {}, 'stale'],
    [409, 'plan_edit_confirm_required', {}, 'confirmRequired'],
    [409, 'plan_edit_not_pending', { reason: 'applied' }, 'alreadyApplied'],
    [409, 'plan_edit_not_pending', { reason: 'superseded' }, 'stale'],
    [409, 'plan_edit_not_pending', { reason: 'discarded' }, 'stale'],
    [409, 'program_action_not_allowed', { reason: 'paused' }, 'planPaused'],
    [409, 'program_action_not_allowed', { reason: 'not_live' }, 'notLive'],
  ] as const)('Apply %i %s (%j) is %s', async (status, slug, extra, expected) => {
    api.on('POST', applyPath(EDIT_A), Reply.problem(status, slug, extra));
    const error = await failureOf(() => applyPlanEdit(PROGRAM_ID, EDIT_A, { confirmCustom: false }, 'k'));
    expect(planEditApplyFailure(error)).toBe(expected);
  });

  it.each([
    [409, 'plan_edit_undo_unavailable', { reason: 'window_closed' }, 'undoWindow'],
    [409, 'plan_edit_undo_unavailable', { reason: 'plan_changed' }, 'undoChanged'],
    [409, 'plan_edit_undo_unavailable', { reason: 'later_edit' }, 'undoChanged'],
    [409, 'plan_edit_not_pending', { reason: 'undone' }, 'alreadyUndone'],
  ] as const)('Undo %i %s (%j) is %s', async (status, slug, extra, expected) => {
    api.on('POST', undoPath(EDIT_A), Reply.problem(status, slug, extra));
    const error = await failureOf(() => undoPlanEdit(PROGRAM_ID, EDIT_A, 'k'));
    expect(planEditUndoFailure(error)).toBe(expected);
  });

  it('words each one the member sees in the spec\'s copy', () => {
    expect(planEditFailureCopyKey('personalData')).toBe('coach.planEdit.error.personalData');
    expect(planEditFailureCopyKey('limit')).toBe('coach.planEdit.error.limit');
    expect(planEditFailureCopyKey('paused')).toBe('coach.planEdit.error.paused');
    expect(planEditFailureCopyKey('upstream')).toBe('coach.planEdit.error.upstream');
    expect(planEditFailureCopyKey('stale')).toBe('coach.planEdit.error.stale');
    expect(planEditFailureCopyKey('undoWindow')).toBe('coach.planEdit.error.undoWindow');
    expect(planEditFailureCopyKey('undoChanged')).toBe('coach.planEdit.error.undoChanged');
    expect(planEditFailureCopyKey('notLive')).toBe('coach.planEdit.error.notLive');
    expect(planEditFailureCopyKey('planPaused')).toBe('coach.planEdit.error.planPaused');
    expect(planEditFailureCopyKey('consent')).toBeNull();
  });
});
