// Draws the change-days sheet `openChangeDays` asks for (plan 3.0.3,
// PLAN-4). Mounted once by F4's tabs shell, outside any screen.
//
// Every opening is its own sheet (keyed by the request), so its picks, its
// error line and its save start fresh, as iOS makes new @State per
// presentation. The request stays while its sheet slides away, so the chips
// do not vanish mid-slide; what the sheet owes its caller runs once it has
// gone (./presenter.ts).
//
// A page the caller opens from a callback goes through `openSharedRoute`
// (src/navigation/sharedSheet.ts); the sheet has already gone by then, so
// the page never opens under it.
import { useEffect } from 'react';

import ChangeDaysSheet from './ChangeDaysSheet';
import { attachChangeDaysHost, changeDaysClosed, dismissChangeDays, useChangeDaysPresenter } from './presenter';

export default function ChangeDaysHost() {
  // Until this runs, `openChangeDays` answers every request with its cancel.
  useEffect(() => attachChangeDaysHost(), []);
  const request = useChangeDaysPresenter((s) => s.request);
  const visible = useChangeDaysPresenter((s) => s.visible);
  if (!request) return null;
  return (
    <ChangeDaysSheet
      key={request.id}
      visible={visible}
      mode={request.mode}
      // Bound to this request, so a sheet that is no longer the one on record can never close the next one.
      onDismiss={(after) => dismissChangeDays(request.id, after)}
      onClosed={() => changeDaysClosed(request.id)}
    />
  );
}
