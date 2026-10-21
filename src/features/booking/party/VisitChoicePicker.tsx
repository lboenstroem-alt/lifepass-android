// @f4-stub (plan 3.0.3): the premium rung picker (how the visit is paid), filled by BOOK-2; mounted by BOOK-1.
//
// The rungs the booking preview offers; the chosen one rides in the create
// body. Controlled by the booking screen. Keep the default export and its
// props; replace the body (and this marker). Renders nothing until BOOK-2 lands.
//
// BOOK-1's mount (src/features/booking/components/BookingChargeSection.tsx)
// also passes `options`, so each row can show what it costs, as iOS draws
// `Venue.iskPrefix(option.priceIsk)` beside every rung.
import type { VisitChoiceOption } from '../../../api/bookings';

export interface VisitChoicePickerProps {
  /** The rungs the preview offered, by their wire ids, in its order. */
  readonly choices: readonly string[];
  readonly selected: string | null;
  readonly onSelect: (choice: string) => void;
  readonly disabled?: boolean;
  /** The same rungs in full (price, whether it spends a visit, the reason), in `choices`' order. */
  readonly options?: readonly VisitChoiceOption[];
}

export default function VisitChoicePicker(_props: VisitChoicePickerProps) {
  return null;
}
