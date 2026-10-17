/**
 * The calls the deletion sheet makes, with the development fixtures in
 * front of the read and the request (./fixtures.ts), as iOS's
 * `AccountDeletionService` checks `HealthScreenshotFixtures` in DEBUG. In a
 * release bundle the fixtures answer null and every call is the real one.
 */
import {
  cancelAccountDeletion,
  fetchAccountDeletionState,
  requestAccountDeletion,
  type AccountDeletionRequestResult,
  type AccountDeletionState,
} from '../../../api/accountDeletion';

import { deletionFixtureRequestResult, deletionFixtureState } from './fixtures';

export const accountDeletionService = {
  read(signal?: AbortSignal): Promise<AccountDeletionState> {
    const fixture = deletionFixtureState();
    if (fixture) return Promise.resolve(fixture);
    return fetchAccountDeletionState({ signal });
  },

  request(idempotencyKey: string): Promise<AccountDeletionRequestResult> {
    const stub = deletionFixtureRequestResult();
    if (stub) return Promise.resolve(stub);
    return requestAccountDeletion(idempotencyKey);
  },

  cancel(idempotencyKey: string): Promise<AccountDeletionState> {
    return cancelAccountDeletion(idempotencyKey);
  },
};
