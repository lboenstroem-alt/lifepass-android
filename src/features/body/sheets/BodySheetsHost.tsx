// Draws the sheets `openBodySheet` / `openTargetSheet` ask for (plan 3.0.3,
// BODY-2). Mounted once by F4's tabs shell, outside any screen.
//
// Every opening is its own sheet (keyed by the request), so its fields, its
// errors and its Idempotency-Key start fresh, as iOS makes new @State per
// presentation. The request stays while its sheet slides away, so the content
// does not vanish mid-slide; what the sheet owes its caller runs once it has
// gone, whether the sheet closed itself or the member swiped it away
// (../sheet/presenter.ts).
//
// A page the caller opens from a callback goes through `openSharedRoute`
// (src/navigation/sharedSheet.ts); the sheet has already gone by then, so the
// page never opens under it.
import { useEffect } from 'react';

import BodySheet from '../sheet/BodySheet';
import { attachBodySheetsHost, bodySheetClosed, dismissBodySheet, useBodySheetPresenter } from '../sheet/presenter';
import TargetWeightSheet from '../target/TargetWeightSheet';

export default function BodySheetsHost() {
  // Until this runs, the open functions answer every request as a close.
  useEffect(() => attachBodySheetsHost(), []);
  const request = useBodySheetPresenter((s) => s.request);
  const visible = useBodySheetPresenter((s) => s.visible);
  if (!request) return null;
  // Both are bound to this request, so a sheet that is no longer the one on
  // record (replaced while it slid away) can never close the next one.
  const onDismiss = (after: (() => void) | null) => dismissBodySheet(request.id, after);
  const onClosed = () => bodySheetClosed(request.id);
  if (request.sheet === 'body') {
    return (
      <BodySheet
        key={request.id}
        visible={visible}
        mode={request.mode}
        onDismiss={onDismiss}
        onClosed={onClosed}
      />
    );
  }
  return (
    <TargetWeightSheet
      key={request.id}
      visible={visible}
      mode={request.mode}
      onDismiss={onDismiss}
      onClosed={onClosed}
    />
  );
}
