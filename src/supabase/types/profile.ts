/**
 * The first Android build's profile types, kept for the screens that still
 * import them. The profile itself is `Profile` in src/api/profile.ts (the
 * v1 `GET /profile` shape, read once by the app store); the old Supabase
 * `profiles` table row this file used to describe is not read by the app.
 */
import { checkInConfirmationCode as confirmationCode, type RecentCheckIn as ApiRecentCheckIn } from '../../api/profile';

export type { Profile } from '../../api/profile';

/**
 * The recent check-in (staff proof) as the first build's banner
 * (CheckInProofBanner, CHECKIN-1) reads it. `memberName` now carries the
 * SHORT name the server sends ("Lucas B.") and never the full name: iOS
 * stopped putting the full name on this screen, and the server shortens it
 * once so the app and the web cannot spell one member two ways at the desk.
 */
export type RecentCheckIn = {
  checkInId: string;
  checkedInAt: Date;
  /** The short name ("Lucas B."), or null. */
  memberName: string | null;
  venue: { id: string; name: string };
  /** The booked class, when the check-in adopted a booking; null for a walk-in. */
  activity: { id: string; name: string } | null;
};

/** The app store's check-in, in the first build's shape. */
export function toLegacyRecentCheckIn(checkIn: ApiRecentCheckIn | null): RecentCheckIn | null {
  if (!checkIn) return null;
  return {
    checkInId: checkIn.checkInId,
    checkedInAt: checkIn.checkedInAt,
    memberName: checkIn.memberShortName,
    venue: { id: checkIn.venue.id, name: checkIn.venue.name },
    activity: checkIn.activity ? { id: checkIn.activity.id, name: checkIn.activity.name } : null,
  };
}

/** Last six of the check-in id, upper-cased: the same short code the web proof shows. */
export function checkInConfirmationCode(c: Pick<RecentCheckIn, 'checkInId'>): string {
  return confirmationCode(c);
}
