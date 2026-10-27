/**
 * Asking for a Google Play rating, rarely, after a happy moment (owner's
 * rule, 27 October 2026; docs/05 "Rating the app (App Store / Google
 * Play)"). The server only supplies the facts; the rule lives here.
 *
 * A HAPPY MOMENT is either
 * - a visit rating of 4 or 5 stars (`happyMoment: true`), asked once its
 *   thank-you has closed (src/features/visitRating), or
 * - a check-in whose answer says `lifetimeCheckIns` of 5 or more, asked when
 *   the member LEAVES the success screen: never while the proof reception
 *   reads is up (src/features/checkin/walkin reports the moment).
 *
 * THE GATES, all of them:
 * - the account was made more than 7 days ago (`GET /profile` createdAt;
 *   unknown is not old enough);
 * - this phone has not asked for this account in the last 4 months (the
 *   time is stored per account, when the system API is called);
 * - no booking, payment or check-in flow is on screen (src/app/flowsOnScreen.ts).
 *   One still up a moment after the member left the proof (the walk-in's
 *   "Processing…" while it reads the credits again) is waited out for up
 *   to `STORE_REVIEW_FLOW_WAIT_MS`; after that the moment has passed.
 *
 * THE ASK is Google Play's own in-app review card (`expo-store-review`
 * `requestReview()`, the Play In-App Review API), only where
 * `isAvailableAsync()` says the phone has it (Google Play installed). No
 * home-made "Do you like LifePass?" in front of it, and Google keeps its own
 * quota, so the card may not appear at all: the ask is recorded either way.
 * The "Rate LifePass" row in Account (src/features/account/links.ts) is
 * always there and is not an ask.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { flowOnScreen, subscribeFlowsOnScreen } from '../../app/flowsOnScreen';
import { useAppStore } from '../../stores/appStore';

/** The account must be older than this. */
export const STORE_REVIEW_MIN_ACCOUNT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** At most one ask per account on this phone in this many months. */
export const STORE_REVIEW_INTERVAL_MONTHS = 4;

/** A check-in is a happy moment from this many check-ins that stand. */
export const STORE_REVIEW_CHECK_INS = 5;

/**
 * How long a happy moment waits for a flow still on screen to end before it
 * gives up: the walk-in's "Processing…" while it reads the member's credits
 * again after Done, a payment being confirmed. Longer than that, the member
 * is busy with something else and the moment has passed.
 */
export const STORE_REVIEW_FLOW_WAIT_MS = 5_000;

/** Where the last ask for `memberId` is kept on this phone (ISO 8601). Not wiped at sign-out: it is the phone's memory of asking. */
export function lastAskedKey(memberId: string): string {
  return `storeReview.${memberId.toLowerCase()}.lastAskedAt`;
}

export type StoreReviewMoment =
  /** A 4 or 5 star visit rating's thank-you closed. */
  | { readonly kind: 'visitRating' }
  /** The member left a check-in's success screen. */
  | { readonly kind: 'checkIn'; readonly lifetimeCheckIns: number | null };

export type StoreReviewRefusal = 'notHappy' | 'unknownAccount' | 'newAccount' | 'askedRecently' | 'flowOnScreen';

export interface StoreReviewGateInput {
  readonly accountCreatedAt: Date | null;
  readonly lastAskedAt: Date | null;
  readonly flowOnScreen: boolean;
  readonly now: Date;
}

/**
 * `date` plus `months` calendar months (UTC: Reykjavík has no daylight
 * saving), the day held to the end of a shorter month: 31 October plus 4
 * months is 28 (or 29) February, never 3 March.
 */
export function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDay);
  return new Date(
    Date.UTC(
      year,
      month,
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

/** A 4 or 5 star answer, or a check-in from the fifth. Pure. */
export function isHappyMoment(moment: StoreReviewMoment): boolean {
  if (moment.kind === 'visitRating') return true;
  return moment.lifetimeCheckIns !== null && moment.lifetimeCheckIns >= STORE_REVIEW_CHECK_INS;
}

/** Why the moment may not ask now, or null when it may. Pure. */
export function storeReviewRefusal(moment: StoreReviewMoment, input: StoreReviewGateInput): StoreReviewRefusal | null {
  if (!isHappyMoment(moment)) return 'notHappy';
  const now = input.now.getTime();
  if (input.accountCreatedAt === null) return 'unknownAccount';
  if (now - input.accountCreatedAt.getTime() <= STORE_REVIEW_MIN_ACCOUNT_AGE_MS) return 'newAccount';
  if (input.lastAskedAt !== null && now < addMonths(input.lastAskedAt, STORE_REVIEW_INTERVAL_MONTHS).getTime()) {
    return 'askedRecently';
  }
  if (input.flowOnScreen) return 'flowOnScreen';
  return null;
}

// ---------------------------------------------------------------------------
// The ask

export interface StoreReviewDeps {
  /** The signed-in member (lower case), or null. */
  memberId(): string | null;
  /** `GET /profile` createdAt, or null when unknown. */
  accountCreatedAt(): Date | null;
  flowOnScreen(): boolean;
  /** Resolves true once no flow is on screen (at once when none is), false after `timeoutMs`. */
  waitForNoFlow(timeoutMs: number): Promise<boolean>;
  now(): Date;
  readLastAsked(memberId: string): Promise<Date | null>;
  recordAsked(memberId: string, at: Date): Promise<void>;
  /** Google Play's in-app review is on this phone. */
  isAvailable(): Promise<boolean>;
  /** Google Play's card (it decides whether to show it). */
  requestReview(): Promise<void>;
}

/** The native module, loaded at first use: a build without it never asks, and never crashes. */
type StoreReviewModule = {
  isAvailableAsync(): Promise<boolean>;
  requestReview(): Promise<void>;
};

function storeReviewModule(): StoreReviewModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded at first use (see above)
    return require('expo-store-review') as StoreReviewModule;
  } catch {
    return null;
  }
}

async function readLastAsked(memberId: string): Promise<Date | null> {
  try {
    const raw = await AsyncStorage.getItem(lastAskedKey(memberId));
    if (!raw) return null;
    const at = new Date(raw);
    return Number.isNaN(at.getTime()) ? null : at;
  } catch {
    // Unreadable storage reads as never asked; Google's own quota still
    // holds its card back.
    return null;
  }
}

async function recordAsked(memberId: string, at: Date): Promise<void> {
  try {
    await AsyncStorage.setItem(lastAskedKey(memberId), at.toISOString());
  } catch {
    // Kept nowhere: Google's own quota still holds the card back.
  }
}

export const defaultStoreReviewDeps: StoreReviewDeps = {
  memberId: () => {
    const { isAuthenticated, isLoading, userId, profile } = useAppStore.getState();
    if (!isAuthenticated || isLoading) return null;
    return (profile?.id ?? userId)?.toLowerCase() ?? null;
  },
  accountCreatedAt: () => useAppStore.getState().profile?.createdAt ?? null,
  flowOnScreen: () => flowOnScreen() !== null,
  waitForNoFlow: (timeoutMs) =>
    new Promise<boolean>((resolve) => {
      if (flowOnScreen() === null) {
        resolve(true);
        return;
      }
      let settled = false;
      let stop: () => void = () => undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (clear: boolean) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        stop();
        resolve(clear);
      };
      stop = subscribeFlowsOnScreen(() => {
        if (flowOnScreen() === null) finish(true);
      });
      timer = setTimeout(() => finish(false), timeoutMs);
    }),
  now: () => new Date(),
  readLastAsked,
  recordAsked,
  isAvailable: async () => {
    const module = storeReviewModule();
    if (!module) return false;
    try {
      return (await module.isAvailableAsync()) === true;
    } catch {
      return false;
    }
  },
  requestReview: async () => {
    await storeReviewModule()?.requestReview();
  },
};

let deps: StoreReviewDeps = defaultStoreReviewDeps;
let asking: Promise<boolean> | null = null;

/**
 * Asks Google Play for its review card when `moment` is a happy one and
 * every gate holds. Answers whether the system API was called. Never
 * throws; a second moment while one is being decided joins it.
 */
export function askForStoreReview(moment: StoreReviewMoment): Promise<boolean> {
  // Most check-ins are not a happy moment: nothing to decide, nothing to wait for.
  if (!isHappyMoment(moment)) return Promise.resolve(false);
  if (asking) return asking;
  const run = (async () => {
    const memberId = deps.memberId();
    if (!memberId) return false;
    // A flow still on screen (a moment after Done) is waited out, briefly.
    if (!(await deps.waitForNoFlow(STORE_REVIEW_FLOW_WAIT_MS))) return false;
    const gate = async (): Promise<StoreReviewRefusal | null> =>
      storeReviewRefusal(moment, {
        accountCreatedAt: deps.accountCreatedAt(),
        lastAskedAt: await deps.readLastAsked(memberId),
        flowOnScreen: deps.flowOnScreen(),
        now: deps.now(),
      });
    if ((await gate()) !== null) return false;
    if (!(await deps.isAvailable())) return false;
    // Read again after the waits: a booking may have opened, the member
    // signed out, or another moment asked meanwhile.
    if (deps.memberId() !== memberId || (await gate()) !== null) return false;
    // Recorded BEFORE the call, so an ask is never repeated because the
    // card failed or the app died on top of it.
    await deps.recordAsked(memberId, deps.now());
    try {
      await deps.requestReview();
    } catch {
      // Google said no (quota, no account): it was still asked.
    }
    return true;
  })()
    .catch(() => false)
    .finally(() => {
      asking = null;
    });
  asking = run;
  return run;
}

/** Tests: other dependencies (none: the app's own). */
export function setStoreReviewDepsForTests(overrides: Partial<StoreReviewDeps> | null): void {
  deps = overrides ? { ...defaultStoreReviewDeps, ...overrides } : defaultStoreReviewDeps;
  asking = null;
}
