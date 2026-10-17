/**
 * Every AsyncStorage key that says something about a member's health use,
 * named in one place so the local wipe removes exactly these and nothing a
 * feature added on its own survives it. A package that keeps a new health
 * key ADDS ITS BUILDER HERE (a contract request to F7), never under a name of
 * its own: a key the wipe does not know is a key that outlives a sign-out.
 *
 * The names are iOS's UserDefaults keys, so the two apps describe one
 * member's state the same way. Values are flags, dates and settings, never a
 * health value.
 */

// ---------------------------------------------------------------------------
// Reminders (Body and goals, the reminder planner)

/** The reminder settings, per member (iOS `HealthReminderPreferences`). */
export const ReminderKeys = {
  /** Workout-day notes on or off. */
  workoutDay: (profileId: string) => `health.reminders.${profileId}.workoutday`,
  /** The time of day the notes fire. */
  time: (profileId: string) => `health.reminders.${profileId}.time`,
  /** The weekly check-in reminder on or off. */
  weeklyCheckIn: (profileId: string) => `health.reminders.${profileId}.weeklycheckin`,
  /** The check-in's weekday. */
  checkInDay: (profileId: string) => `health.reminders.${profileId}.checkinDay`,
  /** The check-in's time. */
  checkInTime: (profileId: string) => `health.reminders.${profileId}.checkinTime`,
  all(profileId: string): string[] {
    return [
      ReminderKeys.workoutDay(profileId),
      ReminderKeys.time(profileId),
      ReminderKeys.weeklyCheckIn(profileId),
      ReminderKeys.checkInDay(profileId),
      ReminderKeys.checkInTime(profileId),
    ];
  },
} as const;

// ---------------------------------------------------------------------------
// Screens

/** The Scan tab's meal-gate sheet was seen once (iOS `scan.meal.gateSeen.<id>`). */
export const scanMealGateSeenKey = (profileId: string) => `scan.meal.gateSeen.${profileId}`;

/** The Plan intro card was collapsed with Not now (iOS `plan.intro.collapsed.<id>`). */
export const planIntroCollapsedKey = (profileId: string) => `plan.intro.collapsed.${profileId}`;

// ---------------------------------------------------------------------------
// The monthly feedback (iOS `FeedbackLocalKeys`)

export const FeedbackKeys = {
  /** The member the background check reads for. Written while eligible; removed when not, and by the wipe. */
  lastProfileId: 'health.feedback.lastProfileId',
  /** `{ identifier: fire date }` of the notifications this phone scheduled, capped at 24. */
  notified: (profileId: string) => `health.feedback.${profileId}.notified`,
  /** When the background check last read the feedback. */
  lastCheck: (profileId: string) => `health.feedback.${profileId}.lastCheck`,
  introDismissed: (profileId: string) => `health.feedback.${profileId}.introDismissed`,
  /** A safety food-off still to send. Reason-free. */
  foodOffPending: (profileId: string) => `health.feedback.${profileId}.foodOffPending`,
  /** The one-time "Include food and weight?" offer was closed. */
  foodOfferDismissed: (profileId: string) => `health.feedback.${profileId}.foodOfferDismissed`,
  all(profileId: string): string[] {
    return [
      FeedbackKeys.notified(profileId),
      FeedbackKeys.lastCheck(profileId),
      FeedbackKeys.introDismissed(profileId),
      FeedbackKeys.foodOffPending(profileId),
      FeedbackKeys.foodOfferDismissed(profileId),
    ];
  },
  /**
   * What a SIGN-OUT wipe leaves: only a safety food-off still to be sent. The
   * Coach has told the member food and weight are out of their feedback;
   * dropping the flag because they signed out while offline would leave the
   * server's switch on for good. One reason-free boolean, keyed by their id,
   * cleared by the send at their next sign-in. A withdrawal, an age block and
   * an account deletion remove it with the rest: there is no setting left.
   */
  keptOnSignOut(profileId: string): string[] {
    return [FeedbackKeys.foodOffPending(profileId)];
  },
} as const;

// ---------------------------------------------------------------------------
// A wearable connection (iOS's Apple Health marker and anchors)
//
// Android ships no Health Connect (owner decision), so nothing writes these
// yet. The wipe and the reconcile still read and remove them, so a later
// Health Connect build inherits a teardown that already works.

export const WearableKeys = {
  /** The member this phone is the connected one for. */
  connectedProfileId: 'health.ah.connectedProfileId',
  anchor: (profileId: string, type: string) => `health.ah.${profileId}.anchor.${type}`,
  /** The list of anchor types written, so the teardown removes exactly those. */
  anchorIndex: (profileId: string) => `health.ah.${profileId}.anchorTypes`,
} as const;
