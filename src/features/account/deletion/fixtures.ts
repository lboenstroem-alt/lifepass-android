/**
 * Development-only states for the deletion sheet, the Android twin of iOS
 * `HealthScreenshotFixtures` (`-LPScreenshotHealth deletion` and
 * `deletion-pending`), driven by `EXPO_PUBLIC_FIXTURE` (src/dev/fixtures.ts):
 *
 *   EXPO_PUBLIC_FIXTURE="state=active-plan,health=deletion" npx expo start
 *
 * - `health=deletion`: Account opens the sheet on the active state, and
 *   "Delete my account" answers with a STUBBED pending result, so a device
 *   check can see the member told the outcome without deleting anything.
 * - `health=deletion-pending`: the sheet opens on the pending state, with a
 *   subscription, two bookings and a payment still to settle.
 *
 * UNDER EITHER, NO WRITE LEAVES THE PHONE. "Keep my account" answers with a
 * stubbed active state too. iOS stubs only the request and sends the cancel
 * for real; Android QA runs against production with a real account
 * (DECISIONS: no production writes), so the tap a fixture invites must not
 * reach the server.
 *
 * Both read nothing unless `__DEV__` (`fixtureArg` is null in a release
 * bundle), so production can never see or send a fixture.
 */
import type { AccountDeletionRequestResult, AccountDeletionState } from '../../../api/accountDeletion';
import { fixtureArg } from '../../../dev/fixtures';

const DAY_MS = 24 * 60 * 60 * 1000;

function fixtureName(): string | null {
  return fixtureArg('health');
}

/** Account opens the deletion sheet by itself (iOS `opensDeletion`). */
export function opensDeletionFixture(): boolean {
  const name = fixtureName();
  return name === 'deletion' || name === 'deletion-pending';
}

/** The state the sheet reads instead of `GET /account/deletion`, or null outside a fixture. */
export function deletionFixtureState(now: Date = new Date()): AccountDeletionState | null {
  const name = fixtureName();
  if (name === 'deletion') {
    return { accountStatus: 'active', deletionRequestedAt: null, erasureScheduledAt: null, obligations: [] };
  }
  if (name !== 'deletion-pending') return null;
  return {
    accountStatus: 'deletion_pending',
    deletionRequestedAt: now,
    erasureScheduledAt: new Date(now.getTime() + 24 * DAY_MS),
    obligations: [
      { kind: 'subscription', count: 1, clearsAt: null },
      { kind: 'future_booking', count: 2, clearsAt: null },
      { kind: 'pending_charge', count: 1, clearsAt: null },
    ],
  };
}

/** What "Delete my account" answers with under `health=deletion`, or null (a real request). */
export function deletionFixtureRequestResult(now: Date = new Date()): AccountDeletionRequestResult | null {
  if (fixtureName() !== 'deletion') return null;
  return {
    accountStatus: 'deletion_pending',
    deletionRequestedAt: now,
    erasureScheduledAt: new Date(now.getTime() + 24 * DAY_MS),
    obligations: [
      { kind: 'subscription', count: 1, clearsAt: null },
      { kind: 'future_booking', count: 2, clearsAt: null },
    ],
    alreadyPending: false,
    healthDeleted: null,
  };
}

/**
 * What "Keep my account" answers with under either deletion fixture, or null
 * (a real cancel). The account is back to active, as the server answers.
 */
export function deletionFixtureCancelResult(): AccountDeletionState | null {
  const name = fixtureName();
  if (name !== 'deletion' && name !== 'deletion-pending') return null;
  return { accountStatus: 'active', deletionRequestedAt: null, erasureScheduledAt: null, obligations: [] };
}
