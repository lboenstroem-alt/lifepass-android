/**
 * Development-only: stand the app up signed in, in a known state, for device
 * checks and screenshots of screens that are behind a sign-in. The Android
 * twin of iOS `ScreenshotFixtures.apply(to:)` (App/ScreenshotFixtures.swift),
 * driven by `EXPO_PUBLIC_FIXTURE` (src/dev/fixtures.ts):
 *
 *   EXPO_PUBLIC_FIXTURE="state=pass-holder,language=is" npx expo start
 *
 * `state`: `active-plan`, `entitled-no-plan`, `not-member`, `minor` or
 * `pass-holder`. `language`: the ACCOUNT language (`en` default, or `is`).
 * `unverified`: the member has not verified with Kenni. `recentCheckIn`: a
 * check-in proof from the profile. `offersCard`: Home's "Get offers by email"
 * card, as the server would offer it (`open`, `fails-once`, `opted-in`,
 * `dismissed`; src/features/home/offersCard/fixtures.ts).
 *
 * The screens under it are the real ones, rendering the real models through
 * the real decoder. What is faked is the session, and only the session.
 *
 * SAFETY. `fixtureArgs()` is empty unless `__DEV__`, so a release bundle can
 * never enter a fixture state, and a fixture grants nothing: without a real
 * bearer token every server call still fails, exactly as for a signed-out
 * person, so it cannot be used to see anyone's data.
 */
import { decodeProfile, type Profile } from '../api/profile';
import { fixtureArgs } from './fixtures';

export const FIXTURE_STATES = ['active-plan', 'entitled-no-plan', 'not-member', 'minor', 'pass-holder'] as const;

export type FixtureState = (typeof FIXTURE_STATES)[number];

/** The fixture member's id (iOS uses the same, upper case). */
export const FIXTURE_PROFILE_ID = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';

/** The state this development build was started in, or null (always null in a release build). */
export function requestedFixtureState(): FixtureState | null {
  const state = fixtureArgs().state;
  return (FIXTURE_STATES as readonly string[]).includes(state ?? '') ? (state as FixtureState) : null;
}

function healthJSON(state: FixtureState, language: string): unknown {
  const consent = { version: '2026-09-v1', consentedAt: '2026-09-01T09:00:00Z', ageSource: 'kennitala' };
  const empty = { latest: null, weighInDue: false, program: null, proposalId: null, appleHealth: null };
  switch (state) {
    case 'active-plan':
      return {
        access: 'entitled',
        consent,
        trialEligible: false,
        latest: { weightKg: 72.5, heightCm: 174, measuredAt: '2026-09-14T07:20:00Z' },
        weighInDue: false,
        program: {
          id: 'prog-1',
          status: 'active',
          weekNo: 2,
          weeks: 4,
          // The server localises this title from the member's locale.
          summaryTitle: language === 'is' ? 'Byggja upp styrk, 3 dagar í viku' : 'Build strength, 3 days a week',
          today: {
            sessionId: 'sess-1',
            kind: 'strength',
            title: 'Full body strength',
            minutes: 40,
            status: 'planned',
            bookingId: null,
            hasBooking: false,
            bookingTitle: null,
            bookingStartsAt: null,
            movedAway: false,
          },
        },
        proposalId: null,
        appleHealth: { connected: false, lastSyncedAt: null },
      };
    case 'entitled-no-plan':
      return { access: 'entitled', consent, trialEligible: false, ...empty };
    case 'not-member':
      return { access: 'not_member', consent: null, trialEligible: true, ...empty };
    case 'minor':
      return { access: 'minor', consent: null, trialEligible: false, ...empty };
    case 'pass-holder':
      return { access: 'pass_only', consent: null, trialEligible: false, ...empty };
  }
}

/**
 * The profile's `offersCard` (API 0.51.0) for an `offersCard` variant, or
 * null for none, which the decoder reads as an older server's profile: no card.
 */
function offersCardJSON(variant: string | undefined): { show: boolean; dismissed: boolean } | null {
  switch (variant) {
    case 'open':
    case 'fails-once':
      return { show: true, dismissed: false };
    case 'opted-in':
      return { show: false, dismissed: false };
    case 'dismissed':
      return { show: false, dismissed: true };
    default:
      return null;
  }
}

function usageJSON(state: FixtureState): unknown {
  const common = {
    topup: { available: false, prices: { gym: null, studio: null, pool: null } },
    block: { until: null },
    strikes: { active: 0, threshold: 3 },
  };
  if (state === 'active-plan' || state === 'entitled-no-plan' || state === 'minor') {
    return {
      tier: 'plus',
      network: { used: 4, cap: 12, resetsAt: '2026-10-01T00:00:00Z' },
      pools: { used: 2, cap: 8, resetsAt: '2026-10-01T00:00:00Z' },
      daily: { used: 0, cap: 1, resetsAt: null },
      concurrent: { open: 0, cap: 2 },
      passes: [],
      ...common,
    };
  }
  return {
    tier: null,
    network: null,
    pools: null,
    daily: null,
    concurrent: { open: 0, cap: null },
    passes:
      state === 'pass-holder'
        ? [{ id: '0b8e3c1a-2d4f-4a6b-8c9d-0e1f2a3b4c5d', type: 'adventurer', visitsLeft: 5, expiresAt: '2026-12-07T23:35:00Z' }]
        : [],
    ...common,
  };
}

/** The fixture profile for `state`, through the real decoder. */
export function fixtureProfile(state: FixtureState): Profile {
  const args = fixtureArgs();
  const language = args.language === 'is' ? 'is' : 'en';
  // A free account (no membership, no pass) has its 3 messages, all unspent;
  // everyone else has the full Coach.
  const coach =
    state === 'not-member' || state === 'pass-holder'
      ? {
          tier: 'free',
          freeMessages: { limit: 3, remaining: 3, windowDays: 30, resetsAt: null },
          upgrade: { action: 'plans', url: 'https://www.lifepass.is/plans' },
        }
      : { tier: 'member' };
  const recentCheckIn =
    args.recentCheckIn !== undefined
      ? {
          checkInId: '7c1f2ab3-9d54-4e88-9a01-4f21a0c93b77',
          checkedInAt: new Date(Date.now() - 4 * 60_000).toISOString(),
          memberShortName: 'Anna J.',
          venue: { id: '1b9c6d2e-3f40-4a51-8b62-7c83d94e05f1', name: 'Laugar Spa' },
          activity: null,
          party: null,
        }
      : null;
  return decodeProfile({
    id: FIXTURE_PROFILE_ID,
    email: 'screenshot@lifepass.is',
    fullName: 'Anna Jonsdottir',
    nationality: 'IS',
    locale: language,
    kennitalaVerified: args.unverified === undefined,
    marketingConsent: args.offersCard === 'opted-in',
    createdAt: '2026-01-10T12:00:00Z',
    usage: usageJSON(state),
    recentCheckIn,
    health: healthJSON(state, language),
    coach,
    offersCard: offersCardJSON(args.offersCard),
  });
}
