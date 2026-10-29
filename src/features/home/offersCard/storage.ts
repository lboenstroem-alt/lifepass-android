/**
 * "No thanks" on the card, kept on this phone per member, beside the account's
 * own (POST /profile/offers-card/dismiss), so a No thanks the server never
 * heard (offline, a timeout) still holds here, and Home sends it again the
 * next time the profile still offers the card (./useOffersCard.ts).
 *
 * One key per member (iOS OffersCardStore.dismissedKey), so two accounts on
 * one phone never share an answer. Like the Profile pointer's keys
 * (src/navigation/profile.ts) it says only that this member does not want to
 * be asked, and it stays on the phone at sign-out. Reads and writes never
 * throw: a phone that cannot keep it still has the account's.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/** The member's "No thanks" on this phone (iOS `offers.card.<profileId>.dismissed`). */
export function offersCardDismissedKey(profileId: string): string {
  return `offers.card.${profileId}.dismissed`;
}

/** Whether this member said "No thanks" on this phone. False when storage cannot be read. */
export async function readNoThanksOnPhone(profileId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(offersCardDismissedKey(profileId))) === 'true';
  } catch {
    return false;
  }
}

/** Keeps this member's "No thanks" on this phone. Never throws. */
export async function keepNoThanksOnPhone(profileId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(offersCardDismissedKey(profileId), 'true');
  } catch {
    // The account keeps it (when the call lands); this phone may ask once more.
  }
}
