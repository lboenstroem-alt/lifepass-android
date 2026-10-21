/**
 * Where TalkBack lands when Plan scrolls to a section for a notification
 * (iOS `.accessibilityFocused($reviewFocused)` on the weekly review card).
 *
 * A scroll nobody can see is not an answer to a notification tap, so the
 * screen-reader focus moves with it. TalkBack only moves to an element it
 * can focus itself: an `accessible` view, never the plain container Plan
 * wraps a section in (making that container accessible would merge the whole
 * card into one element). So the SECTION hands Plan the element to land on,
 * its heading or its card, with this hook:
 *
 *   const focusTarget = usePlanFocusTarget('review');
 *   <LPText ref={focusTarget} accessible accessibilityRole="header">...</LPText>
 *
 * Sections take no props (plan 3.0.3), hence a registry rather than a prop.
 * Only an element mounted now is kept: the ref's cleanup forgets it, and
 * only if it is still the one registered (a new body's card can attach
 * before the old one's goes).
 */
import { useCallback } from 'react';
import { AccessibilityInfo, type HostInstance } from 'react-native';

import type { PlanSectionAnchor } from './sectionRule';

const targets = new Map<PlanSectionAnchor, HostInstance>();

/**
 * The callback ref a section attaches to the accessible element TalkBack
 * should land on when Plan scrolls to `anchor`.
 */
export function usePlanFocusTarget(anchor: PlanSectionAnchor): (node: HostInstance | null) => () => void {
  return useCallback(
    (node: HostInstance | null) => {
      if (node) targets.set(anchor, node);
      return () => {
        if (node && targets.get(anchor) === node) targets.delete(anchor);
      };
    },
    [anchor],
  );
}

/** The element registered for `anchor`, if one is mounted. */
export function planFocusTarget(anchor: PlanSectionAnchor): HostInstance | null {
  return targets.get(anchor) ?? null;
}

/**
 * Moves TalkBack onto `anchor`'s element, through the renderer's host
 * instance (`sendAccessibilityEvent`), the path that works under the new
 * architecture; the tag-based `setAccessibilityFocus` is the legacy one.
 * False when no section registered an element: there is nothing to land on.
 */
export function focusPlanTarget(anchor: PlanSectionAnchor): boolean {
  const target = targets.get(anchor);
  if (!target) return false;
  AccessibilityInfo.sendAccessibilityEvent(target, 'focus');
  return true;
}

/** Tests: nothing registered. */
export function resetPlanFocusTargetsForTests(): void {
  targets.clear();
}
