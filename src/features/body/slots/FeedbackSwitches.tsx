/**
 * Body and goals' "Monthly feedback" section (iOS BodyAndGoalsView
 * `feedbackSection`, `SPEC` 9.5): the three switches, read from and written
 * to the server (FB-2), "Past months" in its own sheet, the error line and
 * the footer. Filled by FEED-1, mounted by BODY-1 (plan 3.0.3).
 *
 * Shown with consent whatever the membership: a lapsed member can always read
 * their feedback and switch it off (`SPEC` D18). Nothing at all while the
 * server does not advertise `health_feedback`. The toggles wait for the first
 * read rather than showing a guess, and a toggle whose save is in flight holds
 * still. The switches come from FB-1, which this page may be the first to
 * need (it opens from Account without Plan ever showing), so the section
 * reads it itself, again when the account language changes.
 *
 * Turning the report or the note ON asks for notification permission, once
 * and only if the member never answered: this is the one place the feedback
 * asks. Food and weight never ask (no notification is about them).
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { feedbackSettings, foodAndWeightOffByDefault } from '../../../api/feedback';
import { announce, Card, hiddenFromAccessibility, Kicker, LPText, ToggleRow } from '../../../components/ui';
import { useT } from '../../../i18n';
import { requestIfUndetermined } from '../../../notifications/permissions';
import { selectHasHealthConsent, useAppStore } from '../../../stores/appStore';
import { colors, hairline } from '../../../theme';
import { FeedbackHistorySheet, notifyFeedbackChanged, useFeedbackStore, useSupportsFeedback } from '../../feedback';

export type FeedbackSwitchesProps = {
  testID?: string;
};

export default function FeedbackSwitches({ testID = 'bodygoals.feedback' }: FeedbackSwitchesProps) {
  const { t, language } = useT();
  const supports = useSupportsFeedback();
  const hasConsent = useAppStore(selectHasHealthConsent);
  const settings = useFeedbackStore((s) => s.summary?.settings ?? null);
  const saving = useFeedbackStore((s) => s.savingSettings);
  const errorKey = useFeedbackStore((s) => s.settingsErrorKey);
  const [historyOpen, setHistoryOpen] = useState(false);

  // iOS `.task(id: appState.language)`.
  useEffect(() => {
    if (supports && hasConsent) void useFeedbackStore.getState().refresh();
  }, [supports, hasConsent, language]);

  // A failed save is said to TalkBack as well as shown.
  const lastError = useRef<string | null>(null);
  useEffect(() => {
    if (errorKey && errorKey !== lastError.current) announce(t(errorKey));
    lastError.current = errorKey;
  }, [errorKey, t]);

  if (!supports || !hasConsent) return null;

  const loaded = settings !== null;
  const shown = settings ?? feedbackSettings();
  const store = useFeedbackStore.getState();
  const askForNotifications = () => {
    void requestIfUndetermined().then(() => notifyFeedbackChanged());
  };
  const foodSubtitle = foodAndWeightOffByDefault(shown)
    ? `${t('bodygoals.fb_food_sub')} ${t('bodygoals.fb_food_offer')}`
    : t('bodygoals.fb_food_sub');

  return (
    <View style={styles.section} testID={testID}>
      <Kicker text={t('bodygoals.sec.feedback')} color={colors.paper3} style={styles.kicker} />
      <Card>
        <ToggleRow
          title={t('bodygoals.fb_monthly')}
          subtitle={t('bodygoals.fb_monthly_sub')}
          value={shown.monthlyReport}
          disabled={!loaded || saving.includes('monthly')}
          onValueChange={(on) => {
            if (on === shown.monthlyReport) return;
            if (on) askForNotifications();
            void store.setMonthly(on);
          }}
          testID="bodygoals.fb_monthly"
        />
        <View style={styles.divider} />
        <ToggleRow
          title={t('bodygoals.fb_note')}
          subtitle={t('bodygoals.fb_note_sub')}
          value={shown.midMonthNote}
          disabled={!loaded || saving.includes('note')}
          onValueChange={(on) => {
            if (on === shown.midMonthNote) return;
            if (on) askForNotifications();
            void store.setNote(on);
          }}
          testID="bodygoals.fb_note"
        />
        <View style={styles.divider} />
        <ToggleRow
          title={t('bodygoals.fb_food')}
          subtitle={foodSubtitle}
          value={shown.includeFoodAndWeight}
          disabled={!loaded || saving.includes('food')}
          onValueChange={(on) => {
            if (on === shown.includeFoodAndWeight) return;
            void store.setIncludeFoodAndWeight(on);
          }}
          testID="bodygoals.fb_food"
        />
        <View style={styles.divider} />
        <PastMonthsRow label={t('bodygoals.fb_past')} onPress={() => setHistoryOpen(true)} />
        <View style={styles.notes}>
          {errorKey ? (
            <LPText size={13} color={colors.destructive} testID="bodygoals.fb_err">
              {t(errorKey)}
            </LPText>
          ) : null}
          <LPText size={11} color={colors.paper3}>
            {t('bodygoals.fb_footer')}
          </LPText>
        </View>
      </Card>
      <FeedbackHistorySheet visible={historyOpen} onClose={() => setHistoryOpen(false)} />
    </View>
  );
}

/** "Past months": a row with a chevron (iOS `AccountRowButton`). */
function PastMonthsRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID="bodygoals.fb_past"
    >
      <LPText size={14} weight="medium" color={colors.paper} style={styles.rowTitle}>
        {label}
      </LPText>
      <View {...hiddenFromAccessibility}>
        <Ionicons name="chevron-forward" size={13} color={colors.paper3} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  kicker: { paddingHorizontal: 4 },
  divider: { height: hairline, backgroundColor: colors.line, marginHorizontal: 16 },
  notes: { gap: 6, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  rowTitle: { flex: 1 },
  pressed: { opacity: 0.75 },
});
