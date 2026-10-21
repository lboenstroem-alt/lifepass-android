/**
 * The seam between the Plans screen (PLANS-1) and its checkout (PLANS-2).
 * PLANS-2 keeps these two interfaces and `usePlanCheckout`'s signature
 * (./index.ts) when it replaces the interim checkout behind them.
 */
import type { ReactNode, RefObject } from 'react';

import type { Plan } from '../plans';

/** What the checkout tells the Plans screen. */
export interface PlanCheckoutEvents {
  /**
   * The server refused the checkout until the member verifies with Kenni
   * (403/409 `kennitala_verification_required`): `plan` is the plan that was
   * SUBMITTED (the selection may have moved since), `discountCode` the code
   * typed for it. The screen parks both and opens the Kenni sheet.
   */
  readonly onKennitalaRequired: (plan: Plan, discountCode: string) => void;
  /** The purchase is confirmed and the member took the welcome's button: close Plans. */
  readonly onFinished: () => void;
  /**
   * Optional: the screen's Continue, which opens the payment sheet. TalkBack
   * focus goes back to it once the sheet has gone (closed by the member, or
   * for the page, the Kenni sheet or an alert), as VoiceOver's does when a
   * SwiftUI sheet is dismissed. Attach it to the Continue control's `ref`.
   */
  readonly returnFocusRef?: RefObject<unknown>;
}

/** What the Plans screen reads from the checkout. */
export interface PlanCheckout {
  /**
   * A checkout is being created or settled: Continue is held, and the screen
   * cannot be closed (iOS `isLoading`, `interactiveDismissDisabled`).
   */
  readonly busy: boolean;
  /** The return is being confirmed: the Continue cluster gives way to the overlay (iOS `isVerifying`). */
  readonly verifying: boolean;
  /** Drawn above the Kenni chip, e.g. "Completed your purchase? Tap to check" (iOS `verificationPending`). */
  readonly chip: ReactNode;
  /** Whatever else the checkout draws over the screen (its sheet, its overlay). */
  readonly element: ReactNode;
  /**
   * Buy `plan`, whose eID gate is already clear. `discountCode` is the code
   * typed before Kenni interrupted the purchase ('' for none), for the
   * payment sheet to put back in its box.
   */
  readonly begin: (plan: Plan, discountCode: string) => void;
}
