/**
 * Wire fixtures for the plan-edit tests, in the shape of the spec's OP-58 to
 * OP-62 (API 0.41.0) and the server's contract section. Synthetic: no member
 * data, invented ids.
 *
 * Not a test file: Jest runs `*.test.ts` only.
 */
export const PROGRAM_ID = '2b1a7f0e-9d8c-4b5a-8e7f-6a5b4c3d2e10';
export const EDIT_A = '5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f';
export const EDIT_B = '6a1d2e3f-4b5c-4d6e-9f70-8b9c0d1e2f30';
export const TODAY_SESSION = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

export const EDITS_PATH = `/health/programs/${PROGRAM_ID}/edits`;
export const applyPath = (editId: string) => `${EDITS_PATH}/${editId}/apply`;
export const undoPath = (editId: string) => `${EDITS_PATH}/${editId}/undo`;
export const discardPath = (editId: string) => `${EDITS_PATH}/${editId}/discard`;

export function previewJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    editId: EDIT_A,
    label: null,
    recommended: true,
    expiresAt: '2026-10-24T12:00:00.000Z',
    summary: 'Push-ups instead of barbell bench press on Push days.',
    becomesCustom: false,
    becomesCustomNote: null,
    touchesToday: false,
    todaySessionId: null,
    changes: [
      {
        scope: 'pattern',
        label: 'Push, every time from Sat 24 Oct',
        dates: ['2026-10-24', '2026-10-28'],
        sessionIds: ['1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b'],
        items: [
          { type: 'swap', before: 'Barbell bench press', after: 'Push-up', own: false },
          { type: 'add', before: null, after: 'Zottman curls', own: true },
        ],
      },
    ],
    exclusions: { added: [{ kind: 'equipment', id: 'barbell', label: 'Barbell' }], removed: [] },
    notApplied: [],
    notAppliedNote: null,
    ...overrides,
  };
}

export function responseJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'preview',
    reply: 'Done: push-ups on your Push days.',
    question: null,
    variants: [previewJson()],
    suggestion: null,
    notApplied: [],
    editsLeftToday: 19,
    replayed: false,
    ...overrides,
  };
}

export function editViewJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: EDIT_A,
    programId: PROGRAM_ID,
    status: 'applied',
    appliedAt: '2026-10-23T10:00:00.000Z',
    undoneAt: null,
    undoUntil: '2099-10-30T10:00:00.000Z',
    undoable: true,
    summary: 'Push-ups instead of barbell bench press on Push days.',
    changes: [],
    ...overrides,
  };
}

export function applyJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    edit: editViewJson(),
    program: { id: PROGRAM_ID, status: 'active', custom: false, cycleDays: null, excludedEquipment: ['barbell'] },
    changed: [{ id: '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b', title: 'Push' }],
    features: ['plan_edit', 'plan_revision'],
    replayed: false,
    ...overrides,
  };
}

export function undoJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    edit: editViewJson({ status: 'undone', undoneAt: '2026-10-23T11:00:00.000Z', undoable: false }),
    program: { id: PROGRAM_ID, status: 'active' },
    changed: [],
    keptRows: 0,
    replayed: false,
    ...overrides,
  };
}
