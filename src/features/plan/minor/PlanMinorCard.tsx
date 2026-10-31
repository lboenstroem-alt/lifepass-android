/**
 * The under-18 card on Plan (iOS `PlanMinorCard`, `ios-ux.md` 3.6.2): "For
 * members aged 18 and over" and what the member can still use, with no
 * controls. The card itself is F7's (`MinorCard`, shared with the consent
 * sheet), in the card chrome iOS gives it on Plan: two lines of loose text on
 * a blank page read as a screen that failed to load, which is the wrong
 * thing to say to the one member who is not allowed in.
 */
import { MinorCard } from '../../../health/ui';

export default function PlanMinorCard() {
  return <MinorCard variant="plan" testID="plan.minor" />;
}
