/**
 * The weight history's words and rules (iOS `MeasurementsView`), apart from
 * the screen.
 */
import { isCancellation, isProblem } from '../../../api';
import type { Measurement, MeasurementSource } from '../../../health';
import { HealthFormat, type Lang } from '../../../i18n';

import type { Translate } from '../model';

/**
 * Where a weigh-in came from, as a word key (iOS `subtitle`): the weekly
 * check-in, the plan's setup, a connected health app, else the member. iOS
 * names Apple Health for the third; Android's neutral word is BODY-1's.
 */
export function measurementSourceKey(source: MeasurementSource | null): string {
  switch (source) {
    case 'weekly_prompt':
      return 'bodygoals.source.weekly_prompt';
    case 'program_intake':
      return 'bodygoals.source.program_intake';
    case 'wearable':
      return 'bodygoals.android.source.wearable';
    default:
      return 'bodygoals.source.self_reported';
  }
}

/** "17 September · Weekly check-in" (the date is the server's day; '' without one). */
export function measurementSubtitle(t: Translate, lang: Lang, row: Pick<Measurement, 'measuredAt' | 'source'>): string {
  const date = row.measuredAt ? HealthFormat.longDay(HealthFormat.serverDay(row.measuredAt), lang) : '';
  return `${date} · ${t(measurementSourceKey(row.source))}`;
}

/** "72,5 kg", or '' for a row without a weight. */
export function measurementTitle(lang: Lang, row: Pick<Measurement, 'weightKg'>): string {
  return row.weightKg === null ? '' : HealthFormat.weight(row.weightKg, lang);
}

/** The delete question's message: only a wearable's weigh-in has one (it will not be added again). */
export function deleteMessageKey(row: Pick<Measurement, 'source'> | null): string | null {
  return row?.source === 'wearable' ? 'bodygoals.android.delete_wearable_note' : null;
}

/**
 * What a failed delete means (iOS `delete`): a cancelled call nothing; a row
 * that is already gone IS the outcome the member asked for, so it is just
 * removed; anything else reloads the first page.
 */
export type DeleteFailure = 'silent' | 'removed' | 'reload';

export function deleteFailure(error: unknown): DeleteFailure {
  if (isCancellation(error)) return 'silent';
  if (isProblem(error, 'health_measurement_not_found')) return 'removed';
  return 'reload';
}

/** The rows without `id`. */
export function withoutRow<T extends { readonly id: string }>(rows: readonly T[], id: string): T[] {
  return rows.filter((row) => row.id !== id);
}
