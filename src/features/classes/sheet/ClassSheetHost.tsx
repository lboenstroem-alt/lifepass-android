// Draws the class sheet `openClassSheet` asks for (plan 3.0.3). Mounted once
// by F4's tabs shell, outside any screen: a page the sheet opens goes through
// the app's navigator (./pages.ts), and the sheet steps aside while it is up
// (./ClassBookingSheet.tsx).
//
// Each opening is its own sheet (keyed by the request), so a second request
// never inherits the first one's booking session.
//
// A development build started with `classSheet=<variant>` opens the fixture
// sheet once, over the tab it starts on (./fixtures.ts).
import { useEffect } from 'react';

import ClassBookingSheet, { type ClassBookingSheetProps } from './ClassBookingSheet';
import { CLASS_SHEET_FIXTURE_SESSION, classSheetFixtureOccurrence, isClassSheetFixture, takeClassSheetFixture } from './fixtures';
import { openClassSheet } from './open';
import { finishClassSheet, setClassSheetBusy, useClassSheetRequest } from './requests';

export interface ClassSheetHostProps {
  /** Where the sheet's pages open (tests). */
  readonly pages?: ClassBookingSheetProps['pages'];
  /** The booking session's dependencies (tests). */
  readonly sessionOptions?: ClassBookingSheetProps['sessionOptions'];
}

export default function ClassSheetHost({ pages, sessionOptions }: ClassSheetHostProps = {}) {
  const request = useClassSheetRequest();

  useEffect(() => {
    const variant = takeClassSheetFixture();
    if (variant) openClassSheet(classSheetFixtureOccurrence(variant));
  }, []);

  if (!request) return null;
  const { id, occurrence, callbacks } = request;
  return (
    <ClassBookingSheet
      key={id}
      occurrence={occurrence}
      onBooked={callbacks.onBooked}
      returnFocusRef={callbacks.returnFocusRef}
      onFinished={(ending) => finishClassSheet(id, ending)}
      onBusyChange={(busy) => setClassSheetBusy(id, busy)}
      pages={pages}
      // The fixture's session never reaches the server.
      sessionOptions={isClassSheetFixture(occurrence) ? CLASS_SHEET_FIXTURE_SESSION : sessionOptions}
    />
  );
}
