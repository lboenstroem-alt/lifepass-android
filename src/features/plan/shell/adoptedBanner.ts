/**
 * The one-time banner after an adopt (iOS `PlanAdoptedBanner`, `ios-ux.md`
 * 3.5 and 5.6 step 5): "Your plan starts {date}." and what the member will be
 * reminded of.
 *
 * Three lines, three different truths:
 * - the member turned the reminder toggle off: `banner_plain`, no promise;
 * - the toggle is on but this phone refused notifications: `banner_no_notes`,
 *   because "Workout day notes are on" would be false and the member would
 *   find that out by missing a workout;
 * - the toggle is on and the phone allows them: `banner`.
 *
 * All three have to be reachable: the middle one is the only honest line for
 * a member who left the toggle on and then told the system "Don't allow".
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ReminderKeys } from '../../../health';

export type AdoptedBannerKey = 'plan.adopted.banner' | 'plan.adopted.banner_no_notes' | 'plan.adopted.banner_plain';

export const ADOPTED_BANNER_KEYS: readonly AdoptedBannerKey[] = [
  'plan.adopted.banner',
  'plan.adopted.banner_no_notes',
  'plan.adopted.banner_plain',
];

/** The toggle off outranks the permission: the member asked for no notes, so the banner promises none. */
export function adoptedBannerKey(wantsNotes: boolean, notificationsDenied: boolean): AdoptedBannerKey {
  if (!wantsNotes) return 'plan.adopted.banner_plain';
  return notificationsDenied ? 'plan.adopted.banner_no_notes' : 'plan.adopted.banner';
}

/**
 * Whether the phone refused notifications when the member adopted (iOS
 * `health.reminders.<id>.denied`), written by the adopt tap (the moment the
 * system prompt was answered) and by Body and goals' reminder switch.
 *
 * Not in F7's `ReminderKeys` yet, so the health wipe does not remove it
 * (contract request to F7: add it there). It holds a yes or no about
 * notifications, never a health value. The writers (PLAN-4's proposal card,
 * BODY-1) use this builder so the name stays iOS's.
 */
export function reminderDeniedKey(profileId: string): string {
  return `health.reminders.${profileId}.denied`;
}

/** A stored flag as iOS `UserDefaults.bool` reads it: 'true', '1' or a JSON true. */
export function storedFlag(raw: string | null): boolean {
  if (raw === null) return false;
  const value = raw.trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

/**
 * The key for this member, read from what the phone stored. A member never
 * asked (no stored toggle) wants the notes, as iOS's default is on.
 */
export async function readAdoptedBannerKey(profileId: string | null | undefined): Promise<AdoptedBannerKey> {
  if (!profileId) return 'plan.adopted.banner_plain';
  try {
    const [toggle, denied] = await Promise.all([
      AsyncStorage.getItem(ReminderKeys.workoutDay(profileId)),
      AsyncStorage.getItem(reminderDeniedKey(profileId)),
    ]);
    const wantsNotes = toggle === null || storedFlag(toggle);
    return adoptedBannerKey(wantsNotes, storedFlag(denied));
  } catch {
    // Storage unreadable: promise nothing.
    return 'plan.adopted.banner_plain';
  }
}
