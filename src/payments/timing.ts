/**
 * Every wait on the money rails, in one place, with the iOS value it ports.
 *
 * Tests set them to 0 (`setPaymentTimingForTests`), as the iOS tests set
 * `payConfirmPollInterval = 0`, so a five-poll confirm runs at once.
 */
export interface PaymentTiming {
  /**
   * Between the pay-and-save-card confirm's polls on the Done leg
   * (`payConfirmPollInterval`, 2.5 s): capture can lag the redirect.
   */
  readonly payConfirmPollMs: number;
  /** Between plan checkout confirms (`PlansViewModel.handleCheckoutReturn`, 2 s, three tries). */
  readonly checkoutConfirmGapMs: number;
  /** `GET /payments/status` back-off unit: attempt n waits min(n + 1, 5) units (`PaymentService.pollPaymentStatus`). */
  readonly statusBackoffUnitMs: number;
  /** The profile re-reads that confirm a purchase (`profileConfirmsPurchase`). */
  readonly profilePollDelaysMs: readonly number[];
  /** The subscription re-reads after a co-pay checkout (`AccountView.settleActivationReturn`). */
  readonly copayPollDelaysMs: readonly number[];
  /**
   * How long a page that closed without a link waits for one that lost the
   * race (Android only: the auth-session polyfill also resolves when the app
   * comes back to the foreground, which can beat the link's own event).
   */
  readonly lateReturnGraceMs: number;
}

const DEFAULT_TIMING: PaymentTiming = Object.freeze({
  payConfirmPollMs: 2_500,
  checkoutConfirmGapMs: 2_000,
  statusBackoffUnitMs: 1_000,
  profilePollDelaysMs: Object.freeze([0, 2_000, 3_000, 3_000, 3_000, 3_000]),
  copayPollDelaysMs: Object.freeze([0, 2_000, 3_000, 3_000]),
  lateReturnGraceMs: 300,
});

let current: PaymentTiming = DEFAULT_TIMING;

/** The waits in force. */
export function paymentTiming(): PaymentTiming {
  return current;
}

/** Tests only: override some waits (0 runs every poll at once). `null` restores the defaults. */
export function setPaymentTimingForTests(overrides: Partial<PaymentTiming> | null): void {
  current = overrides ? { ...DEFAULT_TIMING, ...overrides } : DEFAULT_TIMING;
}

/** Every wait at 0, for tests. */
export const NO_WAITS: PaymentTiming = Object.freeze({
  payConfirmPollMs: 0,
  checkoutConfirmGapMs: 0,
  statusBackoffUnitMs: 0,
  profilePollDelaysMs: Object.freeze([0, 0, 0, 0, 0, 0]),
  copayPollDelaysMs: Object.freeze([0, 0, 0, 0]),
  lateReturnGraceMs: 0,
});

/** Waits `ms` (0 still yields once, so other work can run between polls). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}
