// @f4-stub (plan 3.0.3): the premium rung picker (how the visit is paid), filled by BOOK-2; mounted by BOOK-1.
//
// The rungs the booking preview offers; the chosen one rides in the create
// body. Controlled by the booking screen. Keep the default export and its
// props; replace the body (and this marker). Renders nothing until BOOK-2 lands.

export interface VisitChoicePickerProps {
  /** The rungs the preview offered, by their wire ids, in its order. */
  readonly choices: readonly string[];
  readonly selected: string | null;
  readonly onSelect: (choice: string) => void;
  readonly disabled?: boolean;
}

export default function VisitChoicePicker(_props: VisitChoicePickerProps) {
  return null;
}
