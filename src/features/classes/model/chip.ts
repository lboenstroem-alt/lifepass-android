/**
 * The registration-state chip on a feed row (iOS `ClassFeedChip`,
 * Models/ClassFeed.swift): the same precedence as the web's `capacityChip`
 * and the timetable's honest-states rule. Abler's explicit verdict outranks
 * capacity heuristics, and "registration not open" must never read as "full"
 * or "unavailable".
 */
import type { ClassFeedItem } from '../../../api/classFeed';

export type ClassFeedChip =
  | { readonly kind: 'open' }
  | { readonly kind: 'left'; readonly count: number }
  | { readonly kind: 'full' }
  | { readonly kind: 'notOpen'; readonly opensAt: Date | null }
  | { readonly kind: 'registrationClosed' }
  | { readonly kind: 'unavailable' };

/** The reasons that mean "registration is not open (yet, or any more)". */
const NOT_OPEN_REASONS: ReadonlySet<string> = new Set(['event_not_open', 'outside_registration_window']);

export function classFeedChip(item: ClassFeedItem, now: Date): ClassFeedChip {
  if (item.canBook === false) {
    if (NOT_OPEN_REASONS.has(item.canBookReason ?? '')) {
      const opens = item.registrationOpensAt;
      if (opens && opens.getTime() <= now.getTime()) return { kind: 'registrationClosed' };
      return { kind: 'notOpen', opensAt: opens };
    }
    if (item.canBookReason === 'class_full' || item.full) return { kind: 'full' };
    return { kind: 'unavailable' };
  }
  if (item.canBook === true) {
    // Trust the positive verdict over derived heuristics: Abler's predicate
    // set includes not-full, so a stale attendance-derived `full` must not
    // mask a bookable class.
    const a = item.attendance;
    if (a && a.limit > 0 && a.limit - a.current > 0) return { kind: 'left', count: a.limit - a.current };
    return { kind: 'open' };
  }
  // No verdict (first-party classes): derive it from capacity.
  if (item.full) return { kind: 'full' };
  const a = item.attendance;
  if (!a) return { kind: 'open' };
  if (a.limit === -1) return { kind: 'open' };
  if (a.limit <= 0) return { kind: 'unavailable' };
  return { kind: 'left', count: Math.max(a.limit - a.current, 0) };
}

/** How a chip reads: its copy key (with `{count}`) and its tone. */
export type ChipTone = 'positive' | 'negative' | 'quiet';

export interface ChipCopy {
  readonly key: string;
  readonly params?: Readonly<Record<string, string | number>>;
  /** positive = lpMoss, negative = lpDestructive, quiet = lpPaper3 (iOS `stateChip`). */
  readonly tone: ChipTone;
}

export function chipCopy(chip: ClassFeedChip): ChipCopy {
  switch (chip.kind) {
    case 'open':
      return { key: 'classes.chip_open', tone: 'positive' };
    case 'left':
      return { key: 'classes.chip_left', params: { count: String(chip.count) }, tone: 'positive' };
    case 'full':
      return { key: 'classes.chip_full', tone: 'negative' };
    case 'notOpen':
      return { key: 'classes.chip_not_open', tone: 'quiet' };
    case 'registrationClosed':
      return { key: 'classes.chip_reg_closed', tone: 'negative' };
    case 'unavailable':
      return { key: 'classes.chip_unavailable', tone: 'quiet' };
  }
}
