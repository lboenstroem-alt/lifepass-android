/**
 * What Start, Discard and the reminder toggle do (iOS ProgramProposalCard's
 * `adopt`, `discard`, `writeReminderPreferences` and
 * `loadReminderPreferences`), shared by the card and the programme overview
 * in proposal mode, so the replace rule and the reminder promise live in ONE
 * place: two copies of an Adopt button is two places for them to be wrong.
 *
 * Every write carries a fresh Idempotency-Key per member action, as iOS mints
 * one per tap.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ApiError, newIdempotencyKey } from '../../../api';
import { adoptProgram, discardProgram, ReminderKeys, useHealthStore, type ProgramSummary } from '../../../health';
import { track } from '../../../lib/analytics';
import { requestIfUndetermined } from '../../../notifications';
import { useAppStore } from '../../../stores/appStore';
import { useIntentStore } from '../../../stores/intentStore';
import { reminderDeniedKey, storedFlag } from '../shell/adoptedBanner';

import {
  adoptFailure,
  DEFAULT_REMINDER_MINUTES,
  discardFailure,
  notificationsDeniedAfterAdopt,
  type AdoptFailure,
  type DiscardFailure,
  type ProposalOutcome,
} from './proposalRules';

// ---------------------------------------------------------------------------
// Reminder preferences (iOS `health.reminders.<id>.workoutday|time|denied`)

export interface ReminderPreferences {
  readonly remindersOn: boolean;
  /** Minutes after midnight. */
  readonly minutes: number;
}

/**
 * The member's stored choice, or the defaults (on, 07:00): a missing key
 * reads as its default, the rule Body and goals uses too. Stored as
 * `'true'`/`'false'` and the minutes as a whole number, which is what
 * `storedFlag` (Plan's adopted banner) and Body and goals read.
 */
export async function loadReminderPreferences(profileId: string | null | undefined): Promise<ReminderPreferences> {
  const defaults = { remindersOn: true, minutes: DEFAULT_REMINDER_MINUTES };
  if (!profileId) return defaults;
  try {
    const [toggle, time] = await Promise.all([
      AsyncStorage.getItem(ReminderKeys.workoutDay(profileId)),
      AsyncStorage.getItem(ReminderKeys.time(profileId)),
    ]);
    const minutes = Number.parseInt(time ?? '', 10);
    return {
      remindersOn: toggle === null ? true : storedFlag(toggle),
      minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_REMINDER_MINUTES,
    };
  } catch {
    return defaults;
  }
}

/**
 * Written ONLY when the plan actually starts (`ios-ux.md` 0.6): a member who
 * toggled and then tapped Not now has changed nothing. `denied` is written
 * beside them because this tap is the only moment the app knows the answer
 * to the system prompt it just raised, and Plan's adopted banner is drawn a
 * moment later on the other side of the tab bar.
 */
export async function writeReminderPreferences(
  profileId: string,
  preferences: ReminderPreferences & { readonly notificationsDenied: boolean },
): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [ReminderKeys.workoutDay(profileId), preferences.remindersOn ? 'true' : 'false'],
      [ReminderKeys.time(profileId), String(preferences.minutes)],
      [reminderDeniedKey(profileId), preferences.notificationsDenied ? 'true' : 'false'],
    ]);
  } catch {
    // Not stored: the banner promises nothing it cannot read, and the planner keeps its defaults.
  }
}

// ---------------------------------------------------------------------------
// Adopt and discard

export type AdoptResult =
  | { readonly kind: 'started'; readonly startsOn: string | null }
  | { readonly kind: 'failed'; readonly failure: AdoptFailure };

export interface AdoptRequest {
  readonly program: Pick<ProgramSummary, 'id'>;
  readonly replaceActive: boolean;
  readonly reminders: ReminderPreferences;
  /** Where Start was tapped, for `program_adopted`. */
  readonly entry: 'coach' | 'plan';
}

/**
 * Start (iOS `adopt(replaceActive:)`). The permission ask rides the tap, so
 * the system dialog appears where the member expects it, and only with the
 * reminders on. A refusal does not block adoption, but Plan's banner has to
 * know: "Workout day notes are on" under a phone that will send none is the
 * kind of small lie that costs a workout.
 *
 * On success: the reminder preferences are written, Plan is asked to show
 * the adopted banner, and the Plan tab is asked for. A refusal from the
 * server is classified (./proposalRules.ts `adoptFailure`); one that is not
 * the card's business is handed to the health store first, and a plan
 * changed elsewhere leaves Plan's toast.
 */
export async function adoptProposal(request: AdoptRequest): Promise<AdoptResult> {
  track('program_proposal_action', { action: 'start' });
  const { remindersOn, minutes } = request.reminders;
  const notesWillArrive = remindersOn ? await requestIfUndetermined() : false;
  try {
    const response = await adoptProgram(request.program.id, request.replaceActive, newIdempotencyKey());
    const profileId = useAppStore.getState().profile?.id ?? null;
    if (profileId) {
      await writeReminderPreferences(profileId, {
        remindersOn,
        minutes,
        notificationsDenied: notificationsDeniedAfterAdopt(remindersOn, notesWillArrive),
      });
    }
    track('program_adopted', { entry: request.entry, replaced: response.replaced !== null });
    const startsOn = response.program?.program.startsOn ?? null;
    const intents = useIntentStore.getState();
    intents.parkPlanAction({ kind: 'showAdoptedBanner', startsOn });
    intents.requestTab('Plan');
    return { kind: 'started', startsOn };
  } catch (error) {
    const failure = adoptFailure(error);
    noteFailure(error, failure);
    return { kind: 'failed', failure };
  }
}

export type DiscardResult = { readonly kind: 'discarded' } | { readonly kind: 'failed'; readonly failure: DiscardFailure };

/** Discard, after the member confirmed (iOS `discard()`): the plan and the weight entered for it go. */
export async function discardProposal(program: Pick<ProgramSummary, 'id'>): Promise<DiscardResult> {
  track('program_proposal_action', { action: 'discard' });
  try {
    await discardProgram(program.id, newIdempotencyKey());
    return { kind: 'discarded' };
  } catch (error) {
    const failure = discardFailure(error);
    noteFailure(error, failure);
    return { kind: 'failed', failure };
  }
}

/** "This was changed on another device" for Plan, or the health store's own reading of a refusal. */
function noteFailure(error: unknown, failure: AdoptFailure | DiscardFailure): void {
  if (failure === 'changed') {
    useHealthStore.getState().setToast('health.err.changed');
  } else if (failure === 'other' && error instanceof ApiError) {
    useHealthStore.getState().handle(error, { foreground: true });
  }
}

// ---------------------------------------------------------------------------
// Outcomes heard across screens

type OutcomeListener = (outcome: ProposalOutcome) => void;

const listeners = new Map<string, Set<OutcomeListener>>();

/**
 * A card listens for what becomes of ITS proposal on another screen (Start
 * or Discard in the weeks screen), so the Coach can remember the outcome on
 * its message and the card stays collapsed. Returns the unsubscribe.
 */
export function onProposalOutcome(programId: string, listener: OutcomeListener): () => void {
  const set = listeners.get(programId) ?? new Set<OutcomeListener>();
  set.add(listener);
  listeners.set(programId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(programId);
  };
}

/** Tells every card showing `programId` what became of it. */
export function reportProposalOutcome(programId: string, outcome: ProposalOutcome): void {
  for (const listener of [...(listeners.get(programId) ?? [])]) {
    try {
      listener(outcome);
    } catch {
      // One card failing must not stop the others hearing it.
    }
  }
}

// ---------------------------------------------------------------------------
// The card's reminder choice, for Start in the weeks screen

const reminderDrafts = new Map<string, ReminderPreferences>();

/**
 * The card's toggle and time as they stand, so Start in the weeks screen
 * sends what the card shows (iOS: the weeks sheet's Start runs the card's
 * own `adopt`, with the card's toggle). Nothing is STORED until a plan
 * starts; this is memory only.
 */
export function noteReminderDraft(programId: string, preferences: ReminderPreferences): void {
  reminderDrafts.set(programId, preferences);
}

/** The card's choice for `programId`, or null when no card showed it. */
export function reminderDraft(programId: string): ReminderPreferences | null {
  return reminderDrafts.get(programId) ?? null;
}

/** Tests and sign-out: nobody listening, no card's choice remembered. */
export function resetProposalBridges(): void {
  listeners.clear();
  reminderDrafts.clear();
}
