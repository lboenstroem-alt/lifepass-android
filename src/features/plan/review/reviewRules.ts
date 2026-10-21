/**
 * The weekly review's rules (iOS WeeklyReviewCard.swift `lines` and
 * PlanView.swift `reviewSection`), pure so the plurals and the "only what the
 * server sent" rule are tested without a screen.
 *
 * EVERY LINE RENDERS ONLY WHEN THE SERVER SENT THE VALUE BEHIND IT, which is
 * why there is no "no data yet" state: a review with nothing in it simply is
 * not sent. The weight line is always a SEVEN DAY AVERAGE and says so, never
 * a single morning's number, because a day of water is not a week of work.
 */
import type { HealthAccess, HealthDay, WeeklyReviewView } from '../../../health';
import type { Translator } from '../../../i18n';
import { decimal, integer } from '../../../i18n/format';

/**
 * What the review slot draws for the day on screen: the check-in prompt
 * while the week is up and the member (entitled) has not checked in, else
 * the review when the server sent one, else nothing. One card, never both:
 * a review of a week you have not closed is a review of a week that is
 * still running (C6).
 */
export type ReviewSectionKind = 'prompt' | 'review' | null;

export function reviewSectionKind(
  day: Pick<HealthDay, 'checkIn' | 'review'> | null,
  access: HealthAccess,
): ReviewSectionKind {
  if (!day) return null;
  if (day.checkIn?.due === true && access === 'entitled') return 'prompt';
  return day.review !== null ? 'review' : null;
}

/** The weight directions the copy has a word for (`review.weight.<direction>`). */
const WEIGHT_DIRECTIONS = ['down', 'up', 'same'] as const;

/**
 * The review's lines, in iOS's order: sessions (or "No plan this week"),
 * weight, food, check-ins, streak. The next week's change and the insight
 * are drawn under them by the card.
 *
 * A weight direction this build has no word for (a newer server's) leaves
 * the weight line out rather than print a copy key on screen.
 */
export function reviewLines(review: WeeklyReviewView, translator: Translator): string[] {
  const { t, tp, language } = translator;
  const lines: string[] = [];

  if (review.hasPlan === false) {
    lines.push(t('review.no_plan'));
  } else if (review.sessionsDone !== null && review.sessionsPlanned !== null) {
    lines.push(t('review.sessions', { done: String(review.sessionsDone), planned: String(review.sessionsPlanned) }));
  }

  const direction = review.weightDirection;
  if (direction !== null && review.weightDeltaKg !== null && (WEIGHT_DIRECTIONS as readonly string[]).includes(direction)) {
    lines.push(
      t('review.weight', {
        direction: t(`review.weight.${direction}`),
        delta: decimal(Math.abs(review.weightDeltaKg), language),
      }),
    );
  }

  if (review.kcalAvg !== null && review.proteinAvgG !== null) {
    lines.push(
      t('review.food', {
        kcal: integer(review.kcalAvg, language),
        protein: decimal(review.proteinAvgG, language, 0),
      }),
    );
  }

  if (review.checkInsCount !== null && review.checkInsCount > 0) {
    lines.push(tp('review.check_ins', review.checkInsCount));
  }

  if (review.streakWeeks !== null && review.streakWeeks > 0) {
    lines.push(tp('review.streak', review.streakWeeks));
  }

  return lines;
}

/** The server's line, when it has words in it. */
export function presentText(line: { readonly text: string | null } | null): string | null {
  const text = line?.text ?? null;
  return text !== null && text !== '' ? text : null;
}
