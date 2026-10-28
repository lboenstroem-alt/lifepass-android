/**
 * Draws the "Describe what you ate" sheet `openDescribe` asks for (plan
 * 3.0.3). Mounted once by F4's tabs shell, outside any screen; the sheet
 * draws from the UI kit's portal, over the meal page (a root modal) that
 * asked for it.
 *
 * Each opening is a fresh sheet (keyed by the request), so a new opening
 * never inherits the last one's words, key or answer. When the host goes
 * (sign-out) the request, and any words in it, go with it.
 */
import { useEffect } from 'react';

import DescribeSheet from './DescribeSheet';
import { attachDescribeHost, describeClosed, useDescribePresenter } from './presenter';

export default function DescribeHost() {
  useEffect(() => attachDescribeHost(), []);
  const request = useDescribePresenter((s) => s.request);
  const visible = useDescribePresenter((s) => s.visible);
  if (!request) return null;
  return <DescribeSheet key={request.id} request={request} visible={visible} onClosed={() => describeClosed(request.id)} />;
}
