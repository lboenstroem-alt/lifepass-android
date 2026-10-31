/**
 * Account's Body and goals row (iOS AccountView, the first row of the
 * Account section), filled by BODY-1.
 *
 * Body and goals comes first in its card (`ios-ux.md` 10.2): consent, the
 * body log, the reminders, the export and the health deletion live there,
 * and a control room a member cannot find is not a control room.
 *
 * - A verified minor has nothing to manage: the row states why ("For members
 *   aged 18 and over"), at 55 %, with no chevron, and opens nothing.
 * - Otherwise it opens Body and goals: "Tracking on" with consent, else what
 *   tracking is for. iOS's line names Apple Health; Android's says "Workout
 *   plan and food log" (owner decision: no Health Connect, and nothing here
 *   names Apple Health).
 *
 * Drawn through Account's row primitives, so its hairline sits above it and
 * the card hides it (src/features/account/rows.tsx, the slot contract).
 */
import { useT } from '../../../i18n';
import { useAppNavigation } from '../../../navigation/hooks';
import { selectHasHealthConsent, useAppStore } from '../../../stores/appStore';
import { AccountRowButton, AccountRowLabel } from '../rows';

export default function BodyGoalsRow() {
  const { t } = useT();
  const navigation = useAppNavigation();
  const access = useAppStore((s) => s.healthAccess);
  const hasConsent = useAppStore(selectHasHealthConsent);
  const title = t('bodygoals.row');

  if (access === 'minor') {
    return (
      <AccountRowLabel
        title={title}
        subtitle={t('health.minor.title')}
        showsChevron={false}
        opacity={0.55}
        testID="account.row.bodyGoals"
      />
    );
  }
  return (
    <AccountRowButton
      title={title}
      subtitle={t(hasConsent ? 'bodygoals.row_sub_on' : 'bodygoals.android.row_sub_off')}
      onPress={() => navigation.navigate('BodyAndGoals')}
      testID="account.row.bodyGoals"
    />
  );
}
