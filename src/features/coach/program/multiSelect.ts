/**
 * A multi-select bubble: question 5, question 5b, and the summary's "where"
 * row (iOS `ProgramMultiSelect`, Models/CoachProgramWizard.swift). The
 * selection lives on the message, so a redraw keeps it and an answered
 * bubble can still show what was picked.
 */
import type { ProgramQuestion } from './model';

export interface ProgramMultiSelectOption {
  readonly value: string;
  readonly labelKey: string;
  /** "Nothing" clears the others and is cleared by any other. */
  readonly isExclusive?: boolean;
}

export interface ProgramMultiSelect {
  readonly question: ProgramQuestion;
  /** The question, already translated. */
  readonly text: string;
  /** A line under the question (`program.q.safety_note`). */
  readonly noteKey: string | null;
  readonly options: readonly ProgramMultiSelectOption[];
  /** Question 5b takes at most three; null means no ceiling. */
  readonly maxSelection: number | null;
  /** The picked values, in the order they were picked. */
  readonly selection: readonly string[];
  /** Answered (or abandoned): the chips stay visible and dimmed, Continue goes. */
  readonly closed: boolean;
  /** Set for 3 seconds after a tap over the ceiling (`program.part.max`). */
  readonly showsMaxHint: boolean;
}

/** How long the "You can pick up to 3." line stays. */
export const MAX_HINT_MS = 3_000;

export function canConfirm(state: Pick<ProgramMultiSelect, 'selection'>): boolean {
  return state.selection.length > 0;
}

/**
 * Toggle with the exclusivity and ceiling rules. `accepted` is false when the
 * tap was refused by the ceiling (the selection is then unchanged), so the
 * caller can show the hint. A closed bubble takes nothing (and refuses
 * nothing).
 */
export function toggleSelection(
  state: ProgramMultiSelect,
  value: string,
): { readonly state: ProgramMultiSelect; readonly accepted: boolean } {
  if (state.closed) return { state, accepted: true };
  const option = state.options.find((candidate) => candidate.value === value);
  if (state.selection.includes(value)) {
    return { state: { ...state, selection: state.selection.filter((picked) => picked !== value) }, accepted: true };
  }
  if (option?.isExclusive) return { state: { ...state, selection: [value] }, accepted: true };
  if (state.maxSelection !== null && state.selection.length >= state.maxSelection) {
    return { state, accepted: false };
  }
  const exclusive = new Set(state.options.filter((candidate) => candidate.isExclusive).map((candidate) => candidate.value));
  return {
    state: { ...state, selection: [...state.selection.filter((picked) => !exclusive.has(picked)), value] },
    accepted: true,
  };
}
