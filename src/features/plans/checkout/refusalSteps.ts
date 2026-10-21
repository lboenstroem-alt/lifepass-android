/**
 * Which next step a purchase refusal offers on Plans: iOS
 * `PlansView.offersRefusalStep` (2.5.5 "Plans keeps the step").
 *
 * Manage or Resume membership (Account), Cancel deletion (the deletion
 * sheet) and Contact support are buttons on the "Payment issue" alert. "See
 * plans" is this screen, and a checkout only ever starts from its payment
 * sheet (the mandate comes first), so neither it nor "Try again" is offered
 * here; a step the app cannot take at all never is either.
 */
import type { RefusalCta } from '../../../api';
import { presentsRefusalStep } from '../../../navigation/refusalSteps';

export function plansOffersRefusalStep(cta: RefusalCta): boolean {
  switch (cta) {
    case 'seePlans':
    case 'tryAgain':
      return false;
    default:
      return presentsRefusalStep(cta, null);
  }
}
