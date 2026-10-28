/**
 * "Included with a LifePass membership": the one sheet a member without a
 * membership meets instead of any meal screen (iOS `MealGateSheet`). As tall
 * as its content. The copy per access value is in ./mealGate.ts.
 *
 * The button closes the gate, then opens where it leads: the membership
 * catalogue, or Account to activate a company plan or fix a payment. The
 * caller passes both (the app shell's navigation); Cancel only closes.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRef } from 'react';
import { Pressable, StyleSheet, View, type Text } from 'react-native';

import { hiddenFromAccessibility, LPText, PrimaryButton, Sheet } from '../../components/ui';
import { useT } from '../../i18n';
import { colors, radius } from '../../theme';
import type { HealthAccess } from '../models';

import { mealGateCopy } from './mealGate';

export type MealGateSheetProps = {
  visible: boolean;
  access: HealthAccess;
  onClose: () => void;
  /** The membership catalogue (the Plans sheet). */
  onSeeMemberships: () => void;
  /** Account, where a company plan is activated and a payment fixed. */
  onOpenAccount: () => void;
  /** Runs once the sheet has fully left the screen. */
  onClosed?: () => void;
  testID?: string;
};

export default function MealGateSheet({
  visible,
  access,
  onClose,
  onSeeMemberships,
  onOpenAccount,
  onClosed,
  testID,
}: MealGateSheetProps) {
  const { t } = useT();
  const copy = mealGateCopy(access);
  const titleRef = useRef<Text>(null);
  // The destination opens once the gate has gone, so two sheets never fight.
  const next = useRef<(() => void) | null>(null);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      initialFocusRef={titleRef}
      onClosed={() => {
        const go = next.current;
        next.current = null;
        go?.();
        onClosed?.();
      }}
      testID={testID}
    >
      <View style={styles.content}>
        <View {...hiddenFromAccessibility} style={styles.badge}>
          <Ionicons name="restaurant" size={22} color={colors.onAccent} />
        </View>
        <LPText ref={titleRef} serif size={22} color={colors.paper} accessibilityRole="header">
          {t(copy.titleKey)}
        </LPText>
        <LPText size={15} color={colors.paper2} style={styles.body}>
          {t(copy.bodyKey)}
        </LPText>
        <PrimaryButton
          title={t(copy.ctaKey)}
          onPress={() => {
            next.current = copy.opens === 'account' ? onOpenAccount : onSeeMemberships;
            onClose();
          }}
          testID="mealgate.cta"
        />
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.cancel}>
          <LPText size={13} weight="semibold" color={colors.paper2} align="center">
            {t('common.cancel')}
          </LPText>
        </Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingTop: 12, paddingHorizontal: 4 },
  badge: {
    width: 52,
    height: 52,
    borderRadius: radius.card,
    backgroundColor: colors.rust,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { marginBottom: 8 },
  cancel: { minHeight: 44, justifyContent: 'center' },
});
