/**
 * Shared set-up for the walk-in flow tests: a store on the stub server (as
 * the iOS tests build a `CheckInViewModel` on `StubServer.client()`), with no
 * sheet beat and no profile refresh, the money rails reset per test, and the
 * wire shapes the server sends.
 *
 * Each test file still mocks expo-web-browser itself (jest hoists the mock
 * into the file that declares it):
 *
 *   jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
 */
import { api, type StubRequest } from '@test/server';
import type { StoreApi } from 'zustand/vanilla';

import { stubApiClientPerTest } from '../../../../api/testing';
import { freshPaymentsPerTest, signIn } from '../../../../payments/__tests__/paymentsHarness';
import { createWalkInStore, type WalkInDeps, type WalkInStore } from '../store';

/**
 * A walk-in store for one test, on the stub server, with its screen on
 * show (a payment outcome is the screen's to say).
 */
export function walkInStoreForTest(overrides: Partial<WalkInDeps> = {}): StoreApi<WalkInStore> {
  return createWalkInStore({
    dismissBeatMs: 0,
    refreshCredits: async () => undefined,
    isScreenAlive: () => true,
    ...overrides,
  });
}

/** Signed in on the stub server, the money rails fresh, every test. */
export function walkInTestEnvironment(): void {
  stubApiClientPerTest();
  freshPaymentsPerTest();
  beforeEach(() => signIn());
}

/** Every POST the phone sent to `path`, oldest first. */
export function posts(path: string): StubRequest[] {
  return api.sentAll(path, 'POST');
}

/** The JSON body of a request, as an object. */
export function bodyOf(request: StubRequest | undefined): Record<string, unknown> {
  return (request?.body ?? {}) as Record<string, unknown>;
}

/** The request's Idempotency-Key. */
export function keyOf(request: StubRequest | undefined): string | undefined {
  return request?.headers['idempotency-key'];
}

// ---------------------------------------------------------------------------
// The wire

export const SKY_LAGOON_ID = '3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f';
export const WORLD_CLASS_ID = '6a1d2f4e-8b3c-4d5e-9f60-718293a4b5c6';
export const YOGA_ID = '1b2c3d4e-0000-4000-8000-0000000000a1';
export const SWIM_ID = '1b2c3d4e-0000-4000-8000-0000000000a2';
export const BOOKING_ID = '9d7c1b2a-0000-4000-8000-0000000000b1';

export interface PreviewOptions {
  readonly venueId?: string;
  readonly slug?: string;
  readonly name?: string;
  readonly allowed?: boolean;
  readonly blockingReason?: string | null;
  readonly activities?: { id: string; name: string }[];
  readonly charge?: Record<string, unknown> | null;
  readonly guestBands?: Record<string, unknown>[] | null;
  readonly coveredBy?: unknown;
  readonly attendableBooking?: Record<string, unknown> | null;
}

/** `GET /check-ins/walk-in/preview`'s `data`. */
export function previewJSON(options: PreviewOptions = {}): Record<string, unknown> {
  const json: Record<string, unknown> = {
    venue: {
      id: options.venueId ?? SKY_LAGOON_ID,
      slug: options.slug ?? 'sky-lagoon',
      name: options.name ?? 'Sky Lagoon',
    },
    walkInsAllowed: true,
    activities: options.activities ?? [],
    slotActivities: [],
    allowed: options.allowed ?? true,
    blockingReason: options.blockingReason ?? null,
    charge: options.charge ?? null,
    attendableBooking: options.attendableBooking ?? null,
  };
  if (options.guestBands !== undefined) json.guestBands = options.guestBands;
  if (options.coveredBy !== undefined) json.coveredBy = options.coveredBy;
  return json;
}

/** `POST /check-ins/walk-in`'s `data`. */
export function checkInJSON(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    checkInId: '9d7c1b2a-0000-4000-8000-000000000001',
    checkedInAt: '2026-09-25T09:00:00.000Z',
    venue: { id: SKY_LAGOON_ID, name: 'Sky Lagoon' },
    ...extra,
  };
}

/** The Adventurer pass, as the preview and the check-in carry it. */
export const ADVENTURER = {
  kind: 'pass',
  passId: '0b8e3c1a-2d4f-4a6b-8c9d-0e1f2a3b4c5d',
  passType: 'adventurer',
  passName: 'Adventurer',
  visitsTotal: 6,
  visitsUsed: 0,
  visitsLeftAfter: 5,
  expiresAt: '2026-12-07T23:35:00.000Z',
};

export const PLUS = { kind: 'subscription', tierName: 'Plus', lane: 'network', visitsLeftAfter: 7 };

export const ADULT_GUEST = [{ band: 'adult', rangeLabel: null, unitIsk: 2650 }];
