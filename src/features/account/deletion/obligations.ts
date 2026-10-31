/**
 * What the pending state says: the erasure date and one line per
 * obligation, in the account language (iOS `AccountDeletionSheet`
 * `erasureDate` and `obligationLines`). No UI here, so the copy rules are
 * tested on their own.
 */
import type { AccountDeletionState } from '../../../api/accountDeletion';
import { HealthFormat } from '../../../i18n/format';
import { pluralKey, translate, type Lang } from '../../../i18n';

/**
 * "17 November" / "17. nóvember": the scheduled erasure as a server day
 * (Reykjavík is UTC), read the way every health date is (iOS
 * `HealthFormat.longDay(HealthFormat.serverDay(from:))`). Empty when the
 * server named no date, as iOS fills the sentence with "".
 */
export function erasureDateText(state: AccountDeletionState | null | undefined, lang: Lang): string {
  const date = state?.erasureScheduledAt;
  if (!date || Number.isNaN(date.getTime())) return '';
  return HealthFormat.longDay(HealthFormat.serverDay(date), lang);
}

/** "Your account will be erased on {date}." */
export function pendingSentence(state: AccountDeletionState | null | undefined, lang: Lang): string {
  return translate('deletion.pending', lang, { date: erasureDateText(state, lang) });
}

/**
 * One line per obligation the server named, in its order. AN UNKNOWN KIND
 * SHOWS NOTHING: a member should never read a machine word like
 * `future_booking` because this build is older than the server.
 *
 * Bookings are counted with the Icelandic plural rule (21 is singular) and
 * the number in the account language's digits; a missing or zero count
 * reads as one, as iOS's `max(count ?? 1, 1)` does.
 */
export function obligationLines(state: AccountDeletionState | null | undefined, lang: Lang): string[] {
  const lines: string[] = [];
  for (const obligation of state?.obligations ?? []) {
    switch (obligation.kind) {
      case 'subscription':
        lines.push(translate('deletion.obligation.subscription', lang));
        break;
      case 'future_booking': {
        const count = Math.max(obligation.count ?? 1, 1);
        const key = pluralKey('deletion.obligation.future_booking', count, lang);
        lines.push(translate(key, lang, { count: HealthFormat.integer(count, lang) }));
        break;
      }
      case 'pending_charge':
        lines.push(translate('deletion.obligation.pending_charge', lang));
        break;
      case 'pending_order':
        lines.push(translate('deletion.obligation.pending_order', lang));
        break;
      case 'checkout_session':
        lines.push(translate('deletion.obligation.checkout_session', lang));
        break;
      default:
        break;
    }
  }
  return lines;
}
