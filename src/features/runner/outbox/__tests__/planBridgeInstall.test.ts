/**
 * The merge guard for Plan's half of the workout outbox. PLAN-1 owns the
 * bridge (`src/features/plan/shell/bridges.ts`); it is not on RUN-1's branch,
 * so ../../register.ts cannot install the workout source yet (its merge
 * checklist names the line). Once both packages are on one branch this test
 * runs, and fails until PLAN-1's feature index exports the bridge and the
 * runner installs into it: without that, Plan's load sends nothing with
 * foreground semantics and never shows the failed-item banner, so a failed
 * workout would wait unseen until the seven-day expiry dropped it.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { workoutPlanOutboxSource } from '../planSource';

const BRIDGES = join(__dirname, '../../../plan/shell/bridges.ts');
const planOnThisBranch = existsSync(BRIDGES);

(planOnThisBranch ? it : it.skip)('the runner installs the workout half of Plan\'s outbox bridge', () => {
  /* eslint-disable @typescript-eslint/no-require-imports -- the bridge exists only once PLAN-1 is merged */
  require('../../register');
  const plan = require('../../../plan') as { installedOutboxes?: () => readonly unknown[] };
  /* eslint-enable @typescript-eslint/no-require-imports */
  expect(typeof plan.installedOutboxes).toBe('function');
  expect(plan.installedOutboxes?.()).toContain(workoutPlanOutboxSource);
});

it('the source has every member PLAN-1\'s PlanOutboxSource asks for, and Plan\'s appearance', () => {
  for (const member of ['activate', 'flush', 'failedItems', 'saveAsExtra', 'discard', 'subscribe'] as const) {
    expect(typeof workoutPlanOutboxSource[member]).toBe('function');
  }
});
