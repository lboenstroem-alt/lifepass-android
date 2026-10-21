/**
 * Draws the item editor `presentItemEditor` asks for (./itemEditorPresenter.ts).
 * Mounted once over the tabs; the sheet itself renders above every screen.
 */
import { useEffect, useRef } from 'react';

import FoodItemEditorSheet from './FoodItemEditorSheet';
import { attachItemEditorHost, dismissItemEditor, useItemEditorPresenter, type ItemEditorRequest } from './itemEditorPresenter';

export default function ItemEditorHost() {
  useEffect(() => attachItemEditorHost(), []);
  const request = useItemEditorPresenter((s) => s.request);
  // The last request stays drawn while the sheet slides away.
  const last = useRef<ItemEditorRequest | null>(request);
  if (request) last.current = request;
  const shown = last.current;
  if (!shown) return null;
  return (
    <FoodItemEditorSheet
      item={request ? request.item : null}
      context={shown.context}
      detail={shown.detail}
      offBarcode={shown.offBarcode}
      sourceWordOverride={shown.sourceWordOverride}
      readOnly={shown.readOnly}
      fromDescription={shown.fromDescription}
      onClose={dismissItemEditor}
      testID="itemEditorHost"
    />
  );
}
