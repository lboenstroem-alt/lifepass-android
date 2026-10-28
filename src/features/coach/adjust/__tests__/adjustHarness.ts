/**
 * What the Adjust my plan tests share: the running plan and standing target
 * of iOS `CoachAdjustPrivacyTests`, a context to stand the flow up in one
 * line, and `tap`, which answers the last open question the way a member
 * does (through the store's `selectOption`, as the chips call it).
 *
 * Not a test file: Jest runs `*.test.ts` only.
 */
import { decodeProgramSummary, decodeTargetWeightView, type ProgramSummary, type TargetWeightView } from '../../../../health';
import { lookup } from '../../../../i18n';
import type { ProgramContext } from '../../program/context';
import { useCoachStore } from '../../store/coachStore';
import { isOpenQuestion, type CoachMessage } from '../../store/messages';

export const PROGRAM_ID = '2b1a7f0e-9d8c-4b5a-8e7f-6a5b4c3d2e10';

/** English copy with `{name}` placeholders filled. */
export function en(key: string, params: Record<string, string> = {}): string {
  let text = lookup(key, 'en');
  for (const [name, value] of Object.entries(params)) text = text.split(`{${name}}`).join(value);
  return text;
}

export const coach = () => useCoachStore.getState();
export const messages = () => coach().messages;
export const last = (): CoachMessage => messages()[messages().length - 1]!;
export const assistantTexts = () => messages().filter((m) => m.role === 'assistant').map((m) => m.text);

export function programJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PROGRAM_ID,
    status: 'active',
    goal: 'build_muscle',
    daysPerWeek: 3,
    weeks: 4,
    trainingDays: [1, 3, 5],
    summaryTitle: 'Build muscle, 3 days a week',
    ...overrides,
  };
}

/** The running plan, as the Today read hands it over. */
export function liveProgram(overrides: Record<string, unknown> = {}): ProgramSummary {
  return decodeProgramSummary(programJson(overrides), 'program');
}

/** A standing lose target of 68.5 kg, not reached. */
export function standingTarget(overrides: Record<string, unknown> = {}): TargetWeightView {
  return decodeTargetWeightView({ targetWeightKg: 68.5, direction: 'lose', appliesTo: 'goal', ...overrides }, 'targetWeight');
}

/**
 * Entitled, tracking on, a plan running on a server that revises and takes
 * targets: the context the iOS tests adjust in.
 */
export function adjustingContext(overrides: Partial<ProgramContext> = {}): Partial<ProgramContext> {
  return {
    access: 'entitled',
    hasConsent: true,
    hasLiveProgram: true,
    latestWeightKg: 80.4,
    latestHeightCm: 172,
    supportsTargetWeight: true,
    supportsPlanRevision: true,
    liveProgram: liveProgram(),
    liveProgramId: PROGRAM_ID,
    standingTarget: standingTarget(),
    ...overrides,
  };
}

/** The last question bubble that can still answer, whichever flow asked it. */
export function openBubble(): CoachMessage {
  const open = [...messages()].reverse().find(isOpenQuestion);
  if (!open) throw new Error(`no open bubble (last: ${last().text})`);
  return open;
}

/** The labels on the last open bubble. */
export const openLabels = (): string[] => (openBubble().options ?? []).map((option) => option.label);

/** Taps the chip labelled `label` on the last open bubble. */
export async function tap(label: string): Promise<void> {
  const bubble = openBubble();
  const option = bubble.options?.find((candidate) => candidate.label === label);
  if (!option) throw new Error(`no chip "${label}" on "${bubble.text}" (${bubble.options?.map((o) => o.label).join(' | ')})`);
  await coach().selectOption(bubble.id, option.value, option.label);
}

/** Lets the event loop turn until `condition` holds (a stubbed request has arrived, say). */
export async function until(condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 50 && !condition(); turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  if (!condition()) throw new Error('the condition never held');
}
