/**
 * One row of the drafts list (iOS DraftsListView): "Photo estimate, Wed 15
 * Oct 08:12" or "Description estimate, Wed 15 Oct 12:40". The day is the
 * day the draft belongs to (a server day, read on Iceland's calendar); the
 * time is when it was logged, read off the member's own clock, as iOS's
 * `HealthFormat.time` reads it.
 */
import { isDraftFromDescription, type MealDraftBrief } from '../../../health';
import type { Lang } from '../../../i18n';
import { localTime, shortDay, type CopyLine } from '../../../i18n/format';

/** A draft made from a description (a text bubble), not a photo (a camera). */
export function isTextDraft(draft: Pick<MealDraftBrief, 'source'>): boolean {
  return isDraftFromDescription(draft);
}

export function draftRowLine(draft: Pick<MealDraftBrief, 'source' | 'logDate' | 'loggedAt'>, language: Lang): CopyLine {
  return {
    key: isDraftFromDescription(draft) ? 'diary.draft_row_text_dated' : 'diary.draft_row_dated',
    params: {
      date: draft.logDate ? shortDay(draft.logDate, language) : '',
      time: draft.loggedAt ? localTime(draft.loggedAt) : '',
    },
  };
}
