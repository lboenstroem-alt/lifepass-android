// Coach shapes shared outside the Coach's own folder.
//
// The Coach's messages, sessions and replies live in src/features/coach
// (store/messages.ts, persistence/sessions.ts, chat/coachApi.ts). What stays
// here is the question chip, which the venue wizard's question tables
// (src/data/coachQuestions.ts, COACH-2) are written in.

/** One chip on a question bubble (iOS `QuestionOption`, Models/CoachQuestions.swift). */
export interface QuestionOption {
  /** What the chip says (already translated). */
  readonly label: string;
  /** The wire value the flow reads; never shown. */
  readonly value: string;
  /** "Other": the chip opens an inline text field instead of answering. */
  readonly isOther?: boolean;
  /**
   * For an "Other" field whose answer travels to a server with its own
   * limit: the longest text it will accept, in UTF-16 units (JS string
   * length). Absent for an answer that stays on the phone.
   */
  readonly maxLength?: number;
}
