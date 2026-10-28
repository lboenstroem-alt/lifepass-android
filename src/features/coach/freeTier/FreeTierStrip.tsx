/* eslint lifepass/no-literal-copy: "error" */
/**
 * A free account's allowance, above the input (iOS CoachView.swift
 * `freeTierStrip`). Members and pass holders never see either half.
 *
 * - While messages are left: one centred line, "{count} free messages left
 *   this month" (the plural rule of the account language).
 * - Once they are used: a card with "You've used your free Coach messages",
 *   the membership line, "Your next free message is ready on {date}." when
 *   the next one frees up later (the Icelandic short date's own trailing full
 *   stop dropped, the sentence brings one), and a white "Get a membership"
 *   button. Never "tomorrow": tomorrow brings a free account nothing.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import type { CoachFreeMessages } from '../../../api';
import { LPText } from '../../../components/ui';
import { HealthFormat, useT, type Lang } from '../../../i18n';
import { coachPalette } from '../theme/palette';

/** The card's body: the membership line, and when the next free message is ready (iOS `freeLimitBody`). */
export function freeLimitBody(
  counts: CoachFreeMessages | null,
  lang: Lang,
  t: (key: string, params?: Readonly<Record<string, string | number>>) => string,
  now: number = Date.now(),
): string {
  let text = t('coach.free.limit.body');
  const resetsAt = counts?.resetsAt;
  if (resetsAt && resetsAt.getTime() > now) {
    let day = HealthFormat.shortDay(resetsAt, lang);
    while (day.endsWith('.')) day = day.slice(0, -1);
    text += ` ${t('coach.free.limit.next', { date: day })}`;
  }
  return text;
}

type Props = {
  freeMessages: CoachFreeMessages | null;
  freeLimitReached: boolean;
  onGetMembership: () => void;
};

export default function FreeTierStrip({ freeMessages, freeLimitReached, onGetMembership }: Props) {
  const { t, tp, language } = useT();

  if (freeLimitReached) {
    return (
      <View style={styles.card} testID="coach.free.limit">
        <LPText size={15} weight="semibold" color="#FFFFFF" accessibilityRole="header">
          {t('coach.free.limit.title')}
        </LPText>
        <LPText size={13} color={coachPalette.freeBody}>
          {freeLimitBody(freeMessages, language, t)}
        </LPText>
        <View style={styles.ctaRow}>
          <Pressable
            onPress={onGetMembership}
            style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
            accessibilityRole="button"
            accessibilityLabel={t('coach.free.limit.cta')}
            testID="coach.free.limit.cta"
          >
            <LPText size={14} weight="semibold" color={coachPalette.ink} numberOfLines={1}>
              {t('coach.free.limit.cta')}
            </LPText>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!freeMessages) return null;
  return (
    <LPText size={12} weight="medium" color={coachPalette.freeLine} align="center" style={styles.left} testID="coach.free.left">
      {tp('coach.free.left', freeMessages.remaining)}
    </LPText>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 4,
    padding: 14,
    gap: 8,
    borderRadius: 18,
    backgroundColor: coachPalette.cardFill,
    borderWidth: 0.8,
    borderColor: coachPalette.cardStroke,
  },
  ctaRow: { flexDirection: 'row', paddingTop: 2 },
  cta: {
    minHeight: 44,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPressed: { opacity: 0.85 },
  left: { paddingBottom: 2, alignSelf: 'stretch' },
});
