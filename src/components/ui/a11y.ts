// TalkBack helpers shared by the UI kit.
import { AccessibilityInfo } from 'react-native';

/**
 * Speak a message now (iOS `UIAccessibility.post(.announcement)` /
 * `AccessibilityNotification.Announcement`). Used where something changes
 * that the member cannot see from where their focus is: a toast, a refusal
 * under a field, "Processing" after a scan.
 */
export function announce(message: string): void {
  if (!message) return;
  try {
    AccessibilityInfo.announceForAccessibility(message);
  } catch {
    // No accessibility service bound: nothing to say it to.
  }
}

/**
 * How long a message that asks for an action should stay, honouring the
 * member's Android "Time to take action" setting (iOS has no equivalent; it
 * keeps the fixed time). Falls back to `ms` wherever the setting cannot be read.
 */
export async function recommendedTimeout(ms: number): Promise<number> {
  try {
    const value = await AccessibilityInfo.getRecommendedTimeoutMillis(ms);
    return typeof value === 'number' && Number.isFinite(value) && value >= ms ? value : ms;
  } catch {
    return ms;
  }
}

/** Props that hide a decorative view (and everything in it) from TalkBack. */
export const hiddenFromAccessibility = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;
