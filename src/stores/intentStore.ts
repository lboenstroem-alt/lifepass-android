/**
 * Where something asked the app to GO: the Android port of the routing half
 * of iOS `AppState` (pendingTab, pendingPlanAction, pendingCoachPrompt,
 * pendingCoachProgram, pendingExploreSights, pendingScanVenueId,
 * exploreLaunchPresentation, scanCameraLive).
 *
 * WHY A STORE OF INTENTS. Only the tabs shell owns the selected tab, and only
 * a screen knows when it is ready to act (Plan after its read, the Coach
 * after its chat loads). A service with no view (a tapped notification, a
 * deep link that cold-started the app) or a screen in another tab parks what
 * it wants here; the shell or the screen takes it, ONCE, and clears it. A
 * flag that is written and never read sits there for the rest of the session
 * and fires late, so every consumer clears what it takes.
 *
 * The rules iOS keeps, kept here:
 * - A check-in link only PARKS a venue id (validated as a venue UUID). It
 *   never checks anyone in: the Scan tab asks "Check in at <venue>?" first.
 *   It survives sign-in (a link that opened a signed-out app is waiting when
 *   the member arrives) and is forgotten at sign-out, so it never opens
 *   under the next member.
 * - A scan link this session holds the post-sign-up Kenni nudge back, even
 *   after the Scan tab has taken the venue (`scanArrivedThisSession`).
 * - Anything that takes the member to another tab first (a scan link, a
 *   notification, a parked tab other than Explore, a payment or card return)
 *   cancels the launch-time "Explore with its filters open", so it can never
 *   fire later when they switch to Explore themselves. iOS decides the
 *   launch tab synchronously in `App.init`, before any link is delivered;
 *   here launch decides it after async reads, and the link that opened the
 *   app can arrive first. So a cancel is remembered for the app session
 *   (`launchPresentationCancelled`), and launch turning the presentation on
 *   afterwards is ignored.
 * - Each check-in link brings the Scan tab forward, even a second link to the
 *   same venue that is still parked (`scanLinkCount` counts arrivals; the
 *   shell watches the count, not the id).
 * - A parked Plan action is worth performing for 5 minutes: long enough for
 *   a cold launch to sign in and read the day on a bad connection, short
 *   enough that it is still the tap the member made.
 *
 * Sign-out forgets everything a member parked (iOS `handleSignOut`). Android
 * also forgets a parked Coach prompt (it can be words the member typed on
 * Home) and a parked "sights on the map"; iOS leaves those two, which only a
 * member who signs out between a tap and the next screen could ever see.
 */
import { create } from 'zustand';

import { registerSignOutCleaner } from '../app/signOut';
import { isVenueUuid } from '../checkin/walkInQrParser';
import type { MainTab } from '../navigation/types';
import { registerKennitalaPromptBlocker, useAppStore } from './appStore';

// ---------------------------------------------------------------------------
// What can be parked

/**
 * Something Plan performs after its read (iOS `PlanAction`), parked by Home,
 * the Coach, a notification or a toast. Consumed once.
 */
export type PlanAction =
  | { readonly kind: 'startWorkout'; readonly sessionId: string }
  | { readonly kind: 'openWeeklyCheckIn' }
  | { readonly kind: 'openDiary'; readonly date: string }
  | { readonly kind: 'showAdoptedBanner'; readonly startsOn: string | null }
  | { readonly kind: 'openProposal' }
  | { readonly kind: 'openPastPlans' }
  | { readonly kind: 'openDraft'; readonly mealId: string }
  /** A tapped monthly feedback notification: the report it names, or the current one. */
  | { readonly kind: 'openFeedback'; readonly reportId: string | null }
  /** A tapped mid-month note notification: the card on Plan. */
  | { readonly kind: 'openFeedbackNote' };

/** A Plan action and when it was parked (the 5-minute window runs from here). */
export interface ParkedPlanAction {
  readonly action: PlanAction;
  /** `Date.now()` when it was parked. */
  readonly parkedAt: number;
}

/** How the member entered the Coach's programme wizard (iOS `CoachProgramEntry`). */
export type CoachProgramEntry =
  | { readonly kind: 'planTab' }
  | { readonly kind: 'nextBlock'; readonly programId: string }
  | { readonly kind: 'home' }
  /** Adjust my plan, from a feedback line's action. Carries nothing of the report. */
  | { readonly kind: 'adjust' };

/**
 * A plan change asked for from another tab (iOS `CoachPlanEditEntry`): Plan's
 * "Change with Coach" (the day it was tapped on) or the runner's "I don't
 * have this" (the exercise, and the words the Coach's input is filled with;
 * the member sends them, never the app).
 */
export interface CoachPlanEditEntry {
  readonly sessionId?: string | null;
  /** The day's title, for "What would you like to change about {title}?". */
  readonly sessionTitle?: string | null;
  readonly exerciseId?: string | null;
  /** Put in the input, unsent. Absent: the Coach asks what to change. */
  readonly prefill?: string | null;
}

/** How long a parked Plan action stays worth performing (iOS `PlanView.parkedActionWindow`). */
export const PLAN_ACTION_WINDOW_MS = 5 * 60 * 1000;

/** True while `parked` is still the tap the member made. */
export function isPlanActionFresh(parked: ParkedPlanAction, now: number = Date.now()): boolean {
  return now - parked.parkedAt <= PLAN_ACTION_WINDOW_MS;
}

// ---------------------------------------------------------------------------
// State

export interface IntentState {
  /** A tab another screen or a notification asked for; the tabs shell takes it. */
  readonly pendingTab: MainTab | null;
  /** Something for Plan to do after its read. */
  readonly pendingPlanAction: ParkedPlanAction | null;
  /** A prompt for the Coach to send as a fresh turn (Home's cards and chips, Plan's "plan my day"). */
  readonly pendingCoachPrompt: string | null;
  /** The Coach's programme wizard, asked for from Plan, Home or the end of a block. */
  readonly pendingCoachProgram: CoachProgramEntry | null;
  /** A plan change in chat, asked for from Plan or the runner. */
  readonly pendingCoachPlanEdit: CoachPlanEditEntry | null;
  /** Home's "See all on the map": Explore opens on the map with sights showing. */
  readonly pendingExploreSights: boolean;
  /** A venue a check-in link parked (lower-case UUID); the Scan tab asks first, then clears it. */
  readonly pendingScanVenueId: string | null;
  /** A check-in link arrived at some point this app session (never reset by consuming the venue). */
  readonly scanArrivedThisSession: boolean;
  /**
   * How many check-in links have arrived this app session. The tabs shell
   * switches to Scan whenever it grows, so a second link to a venue still
   * parked (the same id, so no change in `pendingScanVenueId`) brings Scan
   * forward again.
   */
  readonly scanLinkCount: number;
  /** The cold launch opened on Explore: Explore shows the venues with the filters open, once. */
  readonly exploreLaunchPresentation: boolean;
  /**
   * Something took the member elsewhere this app session (a check-in link, a
   * tab other than Explore, a payment or card return). From then on launch
   * can no longer turn the Explore presentation on: the link that opened the
   * app may be delivered before launch has decided its tab.
   */
  readonly launchPresentationCancelled: boolean;
  /** The Scan tab is showing a live camera: the tab bar turns dark over it. */
  readonly scanCameraLive: boolean;
}

export interface IntentActions {
  /** Ask for a tab. Any tab but Explore cancels the launch-time filter presentation. */
  requestTab(tab: MainTab): void;
  /** The tabs shell took the parked tab. */
  clearPendingTab(): void;
  /** Park an action for Plan (stamped now). */
  parkPlanAction(action: PlanAction, now?: number): void;
  /**
   * Take the parked Plan action, if one is waiting and still fresh; clears it
   * either way. Plan keeps the returned record (with `parkedAt`) until the
   * screen that answers it exists, and drops it once `isPlanActionFresh` says no.
   */
  takePlanAction(now?: number): ParkedPlanAction | null;
  parkCoachPrompt(prompt: string): void;
  /** Take the parked Coach prompt (cleared). */
  takeCoachPrompt(): string | null;
  parkCoachProgram(entry: CoachProgramEntry): void;
  /** Take the parked programme-wizard entry (cleared). */
  takeCoachProgram(): CoachProgramEntry | null;
  parkCoachPlanEdit(entry: CoachPlanEditEntry): void;
  /** Take the parked plan-change entry (cleared). */
  takeCoachPlanEdit(): CoachPlanEditEntry | null;
  /** Home's "See all on the map". */
  requestExploreSights(): void;
  /** Explore takes the sights request (cleared); true when there was one. */
  takeExploreSights(): boolean;
  /**
   * Park a venue from a check-in link. Ignored unless `venueId` is a venue
   * UUID. Holds the Kenni nudge back for the rest of the session, retracts a
   * nudge on screen (without counting it as dismissed) and cancels the
   * launch-time Explore presentation.
   */
  parkScanVenue(venueId: string): boolean;
  /** The Scan tab takes the parked venue (cleared). */
  takeScanVenue(): string | null;
  /**
   * Launch only: whether Explore opens with its filters (the cold launch
   * landed on Explore). Ignored once something has cancelled it this session.
   */
  setExploreLaunchPresentation(on: boolean): void;
  /** Something took the member elsewhere first (a payment or card return, say). */
  cancelExploreLaunchPresentation(): void;
  /** Explore takes the launch presentation (cleared); true when it should open the filters. */
  takeExploreLaunchPresentation(): boolean;
  /** The Scan tab's camera went live or stopped. */
  setScanCameraLive(live: boolean): void;
  /** Everything a member parked is forgotten (sign-out). */
  resetForSignOut(): void;
}

export type IntentStore = IntentState & IntentActions;

const initialState: IntentState = {
  pendingTab: null,
  pendingPlanAction: null,
  pendingCoachPrompt: null,
  pendingCoachProgram: null,
  pendingCoachPlanEdit: null,
  pendingExploreSights: false,
  pendingScanVenueId: null,
  scanArrivedThisSession: false,
  scanLinkCount: 0,
  exploreLaunchPresentation: false,
  launchPresentationCancelled: false,
  scanCameraLive: false,
};

/** What every "the member went elsewhere first" writes (iOS clears the flag; see `launchPresentationCancelled`). */
const CANCEL_LAUNCH_PRESENTATION = { exploreLaunchPresentation: false, launchPresentationCancelled: true } as const;

/**
 * Holds the post-sign-up Kenni nudge back once a check-in link has arrived
 * this session: never block a member walking up to a door. The app store
 * evaluates it after the profile read, by which time the Scan tab may have
 * taken the venue already, hence the session flag.
 */
function scanLinkBlocksKennitalaPrompt(): boolean {
  return useIntentStore.getState().scanArrivedThisSession;
}

export const useIntentStore = create<IntentStore>()((set, get) => ({
  ...initialState,

  requestTab(tab) {
    set(tab === 'Explore' ? { pendingTab: tab } : { pendingTab: tab, ...CANCEL_LAUNCH_PRESENTATION });
  },

  clearPendingTab() {
    if (get().pendingTab !== null) set({ pendingTab: null });
  },

  parkPlanAction(action, now = Date.now()) {
    set({ pendingPlanAction: { action, parkedAt: now } });
  },

  takePlanAction(now = Date.now()) {
    const parked = get().pendingPlanAction;
    if (!parked) return null;
    set({ pendingPlanAction: null });
    return isPlanActionFresh(parked, now) ? parked : null;
  },

  parkCoachPrompt(prompt) {
    const trimmed = prompt.trim();
    set({ pendingCoachPrompt: trimmed.length > 0 ? trimmed : null });
  },

  takeCoachPrompt() {
    const prompt = get().pendingCoachPrompt;
    if (prompt !== null) set({ pendingCoachPrompt: null });
    return prompt;
  },

  parkCoachProgram(entry) {
    set({ pendingCoachProgram: entry });
  },

  takeCoachProgram() {
    const entry = get().pendingCoachProgram;
    if (entry !== null) set({ pendingCoachProgram: null });
    return entry;
  },

  parkCoachPlanEdit(entry) {
    set({ pendingCoachPlanEdit: { ...entry } });
  },

  takeCoachPlanEdit() {
    const entry = get().pendingCoachPlanEdit;
    if (entry !== null) set({ pendingCoachPlanEdit: null });
    return entry;
  },

  requestExploreSights() {
    set({ pendingExploreSights: true });
  },

  takeExploreSights() {
    if (!get().pendingExploreSights) return false;
    set({ pendingExploreSights: false });
    return true;
  },

  parkScanVenue(venueId) {
    const id = venueId.trim();
    if (!isVenueUuid(id)) return false;
    // Idempotent (the app store keeps a set); re-registered here because a
    // test that resets the app store clears its blockers.
    registerKennitalaPromptBlocker(scanLinkBlocksKennitalaPrompt);
    set({
      pendingScanVenueId: id.toLowerCase(),
      scanArrivedThisSession: true,
      scanLinkCount: get().scanLinkCount + 1,
      ...CANCEL_LAUNCH_PRESENTATION,
    });
    // A check-in outranks the Kenni nudge: retract a sheet on screen, without
    // counting it as dismissed, so it can come back at the next launch.
    if (useAppStore.getState().pendingKennitalaPrompt) useAppStore.setState({ pendingKennitalaPrompt: false });
    return true;
  },

  takeScanVenue() {
    const id = get().pendingScanVenueId;
    if (id !== null) set({ pendingScanVenueId: null });
    return id;
  },

  setExploreLaunchPresentation(on) {
    set({ exploreLaunchPresentation: on && !get().launchPresentationCancelled });
  },

  cancelExploreLaunchPresentation() {
    if (get().exploreLaunchPresentation || !get().launchPresentationCancelled) set(CANCEL_LAUNCH_PRESENTATION);
  },

  takeExploreLaunchPresentation() {
    if (!get().exploreLaunchPresentation) return false;
    set({ exploreLaunchPresentation: false });
    return true;
  },

  setScanCameraLive(live) {
    if (get().scanCameraLive !== live) set({ scanCameraLive: live });
  },

  resetForSignOut() {
    // `scanArrivedThisSession`, `scanLinkCount` and
    // `launchPresentationCancelled` stay: they describe this app session, not
    // the member (iOS keeps `scanArrivedThisSession` too).
    set({
      pendingTab: null,
      pendingPlanAction: null,
      pendingCoachPrompt: null,
      pendingCoachProgram: null,
      pendingCoachPlanEdit: null,
      pendingExploreSights: false,
      pendingScanVenueId: null,
      exploreLaunchPresentation: false,
      scanCameraLive: false,
    });
  },
}));

registerKennitalaPromptBlocker(scanLinkBlocksKennitalaPrompt);

// A link parked for one member must not open under the next; nor a tab, a
// Plan action or a Coach prompt (iOS `handleSignOut`).
registerSignOutCleaner('nav.intents', () => useIntentStore.getState().resetForSignOut());

/** Back to a fresh app session (tests). */
export function resetIntentStoreForTests(): void {
  useIntentStore.setState({ ...initialState });
  registerKennitalaPromptBlocker(scanLinkBlocksKennitalaPrompt);
}
