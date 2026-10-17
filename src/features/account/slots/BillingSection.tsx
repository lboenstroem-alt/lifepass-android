/* eslint lifepass/no-literal-copy: "error" */
/**
 * Account's billing section, "what am I paying, and what is it charged to?":
 * the Android port of iOS `AccountView.billingSection` and `cardActions`
 * (Views/Profile/AccountView.swift). Mounted by Account (ACCT-1) with no
 * props, between the company banner and Membership; it reads what it needs
 * itself.
 *
 * Deliberately three plain rows rather than a card: reference information a
 * member comes looking for, not something to merchandise. What it says is
 * decided in ../billing/billingModel.
 *
 * THE READ. `GET /billing/summary` on every appearance of Account (iOS
 * `.task`), best-effort: a failure, or an older server without the route,
 * leaves the section hidden rather than guessing.
 *
 * THE CARD. Add card / Replace card goes through the money rail's card setup
 * page (src/payments `cardSetupOnHostedPage`): a fresh Idempotency-Key per
 * tap, Kling's hosted page in a Custom Tab, and on ANY dismissal (either
 * return link, or the tab simply closed) the verified confirm, because the
 * way the page closed proves nothing. The summary is read again after it.
 * "Opening…" shows until the page is up; a page that could not open says so.
 *
 * Remove card takes two taps: the first arms "Tap again to remove", the
 * second removes and re-reads. It fails closed: an error means the card is
 * still saved, with the 409's own words when a membership needs the card.
 * Errors show in red under the actions.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';

import { fetchBillingSummary, removeCard, type BillingSummary } from '../../../api/billing';
import { isCancellation } from '../../../api/errors';
import { announce, Kicker, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { cardSetupOnHostedPage } from '../../../payments';
import { useAppStore } from '../../../stores/appStore';
import { colors, radius } from '../../../theme';
import { billingView, removeFailureKey, type BillingRow } from '../billing/billingModel';

/**
 * What the card buttons are busy with. `opening`: the setup session is being
 * made (the page is not up yet). `page`: the page is up, or the member is
 * back and the confirm runs. `removing`: the removal is in flight.
 */
type CardBusy = 'opening' | 'page' | 'removing' | null;

/** The destructive red at half strength, iOS's outline of Remove card. */
const DESTRUCTIVE_OUTLINE = 'rgba(208,37,37,0.5)';

export default function BillingSection() {
  const { t, language } = useT();
  const memberId = useAppStore((s) => s.userId);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [busy, setBusy] = useState<CardBusy>(null);
  /** Two-tap remove: the first tap arms, the second fires. */
  const [armed, setArmed] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const mounted = useRef(true);
  /** A synchronous guard: a second tap in the same frame must not open a second page. */
  const busyNow = useRef(false);
  /** The newest read wins (a re-read after removal racing an appearance's read). */
  const reads = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadBilling = useCallback(async () => {
    const read = ++reads.current;
    try {
      const next = await fetchBillingSummary();
      if (mounted.current && read === reads.current) setSummary(next);
    } catch (error) {
      if (!mounted.current || read !== reads.current || isCancellation(error)) return;
      // Best-effort, as iOS's `try?`: the section hides rather than guesses.
      setSummary(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadBilling();
    }, [loadBilling]),
  );

  // The Custom Tab coming up sends the app to the background: from then on
  // the button no longer says "Opening…" (iOS's cover hides the button, and
  // it reads Add or Replace again when the cover closes).
  useEffect(() => {
    if (busy !== 'opening') return;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') setBusy((current) => (current === 'opening' ? 'page' : current));
    });
    return () => subscription.remove();
  }, [busy]);

  const startCardSetup = useCallback(async () => {
    if (busyNow.current || !memberId) return;
    busyNow.current = true;
    setBusy('opening');
    setErrorKey(null);
    try {
      const result = await cardSetupOnHostedPage({ memberId, isScreenAlive: () => mounted.current });
      if (!mounted.current) return;
      if (result.kind === 'notOpened') setErrorKey('account.card_add_failed');
      // Confirmed: whatever the pull found (a card, none, or a failed pull),
      // the summary is what the section draws, so it is read again.
      else if (result.kind === 'confirmed') await loadBilling();
    } finally {
      busyNow.current = false;
      if (mounted.current) setBusy(null);
    }
  }, [loadBilling, memberId]);

  const removeTapped = useCallback(async () => {
    if (busyNow.current) return;
    if (!armed) {
      setArmed(true);
      announce(t('account.card_remove_confirm'));
      return;
    }
    busyNow.current = true;
    setBusy('removing');
    setErrorKey(null);
    try {
      await removeCard();
      await loadBilling();
    } catch (error) {
      // Fail-closed contract: an error means the card is still saved.
      if (mounted.current) setErrorKey(removeFailureKey(error));
    } finally {
      busyNow.current = false;
      if (mounted.current) {
        setBusy(null);
        setArmed(false);
      }
    }
  }, [armed, loadBilling, t]);

  const view = billingView(summary, language);
  if (!view) return null;

  const isBusy = busy !== null;
  // iOS's `isCardBusy`: the start of a setup and a removal both read "Opening…".
  const addLabel =
    busy === 'opening' || busy === 'removing'
      ? t('account.card_busy')
      : t(view.hasCard ? 'account.card_replace' : 'account.card_add');
  const removeLabel = armed ? t('account.card_remove_confirm') : t('account.card_remove');
  const error = errorKey ? t(errorKey) : null;

  return (
    <View style={styles.section} testID="billing.section">
      <Kicker text={t('account.billing_kicker')} color={colors.paper2} accessibilityRole="header" />

      {view.rows.map((row) => (
        <BillingRowView key={row.id} row={row} />
      ))}

      <View style={styles.actions}>
        <Pressable
          onPress={() => void startCardSetup()}
          disabled={isBusy}
          accessibilityRole="button"
          accessibilityLabel={addLabel}
          accessibilityState={{ disabled: isBusy, busy: busy === 'opening' }}
          hitSlop={6}
          style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
          testID="billing.card.add"
        >
          <LPText size={13} weight="semibold" color={colors.ink}>
            {addLabel}
          </LPText>
        </Pressable>

        {view.canRemove ? (
          <Pressable
            onPress={() => void removeTapped()}
            disabled={isBusy}
            accessibilityRole="button"
            accessibilityLabel={removeLabel}
            accessibilityState={{ disabled: isBusy, busy: busy === 'removing' }}
            hitSlop={6}
            style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
            testID="billing.card.remove"
          >
            <LPText size={13} weight="semibold" color={colors.destructive}>
              {removeLabel}
            </LPText>
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <LPText size={12} color={colors.destructive} accessibilityLiveRegion="polite" testID="billing.error">
          {error}
        </LPText>
      ) : null}
    </View>
  );
}

/** Label on the left, value on the right, a rule under; read by TalkBack as one line. */
function BillingRowView({ row }: { row: BillingRow }) {
  return (
    <View accessible style={styles.row} testID={`billing.row.${row.id}`}>
      <LPText size={13} color={colors.paper3}>
        {row.label}
      </LPText>
      <LPText size={14} weight="medium" align="right" style={styles.value}>
        {row.value}
      </LPText>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  value: {
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    paddingTop: 6,
  },
  addButton: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.paper,
  },
  removeButton: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: DESTRUCTIVE_OUTLINE,
  },
  pressed: {
    opacity: 0.7,
  },
});
