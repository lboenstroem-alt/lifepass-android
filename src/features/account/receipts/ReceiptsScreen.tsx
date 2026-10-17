/* eslint lifepass/no-literal-copy: "error" */
/**
 * Route `Receipts`: the member's purchase history, the Android port of iOS
 * `ReceiptsView` (Views/Profile/ReceiptsView.swift), pushed from Account's
 * "Receipts & invoices". Electronic receipts must be available to print or
 * email, which the help footer covers.
 *
 * The orders from `GET /purchases`, newest first. Monthly renewals of a
 * self-paid plan are not orders and are not listed (Kling emails a receipt
 * for each), which the footer says.
 *
 *   loading      a spinner
 *   empty        "No purchases yet." and the help footer, ONLY after a
 *                successful empty answer
 *   list         product, date and amount ("Free" at 0, greyed when not
 *                paid) with a status line; "Show more" while the server has
 *                more; the renewals note and the help footer; pull to refresh
 *   unavailable  (404) "Your purchase history is on the website for now."
 *   failed       "We couldn't load your purchases here…" and Try again
 * Both fallbacks link to lifepass.is/purchases: a failed read never says
 * there are no purchases (./receiptsModel).
 */
import { Ionicons } from '@expo/vector-icons';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isPurchasePaid, type Purchase } from '../../../api/purchases';
import { EmptyState, LPText } from '../../../components/ui';
import { MerchantInfo } from '../../../config/merchantInfo';
import { iskPrefix, useT, VenueTimeFormat } from '../../../i18n';
import type { SharedRouteProps } from '../../../navigation/types';
import { colors, hairline } from '../../../theme';
import InlineTitleBar from '../billing/InlineTitleBar';
import { receiptStatusKey, ReceiptsViewModel, WEB_PURCHASES_URL } from './receiptsModel';

/** Opens a web or mailto link; a phone with nothing to open it with simply stays here. */
function openLink(url: string): void {
  Linking.openURL(url).catch(() => undefined);
}

const MAILTO = `mailto:${MerchantInfo.email}`;

export default function ReceiptsScreen({ navigation }: SharedRouteProps<'Receipts'>) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  // The tab bar floats over the page; outside the tabs (the shared sheet) it is the system bar.
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? insets.bottom;
  const [model] = useState(() => new ReceiptsViewModel());
  const { state, hasMore, isLoadingMore } = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void model.load();
    return () => model.dispose();
  }, [model]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await model.load();
    } finally {
      setRefreshing(false);
    }
  }, [model]);

  const bottomPadding = tabBarHeight + 24;

  let body: ReactNode;
  switch (state.kind) {
    case 'loading':
      body = (
        <View style={styles.centre} testID="receipts.loading">
          <ActivityIndicator color={colors.rust} accessibilityLabel={t('a11y.loading')} />
        </View>
      );
      break;
    case 'loaded':
      body =
        state.purchases.length === 0 ? (
          <ScrollView contentContainerStyle={[styles.centredScroll, { paddingBottom: bottomPadding }]} testID="receipts.empty">
            <EmptyState icon="document-text-outline" message={t('receipts.empty')} />
            <HelpFooter />
          </ScrollView>
        ) : (
          <FlatList
            data={state.purchases}
            keyExtractor={(purchase) => purchase.id}
            renderItem={({ item, index }) => (
              <ReceiptRow purchase={item} first={index === 0} last={index === state.purchases.length - 1 && !hasMore} />
            )}
            ListFooterComponent={
              <>
                {hasMore ? <ShowMoreRow onPress={() => void model.loadMore()} disabled={isLoadingMore} /> : null}
                <View style={styles.footer}>
                  <LPText size={13} color={colors.mutedTextStrong}>
                    {t('receipts.renewals_note')}
                  </LPText>
                  <HelpFooter />
                </View>
              </>
            }
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} colors={[colors.rust]} />}
            contentContainerStyle={[styles.list, { paddingBottom: bottomPadding }]}
            testID="receipts.list"
          />
        );
      break;
    case 'unavailable':
      body = <WebFallback message={t('receipts.web_only')} bottomPadding={bottomPadding} />;
      break;
    case 'failed':
      body = <WebFallback message={t('receipts.load_failed')} onRetry={() => void model.load()} bottomPadding={bottomPadding} />;
      break;
  }

  return (
    <View style={styles.page} testID="receipts-screen">
      <InlineTitleBar title={t('receipts.title')} onBack={() => navigation.goBack()} testID="receipts.bar" />
      {body}
    </View>
  );
}

/** One order: product and date on the left, the amount and its status on the right; read as one item. */
function ReceiptRow({ purchase, first, last }: { purchase: Purchase; first: boolean; last: boolean }) {
  const { t, language } = useT();
  const statusKey = receiptStatusKey(purchase.status);
  return (
    <View
      accessible
      style={[styles.row, first && styles.rowFirst, last && styles.rowLast, !first && styles.rowDivider]}
      testID={`receipts.row.${purchase.id}`}
    >
      <View style={styles.rowLeading}>
        <LPText size={15} weight="semibold">
          {purchase.productName}
        </LPText>
        <LPText size={12} color={colors.paper3}>
          {VenueTimeFormat.date(purchase.createdAt, language)}
        </LPText>
      </View>
      <View style={styles.rowTrailing}>
        <LPText size={15} weight="semibold" color={isPurchasePaid(purchase) ? colors.paper : colors.paper3} align="right">
          {purchase.amountIsk > 0 ? iskPrefix(purchase.amountIsk) : t('receipts.free')}
        </LPText>
        {statusKey ? (
          <LPText size={12} color={colors.paper3} align="right">
            {t(statusKey)}
          </LPText>
        ) : null}
      </View>
    </View>
  );
}

/** "Show more", the last row of the list while the server has more. Disabled while a page loads. */
function ShowMoreRow({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  const { t } = useT();
  const label = t('receipts.load_more');
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: disabled }}
      style={({ pressed }) => [styles.row, styles.rowLast, styles.rowDivider, pressed && styles.pressed]}
      testID="receipts.loadMore"
    >
      <LPText size={16} color={disabled ? colors.paper3 : colors.accentText}>
        {label}
      </LPText>
    </Pressable>
  );
}

/** When the list cannot be read: the website's history, and Try again after a failure. */
function WebFallback({ message, onRetry, bottomPadding }: { message: string; onRetry?: () => void; bottomPadding: number }) {
  const { t } = useT();
  const openWeb = t('receipts.open_web');
  return (
    <ScrollView
      contentContainerStyle={[styles.centredScroll, styles.fallback, { paddingBottom: bottomPadding }]}
      testID="receipts.webFallback"
    >
      <DocumentGlyph />
      <LPText size={15} weight="medium" color={colors.paper3} align="center">
        {message}
      </LPText>
      <Pressable
        onPress={() => openLink(WEB_PURCHASES_URL)}
        accessibilityRole="link"
        accessibilityLabel={openWeb}
        hitSlop={8}
        testID="receipts.web"
      >
        <LPText size={14} weight="semibold" color={colors.accentText} align="center">
          {openWeb}
        </LPText>
      </Pressable>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={t('venue.try_again')}
          hitSlop={8}
          style={styles.retry}
          testID="receipts.retry"
        >
          <LPText size={13} weight="medium" color={colors.accentText} align="center">
            {t('venue.try_again')}
          </LPText>
        </Pressable>
      ) : null}
      <HelpFooter />
    </ScrollView>
  );
}

/** The large faint document glyph iOS draws above the fallback's message (decoration to TalkBack). */
function DocumentGlyph() {
  return (
    <Ionicons
      name="document-text-outline"
      size={44}
      color={colors.paper4}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

/** "Need a copy by email?" and "Contact Contact@sport-a.com" (a mailto link). */
function HelpFooter() {
  const { t } = useT();
  const contact = t('receipts.contact', { email: MerchantInfo.email });
  return (
    <View style={styles.help}>
      <LPText size={12} color={colors.paper3} align="center">
        {t('receipts.email_help')}
      </LPText>
      <Pressable onPress={() => openLink(MAILTO)} accessibilityRole="link" accessibilityLabel={contact} hitSlop={8} testID="receipts.contact">
        <LPText size={12} weight="medium" color={colors.accentText} align="center">
          {contact}
        </LPText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.ink,
  },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centredScroll: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  list: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.ink2,
    borderLeftWidth: hairline,
    borderRightWidth: hairline,
    borderColor: colors.line,
  },
  rowFirst: {
    borderTopWidth: hairline,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  rowLast: {
    borderBottomWidth: hairline,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  rowDivider: {
    borderTopWidth: hairline,
    borderTopColor: colors.line,
  },
  rowLeading: {
    flex: 1,
    gap: 3,
  },
  rowTrailing: {
    alignItems: 'flex-end',
    gap: 3,
    flexShrink: 0,
    maxWidth: '50%',
  },
  footer: {
    gap: 10,
    paddingHorizontal: 4,
    paddingTop: 16,
  },
  fallback: {
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  retry: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  help: {
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: 6,
    paddingTop: 16,
  },
  pressed: {
    opacity: 0.7,
  },
});
