/**
 * In-flight hosted payments, saved on the phone so a payment survives Android
 * closing the app behind the payment page.
 *
 * WHY (plan F8, critic-hosted-payment-process-death). On iOS the payment page
 * is a cover inside the app and rarely outlives it, so which rail opened it
 * is held in memory (`AppState.launchedBookingPayment` and friends). On
 * Android the page is a Custom Tab, and a phone short of memory often kills
 * the app behind it. The member pays, `lifepass://payment-success` starts the
 * app from cold, and without a record nobody knows which booking, class,
 * walk-in or plan that payment was for: the member paid and sees nothing.
 *
 * So before any hosted page opens, its attempt is written here: the rail, the
 * key or Kling session the confirm needs, the amount consented to, and what
 * the outcome needs to say (the venue, the class, the plan's name). The rail
 * clears it once the server has answered for good. A record left behind is
 * resolved by ./coldStartRecovery on the next launch or return to the app.
 *
 * Kept per member (`payments.inflight.<profileId>`), as a short list: one
 * page is open at a time, but a payment still settling (`processing`) keeps
 * its record while the member goes on to pay for something else. Records
 * older than 24 hours are dropped unread (the server's own sweeps have
 * settled the money by then), and every record goes on sign-out. Nothing in
 * a record is a secret: the idempotency key and Kling's session id only
 * resolve a payment for the signed-in member who made it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { PayCopyContext } from './payOutcomeCopy';

export const INFLIGHT_KEY_PREFIX = 'payments.inflight.';

/** Records older than this are dropped without a request. */
export const INFLIGHT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The most records kept per member (the oldest go first). */
export const INFLIGHT_MAX_RECORDS = 8;

const VERSION = 1;

/** Which rail opened the page, which decides the confirm that settles it. */
export type InflightRail = 'booking' | 'walk_in' | 'plan' | 'card_setup' | 'copay';

interface InflightBase {
  readonly v: typeof VERSION;
  /** This attempt, unique on the phone. */
  readonly attemptId: string;
  /** The member who paid (lower case). */
  readonly memberId: string;
  /** When the page was about to open (ISO-8601). */
  readonly startedAt: string;
  /**
   * The recovery already showed "Confirming your payment" for it once; later
   * returns to the app check again quietly and speak only when it settles.
   */
  readonly presentedProcessing?: boolean;
}

/** What a booking's outcome needs to say and schedule. */
export interface BookingAttemptContext {
  /** `slot` or `class` (the refund wording and the confirmed line differ). */
  readonly kind: 'slot' | 'class';
  readonly activityId: string;
  readonly activityName?: string | null;
  readonly venueId?: string | null;
  readonly venueName?: string | null;
  readonly venueSlug?: string | null;
  /** The class's or slot's start (ISO-8601), for the check-in reminders. */
  readonly startsAt?: string | null;
  readonly endsAt?: string | null;
  readonly eventId?: number | null;
  readonly className?: string | null;
  readonly participants?: number | null;
}

/** The party paid for at the door, as the proof draws it (null for a solo walk-in). */
export interface WalkInParty {
  readonly adults: number;
  readonly children: number;
  readonly infants: number;
  readonly guestChargeIsk: number;
}

/** What a walk-in's outcome needs to say. */
export interface WalkInAttemptContext {
  readonly venueId: string;
  readonly venueName?: string | null;
  readonly venueSlug?: string | null;
  readonly activityId: string | null;
  readonly activityName?: string | null;
  readonly party?: WalkInParty | null;
}

/** A booking's or class's pay-and-save-card page. */
export interface BookingInflight extends InflightBase {
  readonly rail: 'booking';
  /** The booking's Idempotency-Key, which the confirm resolves the session by. */
  readonly key: string;
  readonly amountIsk: number;
  readonly booking: BookingAttemptContext;
}

/** A walk-in's pay-and-save-card page. */
export interface WalkInInflight extends InflightBase {
  readonly rail: 'walk_in';
  readonly key: string;
  readonly amountIsk: number;
  readonly walkIn: WalkInAttemptContext;
}

/** What a plan or pass checkout needs to verify the purchase from the profile. */
export interface PlanAttemptContext {
  readonly productSlug: string;
  /** The plan's name as the member saw it, for the welcome. */
  readonly planName?: string | null;
  /** Pass ids held before checkout: a pass is confirmed by a NEW one on the profile. */
  readonly prePurchasePassIds: readonly string[];
  /** The active membership's slug before checkout, or null. */
  readonly prePurchaseSubSlug: string | null;
}

/** A plan or pass checkout. */
export interface PlanInflight extends InflightBase {
  readonly rail: 'plan';
  /** Kling's session, for the verified pull. Null on the web-first fallback. */
  readonly externalSessionId: string | null;
  readonly plan: PlanAttemptContext;
}

/** The card setup page (Account's add or replace card). */
export interface CardSetupInflight extends InflightBase {
  readonly rail: 'card_setup';
}

/** A company co-pay checkout: accepting a plan, or curing a past-due share. */
export interface CopayInflight extends InflightBase {
  readonly rail: 'copay';
  readonly purpose: 'activate' | 'retry';
  readonly externalSessionId: string | null;
}

export type InflightRecord = BookingInflight | WalkInInflight | PlanInflight | CardSetupInflight | CopayInflight;

/** A record before it is stamped (`attemptId`, `startedAt`, version). */
export type NewInflightRecord =
  | Omit<BookingInflight, 'v' | 'attemptId' | 'startedAt' | 'presentedProcessing'>
  | Omit<WalkInInflight, 'v' | 'attemptId' | 'startedAt' | 'presentedProcessing'>
  | Omit<PlanInflight, 'v' | 'attemptId' | 'startedAt' | 'presentedProcessing'>
  | Omit<CardSetupInflight, 'v' | 'attemptId' | 'startedAt' | 'presentedProcessing'>
  | Omit<CopayInflight, 'v' | 'attemptId' | 'startedAt' | 'presentedProcessing'>;

/** The page family a rail's page returns on. */
export function railFamily(rail: InflightRail): 'payment' | 'cardSetup' {
  return rail === 'card_setup' ? 'cardSetup' : 'payment';
}

/** The words a booking or walk-in record's outcome uses. */
export function payCopyContext(record: BookingInflight | WalkInInflight): PayCopyContext {
  if (record.rail === 'walk_in') return 'walkIn';
  return record.booking.kind === 'class' ? 'class' : 'slot';
}

/**
 * The payment a record is: the action's Idempotency-Key (a booking, a
 * walk-in) or Kling's session (a plan, a co-pay). The server resolves a
 * payment by it, so two records with one identity are ONE attempt: a retry
 * under the same key reopens the same session, and its record replaces the
 * earlier one rather than standing beside it (two records for one key would
 * each be settled, and the member told the outcome twice). Null for a card
 * setup and a session-less checkout (the web-first fallback), which nothing
 * can open twice.
 */
export function attemptIdentity(record: InflightRecord | NewInflightRecord): string | null {
  switch (record.rail) {
    case 'booking':
    case 'walk_in':
      return `${record.rail}:${record.key}`;
    case 'plan':
    case 'copay':
      return record.externalSessionId ? `${record.rail}:${record.externalSessionId.toLowerCase()}` : null;
    case 'card_setup':
      return null;
  }
}

/** A start instant in one spelling (`…:00Z` and `…:00.000Z` are the same class). */
function instant(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * What the member was paying for, whatever the key: the same class (by its
 * event) or slot (by its start) of one activity, a walk-in at one venue (the
 * server holds one unresolved door payment per venue: `payment_unresolved`),
 * or one plan or pass. A new attempt at an action whose earlier attempt is
 * still unresolved must not start under a new key (./attempts). Null where
 * no such rule applies (card setup, co-pay).
 */
export function attemptAction(record: InflightRecord | NewInflightRecord): string | null {
  switch (record.rail) {
    case 'booking': {
      const { activityId, eventId, startsAt } = record.booking;
      const at = eventId != null ? `event:${eventId}` : instant(startsAt);
      return at ? `booking|${activityId.toLowerCase()}|${at}` : null;
    }
    case 'walk_in':
      return `walk_in|${record.walkIn.venueId.toLowerCase()}`;
    case 'plan':
      return `plan|${record.plan.productSlug}`;
    case 'card_setup':
    case 'copay':
      return null;
  }
}

// ---------------------------------------------------------------------------
// Storage

export function inflightStorageKey(memberId: string): string {
  return `${INFLIGHT_KEY_PREFIX}${memberId.toLowerCase()}`;
}

let attemptCounter = 0;

/** A new attempt id: unique on this phone, never reused across launches. */
export function newAttemptId(now: number = Date.now()): string {
  attemptCounter = (attemptCounter + 1) % 1_000_000;
  return `${now.toString(36)}-${attemptCounter.toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** A stored record, checked (a malformed or foreign one reads as null and is dropped). */
function readRecord(value: unknown, memberId: string): InflightRecord | null {
  if (!isObject(value) || value.v !== VERSION) return null;
  if (!isString(value.attemptId) || !isString(value.startedAt) || value.memberId !== memberId) return null;
  if (!Number.isFinite(Date.parse(value.startedAt))) return null;
  switch (value.rail) {
    case 'booking':
      return isString(value.key) && Number.isInteger(value.amountIsk) && isObject(value.booking) &&
        (value.booking.kind === 'slot' || value.booking.kind === 'class') && isString(value.booking.activityId)
        ? (value as unknown as BookingInflight)
        : null;
    case 'walk_in':
      return isString(value.key) && Number.isInteger(value.amountIsk) && isObject(value.walkIn) &&
        isString(value.walkIn.venueId)
        ? (value as unknown as WalkInInflight)
        : null;
    case 'plan':
      return isObject(value.plan) && isString(value.plan.productSlug) && Array.isArray(value.plan.prePurchasePassIds)
        ? (value as unknown as PlanInflight)
        : null;
    case 'card_setup':
      return value as unknown as CardSetupInflight;
    case 'copay':
      return value.purpose === 'activate' || value.purpose === 'retry' ? (value as unknown as CopayInflight) : null;
    default:
      return null;
  }
}

function fresh(record: InflightRecord, now: number): boolean {
  const started = Date.parse(record.startedAt);
  // A clock that moved backwards keeps the record; one older than a day goes.
  return now - started < INFLIGHT_MAX_AGE_MS;
}

/** Writes serialised per member, so two rails finishing together never lose each other's change. */
const queues = new Map<string, Promise<unknown>>();

function serialised<T>(memberId: string, work: () => Promise<T>): Promise<T> {
  const key = inflightStorageKey(memberId);
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(work, work);
  const tail = next.catch(() => undefined);
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return next;
}

async function load(memberId: string, now: number): Promise<{ records: InflightRecord[]; dirty: boolean }> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(inflightStorageKey(memberId));
  } catch {
    return { records: [], dirty: false };
  }
  if (raw === null) return { records: [], dirty: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { records: [], dirty: true };
  }
  const list = Array.isArray(parsed) ? parsed : [];
  const readable: InflightRecord[] = [];
  for (const item of list) {
    const record = readRecord(item, memberId.toLowerCase());
    if (record && fresh(record, now)) readable.push(record);
  }
  // One record per payment (see `attemptIdentity`): the newest wins.
  const seen = new Set<string>();
  const records = readable
    .reverse()
    .filter((record) => {
      const identity = attemptIdentity(record);
      if (identity === null) return true;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .reverse();
  return { records, dirty: records.length !== list.length || !Array.isArray(parsed) };
}

async function store(memberId: string, records: readonly InflightRecord[]): Promise<void> {
  const key = inflightStorageKey(memberId);
  try {
    if (records.length === 0) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, JSON.stringify(records));
  } catch {
    // Storage failing must never stop a payment: the live flow still settles
    // it; only the recovery after process death is lost.
  }
}

/**
 * Saves a new attempt before its page opens and returns it, stamped. A saved
 * record of the same payment (`attemptIdentity`: a retry under the same key,
 * the same Kling session) is REPLACED, never kept beside it: it is one
 * payment, settled once. The new record starts afresh (`presentedProcessing`
 * unset): the member has just been on the page again and is waiting for
 * this answer. The oldest records go when there are more than
 * `INFLIGHT_MAX_RECORDS`.
 */
export function saveInflight(record: NewInflightRecord, now: number = Date.now()): Promise<InflightRecord> {
  const memberId = record.memberId.toLowerCase();
  const stamped = {
    ...record,
    memberId,
    v: VERSION,
    attemptId: newAttemptId(now),
    startedAt: new Date(now).toISOString(),
  } as InflightRecord;
  const identity = attemptIdentity(stamped);
  return serialised(memberId, async () => {
    const { records } = await load(memberId, now);
    const others = identity === null ? records : records.filter((saved) => attemptIdentity(saved) !== identity);
    const next = [...others, stamped].slice(-INFLIGHT_MAX_RECORDS);
    await store(memberId, next);
    return stamped;
  });
}

/**
 * The member's unresolved attempts, oldest first. Records past 24 hours, and
 * any that do not read, are removed on the way.
 */
export function readInflight(memberId: string, now: number = Date.now()): Promise<InflightRecord[]> {
  const id = memberId.toLowerCase();
  return serialised(id, async () => {
    const { records, dirty } = await load(id, now);
    if (dirty) await store(id, records);
    return records;
  });
}

/** Removes one attempt (its rail has the server's final answer). Others are untouched. */
export function clearInflight(memberId: string, attemptId: string): Promise<void> {
  const id = memberId.toLowerCase();
  return serialised(id, async () => {
    const { records } = await load(id, Date.now());
    const next = records.filter((record) => record.attemptId !== attemptId);
    await store(id, next);
  });
}

/** Changes one attempt in place (e.g. marks "Confirming your payment" as shown). */
export function updateInflight(
  memberId: string,
  attemptId: string,
  change: (record: InflightRecord) => InflightRecord,
): Promise<void> {
  const id = memberId.toLowerCase();
  return serialised(id, async () => {
    const { records } = await load(id, Date.now());
    const next = records.map((record) => (record.attemptId === attemptId ? change(record) : record));
    await store(id, next);
  });
}

/**
 * Sign-out: every in-flight record on the phone goes, the leaving member's
 * and any left over from an earlier member, so nothing of one member's
 * payments can surface for the next person to sign in.
 */
export async function wipeInflight(): Promise<void> {
  let keys: readonly string[] = [];
  try {
    keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(INFLIGHT_KEY_PREFIX));
  } catch {
    return;
  }
  if (keys.length === 0) return;
  try {
    await AsyncStorage.multiRemove(keys);
  } catch {
    // Nothing more can be done; the 24-hour rule drops them anyway.
  }
}

// ---------------------------------------------------------------------------
// Live attempts

/**
 * Attempts an owner in this process holds, by id: a flow (its page open, its
 * confirm running, or its screen holding a payment still settling for Check
 * again) or the recovery. The recovery leaves these alone: a record is
 * resolved by exactly one owner.
 *
 * `active` is a page open or a confirm running; `held` is a screen keeping a
 * settled-for-now attempt (no page, nothing running), which neither blocks a
 * new page nor owns an incoming return link.
 */
export type AttemptOwner = 'flow' | 'recovery';

interface LiveAttempt {
  readonly family: 'payment' | 'cardSetup';
  readonly owner: AttemptOwner;
  phase: 'active' | 'held';
  /** While a screen holds it: the record its Check again settles. */
  record?: InflightRecord;
  /** While a screen holds it: whether that screen is still there (see `releaseAbandonedHolds`). */
  isScreenAlive?: () => boolean;
}

const live = new Map<string, LiveAttempt>();

/** Claims `attemptId` for one owner. False when someone else already holds it. */
export function claimAttempt(
  attemptId: string,
  family: 'payment' | 'cardSetup',
  owner: AttemptOwner = 'flow',
): boolean {
  if (live.has(attemptId)) return false;
  live.set(attemptId, { family, owner, phase: 'active' });
  return true;
}

/**
 * The owner keeps `attemptId` with nothing running (a screen offering Check
 * again), with the record that Check again settles and, when the screen gave
 * one, the test of whether it is still there.
 */
export function holdAttempt(
  attemptId: string,
  hold: { readonly record?: InflightRecord; readonly isScreenAlive?: () => boolean } = {},
): void {
  const entry = live.get(attemptId);
  if (!entry) return;
  entry.phase = 'held';
  entry.record = hold.record;
  entry.isScreenAlive = hold.isScreenAlive;
}

/** The record a screen holds under `attemptId` (null when no screen holds it). */
export function heldRecord(attemptId: string): InflightRecord | null {
  const entry = live.get(attemptId);
  return entry && entry.phase === 'held' && entry.owner === 'flow' ? (entry.record ?? null) : null;
}

/** The owner runs `attemptId` again (Check again). */
export function resumeAttempt(attemptId: string): void {
  const entry = live.get(attemptId);
  if (!entry) return;
  entry.phase = 'active';
  entry.record = undefined;
  entry.isScreenAlive = undefined;
}

/** Lets go of `attemptId` (its record, if still saved, is the recovery's again). */
export function releaseAttempt(attemptId: string): void {
  live.delete(attemptId);
}

/** True while an owner in this process holds `attemptId`. */
export function isAttemptLive(attemptId: string): boolean {
  return live.has(attemptId);
}

/** Who holds `attemptId` here, and how, or null. */
export function attemptState(attemptId: string): { readonly owner: AttemptOwner; readonly phase: 'active' | 'held' } | null {
  const entry = live.get(attemptId);
  return entry ? { owner: entry.owner, phase: entry.phase } : null;
}

/**
 * Lets go of every attempt a screen held for Check again whose screen is
 * gone (a navigation reset, a sheet that crashed, a consumer that never
 * called `leaveAttempt`). Without this such an attempt stayed "live" for the
 * life of the process, and the recovery skipped it on every return to the
 * app, so a payment that settled later was never told. Returns the
 * attempts let go; the recovery settles them like any other record.
 */
export function releaseAbandonedHolds(): string[] {
  const released: string[] = [];
  for (const [attemptId, entry] of live) {
    if (entry.phase !== 'held' || entry.owner !== 'flow' || !entry.isScreenAlive) continue;
    let alive = true;
    try {
      alive = entry.isScreenAlive();
    } catch {
      alive = false;
    }
    if (!alive) {
      live.delete(attemptId);
      released.push(attemptId);
    }
  }
  return released;
}

/**
 * True while an attempt has its page open or its confirm running here (of
 * `family`, and by `owner`, when given).
 */
export function hasLiveAttempt(family?: 'payment' | 'cardSetup', owner?: AttemptOwner): boolean {
  for (const entry of live.values()) {
    if (entry.phase !== 'active') continue;
    if (family !== undefined && entry.family !== family) continue;
    if (owner !== undefined && entry.owner !== owner) continue;
    return true;
  }
  return false;
}

/** Tests only: forget the live attempts and queued writes (as a process death would). */
export function resetInflightMemoryForTests(): void {
  live.clear();
  queues.clear();
}
