/**
 * The payment sheet: the card-on-file mandate, the save-card switch for a
 * pass, and the partner discount code, before every in-app checkout. The
 * Android port of iOS PlansView's `cardMandateSheet`, `discountCodeBox` and
 * `mandateContinueButton` (Views/Plans/PlansView.swift, PR #41 and 2.5.2).
 *
 * - The mandate paragraph says why the card is kept: a membership's renewal
 *   and surcharges, or a pass's one-tap surcharges.
 * - A PASS gets the save-card switch, ON by default and reset to ON at every
 *   opening (./usePlanCheckout.tsx). A membership has none: its renewal
 *   needs the card, so it always vaults.
 * - The code box, for a membership and a pass alike, with its own hint. A
 *   refused code is answered right under it, in words for that refusal, with
 *   the code still in the box, a red outline and **Clear code**: paying the
 *   full price is the member's choice, never a silent retry.
 * - Continue keeps one name for TalkBack while its spinner shows, and stays
 *   pinned in reach whatever the sheet's height and the text size.
 *
 * A pass opens at full height, a membership at half height and scrolls (iOS
 * `.large` / `.medium`). While the checkout is being created the sheet cannot
 * be closed (pan, backdrop and back are refused) and the box takes no input.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, type RefObject } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Pressable,
  StyleSheet,
  Switch,
  View,
  type TextInput,
} from 'react-native';

import { hiddenFromAccessibility, LPText, PrimaryButton, Sheet, SheetTextInput } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors, hairline, radius, sans } from '../../../theme';

import { isSubscription, type Plan } from '../plans';
import { discountCodeMessageKey, type DiscountCodeProblem } from './discountCode';

/** iOS waits this long after Clear code before moving VoiceOver: the button has left the tree by then. */
const REFOCUS_DELAY_MS = 150;

const HALF_HEIGHT = ['50%'];

export interface PaymentSheetProps {
  readonly plan: Plan;
  readonly visible: boolean;
  /** The member asked to close it (pan, backdrop, back). */
  readonly onClose: () => void;
  /** The sheet has fully gone: what follows it (the page, Kenni, the alert) may show now. */
  readonly onClosed: () => void;
  readonly saveCard: boolean;
  readonly onSaveCardChange: (value: boolean) => void;
  readonly discountCode: string;
  readonly onDiscountCodeChange: (code: string) => void;
  readonly problem: DiscountCodeProblem | null;
  /** Bumped by Clear code: focus moves to the empty box. */
  readonly codeFieldFocusRequest: number;
  readonly onClearCode: () => void;
  /** The checkout is being created: spinner, no closing, the box disabled. */
  readonly creating: boolean;
  readonly onContinue: () => void;
  /** TalkBack focus goes back here once the sheet has gone (the Plans screen's Continue). */
  readonly returnFocusRef?: RefObject<unknown>;
}

export default function PaymentSheet({
  plan,
  visible,
  onClose,
  onClosed,
  saveCard,
  onSaveCardChange,
  discountCode,
  onDiscountCodeChange,
  problem,
  codeFieldFocusRequest,
  onClearCode,
  creating,
  onContinue,
  returnFocusRef,
}: PaymentSheetProps) {
  const { t } = useT();
  const titleRef = useRef<View>(null);
  const inputRef = useRef<TextInput>(null);
  const subscription = isSubscription(plan);
  const problemMessage = problem ? t(discountCodeMessageKey(problem)) : null;

  // Clear code removed itself and the refusal: TalkBack goes on from the
  // empty box, not from wherever it lands. A moment later, once the button
  // has left the tree.
  const firstRequest = useRef(codeFieldFocusRequest);
  useEffect(() => {
    if (codeFieldFocusRequest === firstRequest.current) return;
    const timer = setTimeout(() => {
      const tag = inputRef.current ? findNodeHandle(inputRef.current) : null;
      if (typeof tag === 'number') AccessibilityInfo.setAccessibilityFocus(tag);
    }, REFOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [codeFieldFocusRequest]);

  const continueLabel = t('plans.mandate.continue');

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      onClosed={onClosed}
      busy={creating}
      snapPoints={subscription ? HALF_HEIGHT : undefined}
      fullHeight={!subscription}
      initialFocusRef={titleRef}
      returnFocusRef={returnFocusRef}
      testID="plans.payment_sheet"
      footer={
        <PrimaryButton
          title={continueLabel}
          // One name for TalkBack throughout: the spinner swapping in and out
          // doesn't rename the button under the member's focus.
          accessibilityLabel={continueLabel}
          onPress={onContinue}
          loading={creating}
          tone="action"
          shape="flat"
          testID="plans.mandate.continue"
        />
      }
    >
      <View style={styles.body} testID={`plans.payment_sheet.${plan.id}`}>
        <View ref={titleRef} accessible accessibilityRole="header">
          <LPText serif size={24} style={styles.title}>
            {t('plans.mandate.title')}
          </LPText>
        </View>

        <LPText size={14} color={colors.paper2} style={styles.mandate}>
          {t(subscription ? 'plans.mandate.subscription' : 'plans.mandate.pass')}
        </LPText>

        {!subscription && (
          <Pressable
            onPress={() => onSaveCardChange(!saveCard)}
            disabled={creating}
            accessibilityRole="switch"
            accessibilityLabel={t('plans.mandate.save_card')}
            accessibilityState={{ checked: saveCard, disabled: creating }}
            testID="plans.mandate.save_card"
            style={styles.toggle}
          >
            <LPText size={13} color={colors.paper2} style={styles.shrink}>
              {t('plans.mandate.save_card')}
            </LPText>
            <Switch
              value={saveCard}
              onValueChange={onSaveCardChange}
              disabled={creating}
              trackColor={{ true: colors.rust, false: colors.line2 }}
              thumbColor={colors.onAccent}
              // The row speaks for the switch; the switch alone would be a second stop.
              accessible={false}
              importantForAccessibility="no-hide-descendants"
            />
          </Pressable>
        )}

        <View style={styles.codeBox}>
          <LPText size={13} weight="medium" color={colors.paper2} {...hiddenFromAccessibility}>
            {t('plans.promo.label')}
          </LPText>
          <SheetTextInput
            ref={inputRef}
            value={discountCode}
            onChangeText={onDiscountCodeChange}
            placeholder={t('plans.promo.placeholder')}
            placeholderTextColor={colors.paper3}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            returnKeyType="done"
            editable={!creating}
            accessibilityLabel={t('plans.promo.label')}
            // The refusal is the box's hint until the code changes.
            accessibilityHint={problemMessage ?? undefined}
            accessibilityState={{ disabled: creating }}
            testID="plans.promo.input"
            style={[styles.input, problem ? styles.inputRefused : null, creating && styles.inputDisabled]}
          />

          {problem && problemMessage ? (
            <>
              <View style={styles.refusal} accessible testID="plans.promo.problem">
                <Ionicons
                  name="alert-circle"
                  size={13}
                  color={colors.destructive}
                  style={styles.refusalIcon}
                  {...hiddenFromAccessibility}
                />
                <LPText size={13} color={colors.destructive} style={styles.shrink}>
                  {problemMessage}
                </LPText>
              </View>
              {/* The way out of a refusal: it reads as a line of text but is a full target. */}
              <Pressable
                onPress={onClearCode}
                disabled={creating}
                accessibilityRole="button"
                testID="plans.promo.clear"
                style={styles.clear}
              >
                <LPText size={13} weight="semibold" color={colors.accentText}>
                  {t('plans.promo.clear')}
                </LPText>
              </Pressable>
            </>
          ) : (
            <LPText size={11} color={colors.paper3}>
              {t(subscription ? 'plans.promo.hint' : 'plans.promo.hint_pass')}
            </LPText>
          )}
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 18, paddingTop: 8 },
  title: { color: colors.paper },
  mandate: { lineHeight: 20 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  shrink: { flex: 1, flexShrink: 1 },
  codeBox: { gap: 6, paddingTop: 4 },
  input: {
    ...sans(15),
    color: colors.paper,
    minHeight: 46,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.ink2,
    borderRadius: radius.field,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  inputRefused: { borderWidth: 1, borderColor: colors.destructive },
  inputDisabled: { opacity: 0.6 },
  refusal: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  refusalIcon: { marginTop: 2 },
  // iOS's 44 pt; Android's 48 dp.
  clear: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
});
