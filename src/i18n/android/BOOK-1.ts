// Android-only copy for BOOK-1: Booking core (state machine, timetables, preview, consent, outcomes, reminders).
//
// Owned by BOOK-1 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
//
// iOS draws the date step with the system's graphical DatePicker, which
// names its own month arrows for VoiceOver. Android draws the month grid
// itself, so its arrows need words of their own for TalkBack.
import { definePack } from './pack';

export default definePack({
  en: {
    'book1.calendar.previous_month': 'Previous month',
    'book1.calendar.next_month': 'Next month',
  },
  is: {
    'book1.calendar.previous_month': 'Fyrri mánuður',
    'book1.calendar.next_month': 'Næsti mánuður',
  },
});
