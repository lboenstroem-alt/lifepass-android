/**
 * The member's profile, `GET /profile`, and the language write
 * `POST /profile/locale`: the Android port of iOS `Profile`
 * (Models/Profile.swift), the profile half of `ProfileHealthBlock`
 * (Models/HealthModels.swift), `ProfileCoachBlock` (Models/CoachPlan.swift)
 * and `ProfileService`.
 *
 * WHAT IS STRICT AND WHAT IS FAIL-SOFT, exactly as the Swift decoder has it:
 *
 * - Identity (`id`, `kennitalaVerified`, `marketingConsent`, and the optional
 *   `email`, `fullName`, `nationality`, `locale`, `createdAt`) and the
 *   `usage` block are read strictly: a wrong type there fails the whole read,
 *   and `loadProfile` keeps the profile it had (iOS `AppState.loadProfile`).
 *   A missing or null optional member is simply absent.
 * - `recentCheckIn`, `health`, `coach` and `support` are FAIL-SOFT. The app carries scar
 *   tissue here: one required key that changed shape once failed the whole
 *   profile decode and blanked the member's name, language and caps
 *   app-wide. These three are the newest and least important blocks on the
 *   response (the health block is assembled from seven serial reads on the
 *   server), so an unreadable one is DISCARDED (null) and the member keeps
 *   their identity. Inside each block the members are read strictly, except
 *   where iOS softens one on its own (`health.features`, every member of the
 *   coach block, `recentCheckIn.memberShortName`).
 * - Every enum reads an unknown server value as `'unknown'` instead of
 *   failing: the server ships new kinds before this build is off every phone.
 *
 * Ids are kept lower case (`wireId`), so the profile's id and the Supabase
 * session's user id name the same member the same way (iOS compares UUIDs).
 */
import { API_TIMEOUTS, apiGet, apiPost } from './client';
import { decodeCoachFreeMessages, decodeCoachUpgrade, type CoachFreeMessages, type CoachUpgrade } from './errors';
import { parseIsoDate, wireId } from './wire';

import type { Lang } from '../i18n';

// ---------------------------------------------------------------------------
// Types

/** `{ used, cap }` for a monthly or daily lane; `resetsAt` is absent on `daily`. */
export interface UsageLane {
  readonly used: number;
  readonly cap: number;
  readonly resetsAt: Date | null;
}

/** One active visitor pass, in the order the door redeems them. */
export interface ActivePass {
  readonly id: string;
  /** `day` | `explorer` | `adventurer` | `local` | `lagoon_duo`; kept as a string. */
  readonly type: string;
  readonly visitsLeft: number;
  readonly expiresAt: Date;
}

/**
 * What the member can do right now: tier caps, usage, active passes, top-up
 * prices and the strike block. The lanes are null for a tier-less member (a
 * pass holder, no plan, or a membership in dunning).
 */
export interface Usage {
  /** `base` | `plus` | `max`, or null with no subscription. A string so a new tier never fails the read. */
  readonly tier: string | null;
  /** Monthly gym and studio allowance. */
  readonly network: UsageLane | null;
  /** Monthly pool allowance. */
  readonly pools: UsageLane | null;
  /** Network visits today against the daily cap. */
  readonly daily: UsageLane | null;
  /** Open bookings against the concurrent cap (null cap for a non-subscriber). */
  readonly concurrent: { readonly open: number; readonly cap: number | null };
  /** `available` once a monthly cap is hit, so the next visit is a top-up. */
  readonly topup: {
    readonly available: boolean;
    readonly prices: { readonly gym: number | null; readonly studio: number | null; readonly pool: number | null };
  };
  readonly passes: readonly ActivePass[];
  /** Set while the member is under a strike booking-block. */
  readonly block: { readonly until: Date | null };
  readonly strikes: { readonly active: number; readonly threshold: number };
}

/** Who came along on a walk-in. Decoded, never shown (owner decision D6). */
export interface CheckInParty {
  readonly adults: number;
  readonly children: number;
  readonly infants: number;
  readonly guestChargeIsk: number;
}

/**
 * The member's proof that they just checked in: a RECEIPT, not a credential.
 * The server decides the window and stops sending it once it lapses, so the
 * app keeps no timer of its own.
 *
 * The full `memberName` the server still sends (for shipped clients) is
 * checked but never kept: the app shows only `memberShortName` ("Lucas B."),
 * shortened once, server-side.
 */
export interface RecentCheckIn {
  readonly checkInId: string;
  readonly checkedInAt: Date;
  /** The short name, or null when the server sent none, null, blank or something unreadable. */
  readonly memberShortName: string | null;
  readonly venue: { readonly id: string; readonly name: string };
  /** The booked class, when the check-in adopted a booking; null for a walk-in. */
  readonly activity: { readonly id: string; readonly name: string } | null;
  readonly party: CheckInParty | null;
}

/** Last six of the check-in id, upper-cased: the short code the web proof shows too. */
export function checkInConfirmationCode(checkIn: Pick<RecentCheckIn, 'checkInId'>): string {
  return checkIn.checkInId.slice(-6).toUpperCase();
}

/**
 * The client's single health access signal. The server decides it; the app
 * never recomputes it from a subscription (see `resolveHealthAccess`).
 */
export type HealthAccess =
  | 'entitled'
  | 'past_due'
  | 'pass_only'
  | 'company_inactive'
  | 'not_member'
  | 'minor'
  | 'unknown';

export const HEALTH_ACCESS_VALUES: readonly HealthAccess[] = [
  'entitled',
  'past_due',
  'pass_only',
  'company_inactive',
  'not_member',
  'minor',
];

export type SessionKind = 'strength' | 'cardio' | 'swim' | 'mobility' | 'hike' | 'walk' | 'class' | 'rest' | 'unknown';

export const SESSION_KINDS: readonly SessionKind[] = ['strength', 'cardio', 'swim', 'mobility', 'hike', 'walk', 'class', 'rest'];

export type SessionStatusView = 'planned' | 'done' | 'skipped' | 'missed' | 'rest' | 'unknown';

export const SESSION_STATUSES: readonly SessionStatusView[] = ['planned', 'done', 'skipped', 'missed', 'rest'];

export type ProgramStatus = 'proposed' | 'active' | 'paused' | 'completed' | 'abandoned' | 'discarded' | 'unknown';

export const PROGRAM_STATUSES: readonly ProgramStatus[] = [
  'proposed',
  'active',
  'paused',
  'completed',
  'abandoned',
  'discarded',
];

/** Active or paused: a plan the member still owns. */
export function isLiveProgramStatus(status: ProgramStatus | null | undefined): boolean {
  return status === 'active' || status === 'paused';
}

/** A standing health consent. */
export interface HealthConsent {
  readonly version: string | null;
  readonly consentedAt: Date | null;
  /** `kennitala` or `attestation`. */
  readonly ageSource: string | null;
}

/**
 * The wearable connection the profile reports (`appleHealth` on the wire;
 * Android ships no Health Connect, so nothing reads it yet). Both shapes the
 * server answers with are kept: `connected` on the profile, `status` on the
 * connect and disconnect answers.
 */
export interface WearableConnection {
  readonly connected: boolean | null;
  readonly lastSyncedAt: Date | null;
  readonly status: string | null;
  readonly connectedAt: Date | null;
}

export function isWearableConnected(connection: WearableConnection | null | undefined): boolean {
  return connection?.connected === true || connection?.status === 'connected';
}

export interface ProfileTodaySession {
  readonly sessionId: string;
  readonly kind: SessionKind | null;
  readonly title: string | null;
  readonly minutes: number | null;
  readonly status: SessionStatusView | null;
  readonly bookingId: string | null;
  readonly hasBooking: boolean | null;
  readonly bookingTitle: string | null;
  readonly bookingStartsAt: Date | null;
  /** Today's plan moved under the member (a row with `movedFrom = today` now sits elsewhere). */
  readonly movedAway: boolean | null;
}

export interface ProfileProgramSummary {
  readonly id: string;
  /** Effective: an active programme past its end date reads `completed`. */
  readonly status: ProgramStatus | null;
  readonly weekNo: number | null;
  readonly weeks: number | null;
  readonly summaryTitle: string | null;
  readonly today: ProfileTodaySession | null;
}

/**
 * The `health` block on `GET /profile`. `access` is optional although the
 * contract calls it always present: the data layer shipped this block before
 * `access` existed, and refusing a profile over one new key is worse than
 * falling back (`resolveHealthAccess`).
 */
export interface ProfileHealthBlock {
  readonly access: HealthAccess | null;
  readonly consent: HealthConsent | null;
  /** The membership trial is on and this account may start it. Not health data. */
  readonly trialEligible: boolean | null;
  readonly latest: {
    readonly weightKg: number | null;
    readonly heightCm: number | null;
    readonly measuredAt: Date | null;
  } | null;
  readonly weighInDue: boolean | null;
  readonly program: ProfileProgramSummary | null;
  readonly proposalId: string | null;
  readonly appleHealth: WearableConnection | null;
  /**
   * What this server supports beyond the 2026-09-v1 contract (`target_weight`,
   * `plan_revision`, `health_feedback`, `meal_describe`). Not health data, so
   * it survives a withdrawal. Null (absent) on a server that predates it,
   * which hides those features. FAIL-SOFT on its own: the newest key on the
   * block never costs the member the block.
   */
  readonly features: readonly string[] | null;
}

/** Which Coach allowance an account has. */
export type CoachTier = 'member' | 'pass_holder' | 'free' | 'unknown';

/** The `coach` block: the tier, and for a free account what is left and where the membership button goes. */
export interface ProfileCoachBlock {
  readonly tier: CoachTier | null;
  readonly freeMessages: CoachFreeMessages | null;
  readonly upgrade: CoachUpgrade | null;
}

export interface Profile {
  /** The auth user id (`profiles.id`), lower case. */
  readonly id: string;
  readonly email: string | null;
  readonly fullName: string | null;
  /** ISO 3166-1 alpha-2 (upper case), or null when unset. */
  readonly nationality: string | null;
  /**
   * `profiles.locale` as the server holds it (iOS exposes it as `language`).
   * Null for a brand-new account until someone sets it: `loadProfile` then
   * records the language the screens have been speaking.
   */
  readonly locale: string | null;
  readonly kennitalaVerified: boolean;
  readonly marketingConsent: boolean;
  /** Scopes the sign-up nudges to fresh accounts. */
  readonly createdAt: Date | null;
  /** Null when the server omits it; the caps UI degrades, the member does not. */
  readonly usage: Usage | null;
  readonly recentCheckIn: RecentCheckIn | null;
  readonly health: ProfileHealthBlock | null;
  readonly coach: ProfileCoachBlock | null;
  /**
   * `support.whatsapp` (API 0.39.0): the WhatsApp support chat, or null while
   * WhatsApp support is switched off, on a server older than 0.39.0, or when
   * the block cannot be read (iOS `Profile.whatsAppSupport`). The Account
   * screen shows its row only while this is set.
   */
  readonly whatsAppSupport: WhatsAppSupport | null;
}

/** The WhatsApp support chat, answered by LifePass in the WhatsApp Business app (iOS `WhatsAppSupport`). */
export interface WhatsAppSupport {
  /** The full international number in digits, no "+" (`3545551234`). */
  readonly number: string;
  /** `https://wa.me/<number>`, with no message. */
  readonly url: string;
}

// ---------------------------------------------------------------------------
// Decoding

type Json = Record<string, unknown>;

/** A shape the strict decoder refuses. Thrown inside this module; the API client turns it into `DecodingError`. */
export class ProfileShapeError extends Error {
  constructor(readonly path: string) {
    super(`unexpected shape at ${path}`);
    this.name = 'ProfileShapeError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function absent(value: unknown): boolean {
  return value === undefined || value === null;
}

function object(value: unknown, path: string): Json {
  if (!isObject(value)) throw new ProfileShapeError(path);
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new ProfileShapeError(path);
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new ProfileShapeError(path);
  return value;
}

function integer(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new ProfileShapeError(path);
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ProfileShapeError(path);
  return value;
}

/** An instant as the API writes it; anything else fails (iOS `APIClient.makeDecoder`). */
function date(value: unknown, path: string): Date {
  const parsed = parseIsoDate(string(value, path));
  if (!parsed) throw new ProfileShapeError(path);
  return parsed;
}

/** A UUID in any case, kept lower case. */
function uuid(value: unknown, path: string): string {
  const raw = string(value, path);
  if (!UUID.test(raw)) throw new ProfileShapeError(path);
  return wireId(raw);
}

/** Swift's `decodeIfPresent`: absent or null is null, anything else must read. */
function optional<T>(value: unknown, path: string, read: (value: unknown, path: string) => T): T | null {
  return absent(value) ? null : read(value, path);
}

/** `FailSoft<T>`: absent, null or unreadable is null; the enclosing object survives. */
function failSoft<T>(value: unknown, read: (value: unknown) => T): T | null {
  if (absent(value)) return null;
  try {
    return read(value);
  } catch {
    return null;
  }
}

/** A forward-compatible enum: a known value, else `'unknown'`. Not a string fails, as in Swift. */
function enumValue<T extends string>(known: readonly T[], value: unknown, path: string): T | 'unknown' {
  const raw = string(value, path);
  return (known as readonly string[]).includes(raw) ? (raw as T) : 'unknown';
}

function decodeLane(value: unknown, path: string): UsageLane {
  const lane = object(value, path);
  return {
    used: integer(lane.used, `${path}.used`),
    cap: integer(lane.cap, `${path}.cap`),
    resetsAt: optional(lane.resetsAt, `${path}.resetsAt`, date),
  };
}

function decodeActivePass(value: unknown, path: string): ActivePass {
  const pass = object(value, path);
  return {
    id: uuid(pass.id, `${path}.id`),
    type: string(pass.type, `${path}.type`),
    visitsLeft: integer(pass.visitsLeft, `${path}.visitsLeft`),
    expiresAt: date(pass.expiresAt, `${path}.expiresAt`),
  };
}

/** The `usage` block, read strictly (iOS `Usage`). */
export function decodeUsage(value: unknown, path = 'usage'): Usage {
  const usage = object(value, path);
  const concurrent = object(usage.concurrent, `${path}.concurrent`);
  const topup = object(usage.topup, `${path}.topup`);
  const prices = object(topup.prices, `${path}.topup.prices`);
  const block = object(usage.block, `${path}.block`);
  const strikes = object(usage.strikes, `${path}.strikes`);
  if (!Array.isArray(usage.passes)) throw new ProfileShapeError(`${path}.passes`);
  return {
    tier: optional(usage.tier, `${path}.tier`, string),
    network: optional(usage.network, `${path}.network`, decodeLane),
    pools: optional(usage.pools, `${path}.pools`, decodeLane),
    daily: optional(usage.daily, `${path}.daily`, decodeLane),
    concurrent: {
      open: integer(concurrent.open, `${path}.concurrent.open`),
      cap: optional(concurrent.cap, `${path}.concurrent.cap`, integer),
    },
    topup: {
      available: boolean(topup.available, `${path}.topup.available`),
      prices: {
        gym: optional(prices.gym, `${path}.topup.prices.gym`, integer),
        studio: optional(prices.studio, `${path}.topup.prices.studio`, integer),
        pool: optional(prices.pool, `${path}.topup.prices.pool`, integer),
      },
    },
    passes: usage.passes.map((pass, index) => decodeActivePass(pass, `${path}.passes[${index}]`)),
    block: { until: optional(block.until, `${path}.block.until`, date) },
    strikes: {
      active: integer(strikes.active, `${path}.strikes.active`),
      threshold: integer(strikes.threshold, `${path}.strikes.threshold`),
    },
  };
}

function decodeIdName(value: unknown, path: string): { id: string; name: string } {
  const item = object(value, path);
  return { id: string(item.id, `${path}.id`), name: string(item.name, `${path}.name`) };
}

/** The recent check-in, strict inside; the caller wraps it fail-soft. */
export function decodeRecentCheckIn(value: unknown): RecentCheckIn {
  const proof = object(value, 'recentCheckIn');
  // Checked, as iOS decodes it, and dropped: the app never shows the full name.
  optional(proof.memberName, 'recentCheckIn.memberName', string);
  // Fail-soft on its own inside a fail-soft block: an unreadable name costs
  // the name, never the proof a member is holding up at reception.
  const shortName = failSoft(proof.memberShortName, (raw) => string(raw, 'memberShortName'));
  const party = failSoft(proof.party, (raw) => {
    const p = object(raw, 'party');
    return {
      adults: integer(p.adults, 'party.adults'),
      children: integer(p.children, 'party.children'),
      infants: integer(p.infants, 'party.infants'),
      guestChargeIsk: integer(p.guestChargeIsk, 'party.guestChargeIsk'),
    };
  });
  return {
    checkInId: string(proof.checkInId, 'recentCheckIn.checkInId'),
    checkedInAt: date(proof.checkedInAt, 'recentCheckIn.checkedInAt'),
    memberShortName: shortName !== null && shortName.trim() !== '' ? shortName : null,
    venue: decodeIdName(proof.venue, 'recentCheckIn.venue'),
    activity: optional(proof.activity, 'recentCheckIn.activity', decodeIdName),
    party,
  };
}

function decodeConsent(value: unknown, path: string): HealthConsent {
  const consent = object(value, path);
  return {
    version: optional(consent.version, `${path}.version`, string),
    consentedAt: optional(consent.consentedAt, `${path}.consentedAt`, date),
    ageSource: optional(consent.ageSource, `${path}.ageSource`, string),
  };
}

function decodeConnection(value: unknown, path: string): WearableConnection {
  const connection = object(value, path);
  return {
    connected: optional(connection.connected, `${path}.connected`, boolean),
    lastSyncedAt: optional(connection.lastSyncedAt, `${path}.lastSyncedAt`, date),
    status: optional(connection.status, `${path}.status`, string),
    connectedAt: optional(connection.connectedAt, `${path}.connectedAt`, date),
  };
}

function decodeToday(value: unknown, path: string): ProfileTodaySession {
  const today = object(value, path);
  return {
    sessionId: string(today.sessionId, `${path}.sessionId`),
    kind: optional(today.kind, `${path}.kind`, (raw, p) => enumValue(SESSION_KINDS, raw, p)),
    title: optional(today.title, `${path}.title`, string),
    minutes: optional(today.minutes, `${path}.minutes`, integer),
    status: optional(today.status, `${path}.status`, (raw, p) => enumValue(SESSION_STATUSES, raw, p)),
    bookingId: optional(today.bookingId, `${path}.bookingId`, string),
    hasBooking: optional(today.hasBooking, `${path}.hasBooking`, boolean),
    bookingTitle: optional(today.bookingTitle, `${path}.bookingTitle`, string),
    bookingStartsAt: optional(today.bookingStartsAt, `${path}.bookingStartsAt`, date),
    movedAway: optional(today.movedAway, `${path}.movedAway`, boolean),
  };
}

function decodeProgram(value: unknown, path: string): ProfileProgramSummary {
  const program = object(value, path);
  return {
    id: string(program.id, `${path}.id`),
    status: optional(program.status, `${path}.status`, (raw, p) => enumValue(PROGRAM_STATUSES, raw, p)),
    weekNo: optional(program.weekNo, `${path}.weekNo`, integer),
    weeks: optional(program.weeks, `${path}.weeks`, integer),
    summaryTitle: optional(program.summaryTitle, `${path}.summaryTitle`, string),
    today: optional(program.today, `${path}.today`, decodeToday),
  };
}

/** The `features` list, or null when it is missing or not a list of strings. */
function decodeFeatures(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return null;
  return value as string[];
}

/** The health block, strict inside except `features`; the caller wraps it fail-soft. */
export function decodeProfileHealthBlock(value: unknown): ProfileHealthBlock {
  const path = 'health';
  const block = object(value, path);
  return {
    access: optional(block.access, `${path}.access`, (raw, p) => enumValue(HEALTH_ACCESS_VALUES, raw, p)),
    consent: optional(block.consent, `${path}.consent`, decodeConsent),
    trialEligible: optional(block.trialEligible, `${path}.trialEligible`, boolean),
    latest: optional(block.latest, `${path}.latest`, (raw, p) => {
      const latest = object(raw, p);
      return {
        weightKg: optional(latest.weightKg, `${p}.weightKg`, finite),
        heightCm: optional(latest.heightCm, `${p}.heightCm`, integer),
        measuredAt: optional(latest.measuredAt, `${p}.measuredAt`, date),
      };
    }),
    weighInDue: optional(block.weighInDue, `${path}.weighInDue`, boolean),
    program: optional(block.program, `${path}.program`, decodeProgram),
    proposalId: optional(block.proposalId, `${path}.proposalId`, string),
    appleHealth: optional(block.appleHealth, `${path}.appleHealth`, decodeConnection),
    features: decodeFeatures(block.features),
  };
}

const COACH_TIERS: readonly CoachTier[] = ['member', 'pass_holder', 'free'];

/** The coach block: every member fail-soft on its own (iOS `ProfileCoachBlock.init(from:)`). */
export function decodeProfileCoachBlock(value: unknown): ProfileCoachBlock {
  const block = object(value, 'coach');
  return {
    tier: failSoft(block.tier, (raw) => enumValue(COACH_TIERS, raw, 'coach.tier')),
    freeMessages: decodeCoachFreeMessages(block.freeMessages) ?? null,
    upgrade: decodeCoachUpgrade(block.upgrade) ?? null,
  };
}

/**
 * The `support` block (API 0.39.0): its WhatsApp chat, or null when the
 * server sends `whatsapp: null` (switched off). Read strictly inside; the
 * profile reads the block fail-soft, so anything unreadable is "no chat".
 */
export function decodeProfileSupport(value: unknown): WhatsAppSupport | null {
  const support = object(value, 'support');
  if (absent(support.whatsapp)) return null;
  const chat = object(support.whatsapp, 'support.whatsapp');
  return {
    number: string(chat.number, 'support.whatsapp.number'),
    url: string(chat.url, 'support.whatsapp.url'),
  };
}

/**
 * `GET /profile`'s `data`. Throws `ProfileShapeError` when the identity or the
 * usage block cannot be read; the newer blocks never fail it.
 */
export function decodeProfile(data: unknown): Profile {
  const profile = object(data, 'profile');
  return {
    id: uuid(profile.id, 'id'),
    email: optional(profile.email, 'email', string),
    fullName: optional(profile.fullName, 'fullName', string),
    nationality: optional(profile.nationality, 'nationality', string),
    locale: optional(profile.locale, 'locale', string),
    kennitalaVerified: boolean(profile.kennitalaVerified, 'kennitalaVerified'),
    marketingConsent: boolean(profile.marketingConsent, 'marketingConsent'),
    createdAt: optional(profile.createdAt, 'createdAt', date),
    usage: optional(profile.usage, 'usage', decodeUsage),
    recentCheckIn: failSoft(profile.recentCheckIn, decodeRecentCheckIn),
    health: failSoft(profile.health, decodeProfileHealthBlock),
    coach: failSoft(profile.coach, decodeProfileCoachBlock),
    whatsAppSupport: failSoft(profile.support, decodeProfileSupport),
  };
}

// ---------------------------------------------------------------------------
// Confirmed consent writes, applied to the profile in hand

/**
 * The block as the server has it once consent is withdrawn: every health row
 * is deleted in the same transaction, so no consent, no latest weigh-in, no
 * programme, no proposal and no wearable connection. What is NOT health data
 * stays: the access signal, the trial flag and the feature list.
 */
export function withHealthDataDeleted(block: ProfileHealthBlock): ProfileHealthBlock {
  return {
    access: block.access,
    consent: null,
    trialEligible: block.trialEligible,
    latest: null,
    weighInDue: false,
    program: null,
    proposalId: null,
    appleHealth: null,
    features: block.features,
  };
}

/** The block with a consent the server has just recorded; a fresh grant adds no data of its own. */
export function withHealthConsent(block: ProfileHealthBlock, consent: HealthConsent): ProfileHealthBlock {
  return { ...block, consent };
}

/** A block with nothing but a consent, for a profile whose block failed to read. */
export function healthBlockWithConsent(consent: HealthConsent): ProfileHealthBlock {
  return {
    access: null,
    consent,
    trialEligible: null,
    latest: null,
    weighInDue: null,
    program: null,
    proposalId: null,
    appleHealth: null,
    features: null,
  };
}

/** This profile with its health block swapped (iOS `Profile.replacingHealth`). */
export function replacingHealth(profile: Profile, block: ProfileHealthBlock | null): Profile {
  return { ...profile, health: block };
}

// ---------------------------------------------------------------------------
// Derived reads

/**
 * "No passes", one shared value. `activePasses` is read through
 * `useAppStore(selectActivePasses)`, and React's useSyncExternalStore needs
 * the same answer for the same state: a fresh `[]` per read (no profile yet,
 * no usage block) is a new snapshot every time, and React loops until it
 * aborts the screen.
 */
const NO_PASSES: readonly ActivePass[] = Object.freeze([]);

/** The member's active passes, in the order the door redeems them; empty when none (always the same empty value). */
export function activePasses(profile: Profile | null | undefined): readonly ActivePass[] {
  return profile?.usage?.passes ?? NO_PASSES;
}

// ---------------------------------------------------------------------------
// Calls

/**
 * The profile rail has shipped with a 60 second patience since iOS 2.2.0 and
 * keeps it (iOS `ProfileService.requestTimeout`): it carries identity, caps
 * and the most recent check-in, and the phone it would fail first on is a
 * member's on a bad connection. Health values ride on it, so the answer is
 * never cached (the client sends `Cache-Control: no-store` for member calls).
 */
export const PROFILE_TIMEOUT_MS = API_TIMEOUTS.profile;

/** `GET /profile`: identity, usage, and the fail-soft check-in, health and coach blocks. */
export function fetchProfile(options: { signal?: AbortSignal } = {}): Promise<Profile> {
  return apiGet<Profile>('/profile', undefined, {
    timeoutMs: PROFILE_TIMEOUT_MS,
    signal: options.signal,
    decode: decodeProfile,
  });
}

/** `POST /profile/locale`: persists the account language; answers `{ locale }`. */
export function setProfileLocale(locale: Lang): Promise<Lang> {
  return apiPost<Lang>(
    '/profile/locale',
    { locale },
    {
      timeoutMs: PROFILE_TIMEOUT_MS,
      decode: (data) => {
        const answer = object(data, 'locale');
        const value = string(answer.locale, 'locale');
        if (value !== 'en' && value !== 'is') throw new ProfileShapeError('locale');
        return value;
      },
    },
  );
}
