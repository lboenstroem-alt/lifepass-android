/**
 * The day plan's renderer as the `dayPlan` flow registers it (../flows/dayPlan.ts).
 *
 * LOADED ON FIRST DRAW, NOT AT IMPORT. The Coach's store imports every flow,
 * and the store loads with the sign-in and sign-out hooks (src/app/
 * registrations.ts), long before any chat is drawn and in places that never
 * draw one (a headless sign-out, the session tests). The plan cards draw
 * with the UI kit, its icon fonts and the class sheet; required here at
 * import, they would load all of that wherever the store loads. So the flow
 * registers this thin component, which requires the real one the first
 * time a plan is on screen (Metro and Jest both resolve the require once and
 * keep it).
 */
/* eslint-disable @typescript-eslint/no-require-imports -- loaded on first draw (see above) */
import { createElement } from 'react';

import type { CoachMessageRendererProps } from '../flows/types';
import type * as PlanMessageModule from './PlanMessage';

export function PlanMessageRenderer(props: CoachMessageRendererProps) {
  const { default: PlanMessage } = require('./PlanMessage') as typeof PlanMessageModule;
  return createElement(PlanMessage, props);
}
