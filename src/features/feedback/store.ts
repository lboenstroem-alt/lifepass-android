/**
 * The monthly feedback as this phone knows it: the summary (FB-1), the three
 * switches, and the local flags around them (`SPEC` 9.1). The Android port of
 * iOS ViewModels/FeedbackStore.swift.
 *
 * Built by `createFeedbackStore(deps)`: it keeps no reference to the app's
 * state. The app hands it an `environment` (who is signed in, their language,
 * whether the server and the member allow the feature) and the hooks it
 * reports back through, so a test can stand it up against the stub server
 * (./feedbackStore.ts is the app's one instance).
 *
 * WHAT IT NEVER DOES. It never sends a reason with a switch, never sends the
 * answer to a safety question (it has no way to know one), and never passes
 * report or note text anywhere but the screens that draw it.
 *
 * LOCAL FLAGS live in AsyncStorage under `health.feedback.<profileId>.*`
 * (src/health/localKeys.ts `FeedbackKeys`, so the health wipe removes exactly
 * these). AsyncStorage is asynchronous where iOS's UserDefaults is not, so
 * the store also keeps the current member's flags in memory (`flags`), read
 * once per member and written through; until they are read, the card shows
 * no intro and no offer rather than one that may vanish a moment later.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import {
  applySettingsChange,
  fetchFeedbackSummary,
  foodAndWeightChosen,
  isFeedbackRouteMissing,
  markFeedbackReport,
  revertSettingsChange,
  updateFeedbackSettings,
  type FeedbackSettings,
  type FeedbackSettingsChange,
  type FeedbackSettingsResponse,
  type FeedbackSummary,
} from '../../api/feedback';
import { ApiError } from '../../api/errors';
import { newIdempotencyKey } from '../../api/idempotency';
import { FeedbackKeys } from '../../health/localKeys';
import type { Lang } from '../../i18n';
import { todayServerDay } from '../../i18n/format';
import { track } from '../../lib/analytics';

/** What the store needs from the app for one call. */
export interface FeedbackEnvironment {
  readonly profileId: string;
  readonly language: Lang;
  /** `supportsFeedback && hasHealthConsent`: the app never calls `/health/feedback*` without both. */
  readonly eligible: boolean;
  /** The server's `features` as the app holds them now. */
  readonly features: readonly string[];
}

export type FeedbackLoadState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly at: Date }
  | { readonly kind: 'failed' };

/** One member's local flags, as read from AsyncStorage. */
export interface FeedbackLocalFlags {
  readonly profileId: string;
  readonly introDismissed: boolean;
  readonly foodOfferDismissed: boolean;
  /** A food-off from a safety answer is still to be sent. */
  readonly foodOffPending: boolean;
}

type FlagName = 'introDismissed' | 'foodOfferDismissed' | 'foodOffPending';

/** The switch whose save is in flight (`savingSettings`), by iOS's names. */
export type FeedbackSettingName = 'monthly' | 'note' | 'food';

export interface FeedbackStoreDeps {
  /** Null when nobody is signed in with a loaded profile. */
  readonly environment: () => FeedbackEnvironment | null;
  /** Every feedback answer carries `features`; last writer wins. */
  readonly onServerFeatures: (features: readonly string[] | null) => void;
  /**
   * A consent or age refusal: handed to the health store as a BACKGROUND
   * problem (a feedback read never presents the consent sheet).
   */
  readonly onProblem: (error: ApiError) => void;
  /** Something the notification plan depends on changed. */
  readonly onChanged: () => void;
  /** Every `health.feedback.*` notification, pending and delivered, goes. */
  readonly removeNotifications: () => Promise<void>;
}

export interface FeedbackStoreState {
  readonly summary: FeedbackSummary | null;
  readonly loadState: FeedbackLoadState;
  readonly lastFetchedAt: Date | null;
  /**
   * The Iceland day of the last successful read: a new day re-reads even
   * inside the ten minute window (the 1st of the month is exactly when it
   * matters).
   */
  readonly lastFetchedDay: string | null;
  /** Set by a failed switch save, for Body and goals' error line (`bodygoals.fb_err`). Cleared by the next tap. */
  readonly settingsErrorKey: string | null;
  /** The switches whose save is in flight, so their toggles can hold still. */
  readonly savingSettings: readonly FeedbackSettingName[];
  /**
   * THE STALE FLAG (`SPEC` 9.1). FB-1 answered with a bare 404: the server
   * was rolled back after it advertised `health_feedback`. Every feedback
   * screen hides for as long as the app holds the feature list it held then,
   * and comes back by itself when a later read changes that list.
   */
  readonly staleFeatures: readonly string[] | null;
  /** The current member's local flags; null until read. */
  readonly flags: FeedbackLocalFlags | null;
}

export interface FeedbackStoreActions {
  /** True when the feature list the app holds is the one FB-1 404'd under. */
  isHidden(features: readonly string[]): boolean;
  /**
   * Read the summary. Throttled to once per ten minutes (and once per Iceland
   * day) unless `force`. Concurrent calls share one request. A safety
   * food-off still waiting goes first.
   */
  refresh(options?: { readonly force?: boolean; readonly now?: Date }): Promise<void>;
  /**
   * The three switches. Each moves AT ONCE (the toggle never snaps back for a
   * frame) and saves in the background; the promise is the save.
   */
  setMonthly(on: boolean): Promise<void>;
  setNote(on: boolean): Promise<void>;
  /** Deliberately not reported to analytics (`SPEC` D17). */
  setIncludeFoodAndWeight(on: boolean): Promise<void>;
  /**
   * The member answered the one-time offer on Plan. Either answer is sent, so
   * the offer ends on every device; "Not now" keeps food and weight off. A
   * failure says nothing on Plan. Not reported to analytics (D17).
   */
  answerFoodOffer(include: boolean, profileId: string): Promise<void>;
  /**
   * Called by the Coach when the member answered yes to pregnancy or
   * breastfeeding, or to a history of an eating disorder. Sends
   * `{ "includeFoodAndWeight": false }` and NOTHING ELSE.
   */
  turnOffFoodAndWeightForSafety(now?: Date): Promise<void>;
  /** Whether a food-off from a safety answer is still waiting to be sent (read from storage). */
  foodOffPending(profileId: string): Promise<boolean>;
  /** One attempt, at most `timeoutMs`, before the session ends (sign-out). */
  sendPendingFoodOffBeforeSignOut(timeoutMs?: number): Promise<void>;
  /** The member opened a monthly report, or saw the note card. Once per id per session. */
  markSeen(id: string, now?: Date): Promise<void>;
  /** Hide the note. Optimistic; a failed dismiss puts the card back. */
  dismissNote(id: string): Promise<void>;
  /** The Plan card's intro was closed. */
  dismissIntro(profileId: string): Promise<void>;
  /** The one-time offer was closed (and the intro it stood in for). */
  dismissFoodOffer(profileId: string): Promise<void>;
  /** Reads this member's flags into memory (once per member). */
  loadFlags(profileId: string): Promise<FeedbackLocalFlags>;
  /** Forget everything in memory (the health wipe removes the stored flags). */
  wipe(): void;
}

export type FeedbackStore = FeedbackStoreState & FeedbackStoreActions;

/** Reads re-run at most this often unless forced (pull to refresh, a notification tap, a new Iceland day). */
export const FEEDBACK_FRESHNESS_WINDOW_MS = 10 * 60 * 1000;

/** The sign-out's one short try (iOS `sendPendingFoodOffBeforeSignOut(timeout: 3)`). */
export const SIGN_OUT_FOOD_OFF_TIMEOUT_MS = 3_000;

const CONSENT_PROBLEMS = ['health_consent_required', 'health_minor_blocked'] as const;

/**
 * Whether a local safety refusal should turn food and weight off: they are
 * on, or they are off only BY DEFAULT (the member never chose), or the
 * summary has not loaded. In the last two cases the PUT makes the choice
 * explicit, which is what keeps the one-time "Include food and weight?" offer
 * from ever being shown to this member afterwards.
 */
export function shouldTurnOffFoodForSafety(settings: FeedbackSettings | null | undefined): boolean {
  if (!settings) return true;
  return settings.includeFoodAndWeight || !foodAndWeightChosen(settings);
}

function settingName(change: FeedbackSettingsChange): FeedbackSettingName {
  switch (change.key) {
    case 'monthlyReport':
      return 'monthly';
    case 'midMonthNote':
      return 'note';
    case 'includeFoodAndWeight':
      return 'food';
  }
}

function flagKey(name: FlagName, profileId: string): string {
  return FeedbackKeys[name](profileId);
}

async function readFlag(name: FlagName, profileId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(flagKey(name, profileId))) === 'true';
  } catch {
    return false;
  }
}

function sameFeatures(a: readonly string[], b: readonly string[]): boolean {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((feature, index) => feature === right[index]);
}

const initialState = (): FeedbackStoreState => ({
  summary: null,
  loadState: { kind: 'idle' },
  lastFetchedAt: null,
  lastFetchedDay: null,
  settingsErrorKey: null,
  savingSettings: [],
  staleFeatures: null,
  flags: null,
});

export function createFeedbackStore(deps: FeedbackStoreDeps) {
  return create<FeedbackStore>()((set, get) => {
    /** Bumped by `wipe()`: an answer that left before a wipe must not land on the next member's screen. */
    let generation = 0;
    let refreshInFlight: Promise<void> | null = null;
    let refreshAbort: AbortController | null = null;
    const seenInFlight = new Set<string>();
    let flagsGeneration = 0;

    /** `summary?.x = y`: a change to a summary that is gone (wiped) is dropped. */
    function patchSummary(patch: (summary: FeedbackSummary) => FeedbackSummary): void {
      const summary = get().summary;
      if (summary) set({ summary: patch(summary) });
    }

    function setSettings(settings: FeedbackSettings): void {
      patchSummary((summary) => ({ ...summary, settings }));
    }

    async function writeFlag(name: FlagName, profileId: string, value: boolean): Promise<void> {
      // Memory first, so the card goes at once; storage after.
      const flags = get().flags;
      const inMemory = flags !== null && flags.profileId === profileId;
      if (inMemory && flags[name] !== value) set({ flags: { ...flags, [name]: value } });
      // A read of this member's flags still running would land the value
      // from before this write: it is dropped, and read again below.
      if (!inMemory) flagsGeneration += 1;
      try {
        if (value) await AsyncStorage.setItem(flagKey(name, profileId), 'true');
        else await AsyncStorage.removeItem(flagKey(name, profileId));
      } catch {
        // Memory still says it for this session.
      }
      if (!inMemory && deps.environment()?.profileId === profileId) void get().loadFlags(profileId);
    }

    async function performRefresh(env: FeedbackEnvironment, now: Date, today: string): Promise<void> {
      const startedGeneration = generation;
      if (get().summary === null) set({ loadState: { kind: 'loading' } });
      const abort = new AbortController();
      refreshAbort = abort;
      try {
        const answer = await fetchFeedbackSummary(env.language, { signal: abort.signal });
        if (startedGeneration !== generation || deps.environment()?.profileId !== env.profileId) return;
        set({
          summary: answer,
          lastFetchedAt: now,
          lastFetchedDay: today,
          loadState: { kind: 'loaded', at: now },
          staleFeatures: null,
        });
        deps.onServerFeatures(answer.features);
        deps.onChanged();
      } catch (error) {
        if (error instanceof ApiError) {
          if (startedGeneration !== generation || error.isCancellation) return;
          set({ loadState: { kind: 'failed' } });
          if (isFeedbackRouteMissing(error)) {
            set({ staleFeatures: [...env.features], summary: null });
            await deps.removeNotifications().catch(() => undefined);
          } else if (error.isProblem(...CONSENT_PROBLEMS)) {
            set({ summary: null });
            await deps.removeNotifications().catch(() => undefined);
            deps.onProblem(error);
          }
          return;
        }
        if (startedGeneration !== generation) return;
        set({ loadState: { kind: 'failed' } });
      } finally {
        if (refreshAbort === abort) refreshAbort = null;
      }
    }

    /** The PUT, retried once on a transient failure with the SAME key. */
    async function saveSetting(change: FeedbackSettingsChange, env: FeedbackEnvironment): Promise<FeedbackSettingsResponse> {
      const key = newIdempotencyKey();
      try {
        return await updateFeedbackSettings(change, key, env.language);
      } catch (error) {
        if (error instanceof ApiError && error.isRetryable && !error.isCancellation && !error.isProblem('rate_limited')) {
          return updateFeedbackSettings(change, key, env.language);
        }
        throw error;
      }
    }

    /**
     * Optimistic: the switch moves now, and goes back with an error line when
     * the save fails. One Idempotency-Key per tap, reused for its one retry.
     */
    async function saveSwitch(
      change: FeedbackSettingsChange,
      tracked: 'monthly' | 'note' | null,
      showsError = true,
    ): Promise<void> {
      const env = deps.environment();
      const previous = get().summary?.settings;
      if (!env?.eligible || !previous) return;
      const name = settingName(change);
      let optimistic = applySettingsChange(change, previous);
      if (change.key === 'includeFoodAndWeight') optimistic = { ...optimistic, includeFoodAndWeightSource: 'member' };
      set({ settingsErrorKey: null, savingSettings: [...get().savingSettings.filter((n) => n !== name), name] });
      setSettings(optimistic);
      const startedGeneration = generation;
      try {
        const answer = await saveSetting(change, env);
        if (startedGeneration !== generation) return;
        if (answer.settings) setSettings(answer.settings);
        deps.onServerFeatures(answer.features);
        if (tracked) track('feedback_setting_changed', { setting: tracked, value: change.value ? 'on' : 'off' });
        // What FB-1 offers (the report, the note, the next report) depends on
        // the switches, so the summary is read again.
        deps.onChanged();
        await get().refresh({ force: true });
      } catch (error) {
        if (startedGeneration !== generation) return;
        const current = get().summary?.settings;
        if (current) setSettings(revertSettingsChange(change, current, previous));
        if (showsError) set({ settingsErrorKey: 'bodygoals.fb_err' });
        if (error instanceof ApiError && error.isProblem(...CONSENT_PROBLEMS)) deps.onProblem(error);
      } finally {
        if (startedGeneration === generation) set({ savingSettings: get().savingSettings.filter((n) => n !== name) });
      }
    }

    async function sendFoodOff(env: FeedbackEnvironment, signal?: AbortSignal): Promise<void> {
      try {
        const answer = await updateFeedbackSettings(
          { key: 'includeFoodAndWeight', value: false },
          newIdempotencyKey(),
          env.language,
          { signal },
        );
        await writeFlag('foodOffPending', env.profileId, false);
        if (answer.settings && deps.environment()?.profileId === env.profileId) setSettings(answer.settings);
        deps.onServerFeatures(answer.features);
      } catch (error) {
        // Consent gone: there is nothing left to switch off, and the
        // withdrawal deleted the setting row anyway.
        if (error instanceof ApiError && (error.isProblem(...CONSENT_PROBLEMS) || isFeedbackRouteMissing(error))) {
          await writeFlag('foodOffPending', env.profileId, false);
        }
      }
    }

    async function retryPendingFoodOff(env: FeedbackEnvironment): Promise<void> {
      if (!(await readFlag('foodOffPending', env.profileId))) return;
      await sendFoodOff(env);
    }

    function applySeen(id: string, at: Date): void {
      patchSummary((summary) => {
        let next = summary;
        if (next.latest && next.latest.id === id && next.latest.seenAt === null) {
          next = { ...next, latest: { ...next.latest, seenAt: at } };
        }
        if (next.note && next.note.id === id && next.note.seenAt === null) {
          next = { ...next, note: { ...next.note, seenAt: at } };
        }
        return next;
      });
    }

    return {
      ...initialState(),

      isHidden(features) {
        const stale = get().staleFeatures;
        return stale !== null && sameFeatures(stale, features);
      },

      async refresh(options = {}) {
        const force = options.force ?? false;
        const now = options.now ?? new Date();
        const env = deps.environment();
        if (!env?.eligible) return;
        void get().loadFlags(env.profileId);
        await retryPendingFoodOff(env);
        const today = todayServerDay(now);
        const { summary, lastFetchedAt, lastFetchedDay } = get();
        if (
          !force &&
          summary !== null &&
          lastFetchedAt !== null &&
          lastFetchedDay === today &&
          now.getTime() - lastFetchedAt.getTime() < FEEDBACK_FRESHNESS_WINDOW_MS
        ) {
          return;
        }
        const running = refreshInFlight;
        if (running) {
          await running;
          if (!force) return;
        }
        const task = performRefresh(env, now, today);
        refreshInFlight = task;
        try {
          await task;
        } finally {
          if (refreshInFlight === task) refreshInFlight = null;
        }
      },

      setMonthly(on) {
        return saveSwitch({ key: 'monthlyReport', value: on }, 'monthly');
      },

      setNote(on) {
        return saveSwitch({ key: 'midMonthNote', value: on }, 'note');
      },

      setIncludeFoodAndWeight(on) {
        return saveSwitch({ key: 'includeFoodAndWeight', value: on }, null);
      },

      async answerFoodOffer(include, profileId) {
        const closed = get().dismissFoodOffer(profileId);
        patchSummary((summary) => ({ ...summary, foodAndWeightOffer: false }));
        await Promise.all([closed, saveSwitch({ key: 'includeFoodAndWeight', value: include }, null, false)]);
      },

      async turnOffFoodAndWeightForSafety(now = new Date()) {
        const env = deps.environment();
        if (!env?.eligible) return;
        patchSummary((summary) => {
          const settings = summary.settings
            ? {
                ...summary.settings,
                includeFoodAndWeight: false,
                includeFoodAndWeightSource: 'member' as const,
                updatedAt: summary.settings.updatedAt ?? now,
              }
            : null;
          return { ...summary, settings, foodAndWeightOffer: false };
        });
        // The pending flag goes down BEFORE the request, so a phone killed
        // mid-call still sends it on the next foreground; a success clears it.
        await writeFlag('foodOffPending', env.profileId, true);
        await sendFoodOff(env);
        deps.onChanged();
      },

      foodOffPending(profileId) {
        return readFlag('foodOffPending', profileId);
      },

      async sendPendingFoodOffBeforeSignOut(timeoutMs = SIGN_OUT_FOOD_OFF_TIMEOUT_MS) {
        const env = deps.environment();
        if (!env?.eligible || !(await readFlag('foodOffPending', env.profileId))) return;
        // A request still running at the deadline is cancelled. What does not
        // get through survives the sign-out wipe (`FeedbackKeys.keptOnSignOut`)
        // and goes first thing at this member's next sign-in.
        const abort = new AbortController();
        const deadline = setTimeout(() => abort.abort(), Math.max(0, timeoutMs));
        try {
          await sendFoodOff(env, abort.signal);
        } finally {
          clearTimeout(deadline);
        }
      },

      async markSeen(id, now = new Date()) {
        const env = deps.environment();
        if (!env?.eligible || seenInFlight.has(id)) return;
        const summary = get().summary;
        if (summary?.latest?.id === id && summary.latest.seenAt !== null) return;
        if (summary?.note?.id === id && summary.note.seenAt !== null) return;
        seenInFlight.add(id);
        try {
          applySeen(id, now);
          const startedGeneration = generation;
          try {
            const answer = await markFeedbackReport(id, 'seen', newIdempotencyKey(), env.language);
            if (startedGeneration === generation) {
              applySeen(id, answer.seenAt ?? now);
              deps.onChanged();
            }
          } catch {
            // Left for the next open: the server keeps the first time either way.
          }
        } finally {
          seenInFlight.delete(id);
        }
      },

      async dismissNote(id) {
        const env = deps.environment();
        const note = get().summary?.note;
        if (!env?.eligible || !note || note.id !== id) return;
        track('feedback_note_dismissed');
        patchSummary((summary) => ({ ...summary, note: null }));
        deps.onChanged();
        const startedGeneration = generation;
        try {
          await markFeedbackReport(id, 'dismiss', newIdempotencyKey(), env.language);
        } catch {
          const summary = get().summary;
          if (startedGeneration !== generation || summary === null || summary.note !== null) return;
          set({ summary: { ...summary, note } });
          deps.onChanged();
        }
      },

      async dismissIntro(profileId) {
        await writeFlag('introDismissed', profileId, true);
      },

      async dismissFoodOffer(profileId) {
        await Promise.all([writeFlag('foodOfferDismissed', profileId, true), writeFlag('introDismissed', profileId, true)]);
      },

      async loadFlags(profileId) {
        const current = get().flags;
        if (current && current.profileId === profileId) return current;
        const startedGeneration = flagsGeneration;
        const [introDismissed, foodOfferDismissed, foodOffPending] = await Promise.all([
          readFlag('introDismissed', profileId),
          readFlag('foodOfferDismissed', profileId),
          readFlag('foodOffPending', profileId),
        ]);
        const flags: FeedbackLocalFlags = { profileId, introDismissed, foodOfferDismissed, foodOffPending };
        // A write for this member while the read ran is newer than the read.
        const now = get().flags;
        if (now && now.profileId === profileId) return now;
        if (startedGeneration === flagsGeneration) set({ flags });
        return flags;
      },

      wipe() {
        generation += 1;
        flagsGeneration += 1;
        refreshAbort?.abort();
        refreshAbort = null;
        refreshInFlight = null;
        seenInFlight.clear();
        // The stale flag is about the server, not the member: it stays.
        set({ ...initialState(), staleFeatures: get().staleFeatures });
      },
    };
  });
}

export type FeedbackStoreHook = ReturnType<typeof createFeedbackStore>;
