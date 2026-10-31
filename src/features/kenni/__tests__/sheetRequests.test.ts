/**
 * F4's stub of the Kenni sheet request (AUTH-3 fills it): an open request is
 * forgotten at sign-out, so the sheet never reappears for the next member and
 * never calls back into the previous member's screen.
 */
import { act, renderHook } from '@testing-library/react-native';

import { runSignOutCleaners } from '../../../app/signOut';
import { closeKenniSheetRequest, openKenniSheet, useKenniSheetRequest } from '../sheetRequests';

describe('an open Kenni sheet request', () => {
  it('is forgotten at sign-out without telling its opener', async () => {
    const onClose = jest.fn();
    const { result } = await renderHook(() => useKenniSheetRequest());
    await act(async () => openKenniSheet({ bodyKey: 'kenni.body', onClose }));
    expect(result.current).not.toBeNull();

    await act(async () => runSignOutCleaners({ memberId: 'member-a' }));
    expect(result.current).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    // Nothing left for a later close to report.
    closeKenniSheetRequest();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closed by its host tells its opener once', async () => {
    const onClose = jest.fn();
    openKenniSheet({ bodyKey: 'kenni.onboarding_body', onClose });
    closeKenniSheetRequest();
    closeKenniSheetRequest();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
