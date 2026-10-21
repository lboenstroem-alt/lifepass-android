/**
 * Check-in links up to the Scan tab (iOS CheckInLinkTests, the half that is
 * not the walk-in flow's): a link parks its venue and checks no one in, both
 * link forms reach the same park, a link this app does not trust parks
 * nothing, and sign-out forgets a parked venue (testSignOutForgetsAParkedLink).
 *
 * What happens once the Scan tab takes the venue (it asks "Check in at
 * <venue>?" before anything is sent) is the flow's (CHECKIN-2,
 * CheckInLinkTests' other cases); that the tab hands it over with
 * `fromLink: true`, once, is in ../../scan/__tests__/CheckInScanView.test.tsx.
 */
import { handleDeepLink } from '../../../../app/deepLinks';
import { runSignOutCleaners } from '../../../../app/signOut';
import { resetIntentStoreForTests, useIntentStore } from '../../../../stores/intentStore';

// Auth links are another package's; their handler reads the app manifest when it loads.
jest.mock('../../../auth/authCallback', () => ({ handleAuthCallback: async () => undefined }));

const VENUE = '3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f';

beforeEach(() => resetIntentStoreForTests());

describe('a check-in link', () => {
  it.each([
    `https://lifepass.is/scan?v=${VENUE}`,
    `https://www.lifepass.is/scan?v=${VENUE}`,
    `lifepass://scan?v=${VENUE}`,
    `lifepass://scan?v=${VENUE.toUpperCase()}`,
  ])('%s parks the venue for the Scan tab and sends nothing', (url) => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    handleDeepLink(url);
    expect(useIntentStore.getState().pendingScanVenueId).toBe(VENUE);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it.each([
    `https://example.com/scan?v=${VENUE}`,
    'lifepass://scan?v=not-a-venue',
    'lifepass://scan?v=00000000-0000-0000-0000-000000000000',
    'lifepass://scan',
  ])('%s parks nothing', (url) => {
    handleDeepLink(url);
    expect(useIntentStore.getState().pendingScanVenueId).toBeNull();
  });
});

it('sign-out forgets a parked link (testSignOutForgetsAParkedLink)', async () => {
  handleDeepLink(`lifepass://scan?v=${VENUE}`);
  expect(useIntentStore.getState().pendingScanVenueId).toBe(VENUE);
  await runSignOutCleaners({ memberId: null });
  expect(useIntentStore.getState().pendingScanVenueId).toBeNull();
});
