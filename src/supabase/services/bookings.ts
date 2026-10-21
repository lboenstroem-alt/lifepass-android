// Bookings, backed by the LifePass v1 API — mirrors lifepass-ios
// Services/BookingService.swift.
//
// WHAT IS LEFT HERE (BOOK-1). The booking flow's calls (availability,
// classes, the preview, the create) moved to src/api/bookings.ts, and its
// payment session to F8 (src/payments). This file keeps only what screens not
// yet rebuilt still import: the bookings list and cancel (My bookings, LIB-1)
// and the walk-in payment session and confirm (the scanner, CHECKIN-1/2).
// Each owner moves off it; QA-1 deletes it with its last caller.
//
// The old direct-Supabase access (querying `availability_slots` and inserting
// into `bookings`) is DEAD against the v1 backend: availability is a
// server-side provider facade at `/activities/{id}/availability`, and creates
// go through `POST /bookings` where the server derives venue/price/provider/
// owner/status and resolves the charge + gating. Same migration favourites.ts
// and venues.ts already went through.
import { apiGet, apiPost } from '../../api/client';
import type { Booking } from '../../types/booking';

// ─── Read shape (GET /bookings) ──────────────────────────────────────────────

// A booking as the API returns it — unified internal + provider shape.
type ApiBooking = {
  id: string;
  status: string; // pending | confirmed | checked_in | cancelled | completed | no_show
  startsAt: string;
  endsAt: string;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  venue: { id: string; slug: string; name: string };
  activity?: { id: string; name: string } | null;
  /** Snapshotted provider class name (e.g. "Hot Yoga"); null for slot bookings. */
  externalTitle?: string | null;
  location?: string | null;
};

// `GET /bookings` is paginated: the API envelope's `data` is itself
// `{ data: [...], pagination }` (same convention as `/venues`).
type BookingPage = { data: ApiBooking[]; pagination?: unknown };

// The v1 status vocabulary collapsed onto the app's 3-state model.
function adaptStatus(s: string): Booking['status'] {
  if (s === 'cancelled' || s === 'no_show') return 'canceled';
  if (s === 'completed' || s === 'checked_in') return 'completed';
  return 'confirmed'; // pending | confirmed
}

export function adaptBooking(b: ApiBooking): Booking {
  return {
    id: b.id,
    venueId: b.venue.id,
    venueName: b.venue.name,
    // The booking read shape carries no venue image. None, never a stock
    // photo shown as the venue (F6, plan "no picsum anywhere"): Home's
    // upcoming card falls back to the hero's photo, as iOS does, and iOS
    // Library rows show a calendar glyph, not a photo (LIB-1's rewrite).
    // Undefined rather than '', so a caller can branch on it and an Image is
    // never handed an empty uri.
    venueImageUrl: undefined,
    activityName: b.externalTitle ?? b.activity?.name ?? 'Activity',
    bookingTime: new Date(b.startsAt),
    status: adaptStatus(b.status),
    creditCost: 0, // credits are gone backend-side — premium venues are à-la-carte
    isLuxury: false,
  };
}

export async function fetchBookings(upcoming: boolean): Promise<Booking[]> {
  const page = await apiGet<BookingPage>('/bookings', {
    range: upcoming ? 'upcoming' : 'past',
    limit: 100,
  });
  return page.data.map(adaptBooking);
}

export async function fetchUpcomingBookings(limit = 5): Promise<Booking[]> {
  const page = await apiGet<BookingPage>('/bookings', { range: 'upcoming', limit });
  return page.data.map(adaptBooking);
}

// `POST /bookings/{id}/cancel` — deterministic idempotency key so a network
// retry of the same cancel can't be treated as a new operation.
export async function cancelBooking(id: string): Promise<void> {
  await apiPost(`/bookings/${id}/cancel`, { reason: null }, { idempotencyKey: `cancel-${id}` });
}

// ─── Pay-and-save-card rail (no saved card) ──────────────────────────────────
//
// A charge-bearing booking returns `402 no_payment_method_on_file` when the
// member has no vaulted card. Instead of dead-ending, create an amount-only
// Kling hosted session (captures the surcharge AND vaults the card), open it,
// and on return confirm — a verified pull that vaults the card then runs the
// booking with the captured funds. Mirrors iOS BookingPaymentService
// (monorepo PR #70, docs/09_BOOKING_PAYMENT_SESSIONS.md).
//
// Idempotency contract: the session MUST reuse the SAME key
// the direct `createBooking` used, so paying-via-session and booking-directly
// can never double-book. Confirm resolves the session by that same key.

type CreateSessionResponse = {
  hasCard: boolean;
  sessionId?: string;
  externalSessionId?: string;
  url?: string;
  amountIsk?: number;
};

export type BookingPaySession =
  | { hasCard: true }
  | { hasCard: false; url: string; externalSessionId: string; amountIsk: number };

async function createPaymentSession(
  body: Record<string, unknown>,
  idempotencyKey: string,
  fallbackAmount: number,
): Promise<BookingPaySession> {
  const res = await apiPost<CreateSessionResponse>('/bookings/payment-sessions', body, {
    idempotencyKey,
  });
  if (res.hasCard) return { hasCard: true };
  if (!res.url || !res.externalSessionId) {
    // Contract violation (hasCard:false with no url) — retryable, not a no-op.
    throw new Error('Payment could not be started. Please try again.');
  }
  return {
    hasCard: false,
    url: res.url,
    externalSessionId: res.externalSessionId,
    amountIsk: res.amountIsk ?? fallbackAmount,
  };
}

// Walk-in variant: `venueId` is required, no start/end window, `activityId` is
// null for a venue-level walk-in. Same `/bookings/payment-sessions` endpoint
// with `kind: 'walk_in'` (server schema requires activityId to be present).
export async function createWalkInPaymentSession(
  input: { venueId: string; activityId?: string | null; acceptedChargeAmountIsk: number },
  idempotencyKey: string,
): Promise<BookingPaySession> {
  return createPaymentSession(
    {
      kind: 'walk_in',
      activityId: input.activityId ?? null,
      venueId: input.venueId,
      acceptedChargeAmountIsk: input.acceptedChargeAmountIsk,
    },
    idempotencyKey,
    input.acceptedChargeAmountIsk,
  );
}

export type BookingPayStatus =
  | 'fulfilled'
  | 'processing'
  | 'refunded'
  | 'expired'
  | 'needs_attention';

export type BookingPayConfirmation = {
  status: BookingPayStatus;
  bookingId?: string;
  checkInId?: string;
  reason?: string;
};

const PAY_STATUSES: BookingPayStatus[] = [
  'fulfilled',
  'processing',
  'refunded',
  'expired',
  'needs_attention',
];

// `POST /bookings/payment-sessions/confirm` — verified pull → card vault →
// booking, resolved by the booking idempotency key (Kling doesn't template its
// session id into the return URL). Idempotent — safe to call repeatedly. An
// unrecognized status decodes as `processing` so a new state can't read as
// success.
export async function confirmBookingPaymentSession(
  key: string,
): Promise<BookingPayConfirmation> {
  const res = await apiPost<{ status: string; bookingId?: string; checkInId?: string; reason?: string }>(
    '/bookings/payment-sessions/confirm',
    { key },
  );
  const status = (PAY_STATUSES as string[]).includes(res.status)
    ? (res.status as BookingPayStatus)
    : 'processing';
  return { status, bookingId: res.bookingId, checkInId: res.checkInId, reason: res.reason };
}
