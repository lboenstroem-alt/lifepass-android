/* eslint lifepass/no-literal-copy: "error" */
/**
 * Account: the port of iOS `AccountView` (Views/Profile/AccountView.swift),
 * pushed from Profile's gear (and from Home's referral card, Coach, Plan and
 * the booking confirmation), so the tab bar stays under it as on iOS.
 *
 * Top to bottom, as iOS draws it:
 *   top bar      circled back chevron, the kicker "Profile", an empty slot
 *   member card  ./MemberCard (Change plan / View plans, caps, past due)
 *   company      ACCT-3's slots/CompanyPlanBanner (pending co-pay or invite)
 *   billing      ACCT-2's slots/BillingSection (what the member pays, the card)
 *   Membership   Change plan (plan holder) then ACCT-3's slots/MembershipActions
 *                (Cancel subscription), or View plans and, when the company
 *                context could not be read, "Have a company plan?"; then
 *                Receipts & invoices and Plan & usage (ACCT-2's screens)
 *   Account      BODY-1's slots/BodyGoalsRow, Refer a friend (once a link has
 *                loaded), AUTH-3's slots/IdentityRow, Language, Notifications
 *                (Android only, decision D4), Help & support, Log out, and
 *                ACCT-4's slots/DeletionRow
 *   footer       Terms · Privacy · Contact, and the legal name
 *
 * Every slot reads what it needs itself and may render nothing; the rows
 * draw their own dividers (./rows.tsx), so a missing slot leaves no line.
 *
 * On every appearance (iOS `.task`), the company context and the referral
 * link are read, best-effort: neither failure is shown, the rows simply stay
 * hidden or fall back.
 *
 * Log out signs out at once, with no confirmation (iOS has none; decision
 * D4): the app store gives the pending food-off its short try, ends the
 * session and runs every sign-out cleaner (src/stores/appStore `signOut`).
 */
import { Ionicons } from '@expo/vector-icons';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useContext, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Dialog, Kicker, LPText } from '../../components/ui';
import { MerchantInfo } from '../../config/merchantInfo';
import { useT, type Lang } from '../../i18n';
import type { SharedRouteProps } from '../../navigation/types';
import { openNotificationSettings } from '../../notifications';
import { selectActivePasses, selectUsage, useAppStore } from '../../stores/appStore';
import { colors } from '../../theme';

import { languageRowSubtitle, planRow, referralSubtitle, type MembershipFacts } from './accountCopy';
import { loadCompanyContext, useCompanyContext } from './companyContext';
import { useLanguageSwitch } from './languageSwitch';
import {
  COMPANY_DASHBOARD_URL,
  openExternal,
  PRIVACY_URL,
  SUPPORT_EMAIL,
  SUPPORT_MAILTO,
  TERMS_URL,
} from './links';
import MemberCard from './MemberCard';
import { shareReferral, useReferral } from './referral';
import { AccountRowButton, AccountSection } from './rows';
import BillingSection from './slots/BillingSection';
import BodyGoalsRow from './slots/BodyGoalsRow';
import CompanyPlanBanner from './slots/CompanyPlanBanner';
import DeletionRow from './slots/DeletionRow';
import IdentityRow from './slots/IdentityRow';
import MembershipActions from './slots/MembershipActions';

export default function AccountScreen({ navigation }: SharedRouteProps<'Account'>) {
  const { t, language } = useT();
  const insets = useSafeAreaInsets();
  // The tab bar floats over the page (src/navigation/CustomTabBar); in the
  // shared sheet there is none and the system bar's inset is answered.
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? insets.bottom;

  const profile = useAppStore((s) => s.profile);
  const subscription = useAppStore((s) => s.subscription);
  const usage = useAppStore(selectUsage);
  const passes = useAppStore(selectActivePasses);
  const companyContextFailed = useCompanyContext((s) => s.failed);

  const referral = useReferral();
  const referralRow = referral.row;
  const languageSwitch = useLanguageSwitch();
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);

  const loadReferral = referral.load;
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        await loadCompanyContext();
        await loadReferral();
      })();
    }, [loadReferral]),
  );

  const facts: MembershipFacts = useMemo(() => ({ subscription, usage, passes }), [subscription, usage, passes]);
  const plan = planRow(facts, language);

  const openPlans = useCallback(() => navigation.navigate('Plans'), [navigation]);
  const chooseLanguage = languageSwitch.choose;
  const pickLanguage = useCallback((code: Lang) => void chooseLanguage(code), [chooseLanguage]);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 8, paddingBottom: tabBarHeight + 40 }]}
        testID="account.scroll"
      >
        <View style={styles.topBar}>
          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            hitSlop={6}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
            testID="account.back"
          >
            <Ionicons name="chevron-back" size={15} color={colors.paper} />
          </Pressable>
          <Kicker text={t('account.title')} color={colors.paper2} accessibilityRole="header" />
          <View style={styles.topBarBalance} />
        </View>

        <MemberCard fullName={profile?.fullName ?? null} email={profile?.email ?? null} facts={facts} onOpenPlans={openPlans} />

        <CompanyPlanBanner />

        <BillingSection />

        <AccountSection kicker={t('account.section_member')} testID="account.membership">
          <AccountRowButton title={plan.title} subtitle={plan.subtitle} onPress={openPlans} testID={`account.row.${plan.kind}Plans`} />
          {plan.kind === 'change' ? <MembershipActions /> : null}
          {plan.kind === 'view' && companyContextFailed ? (
            <AccountRowButton
              title={t('account.company_plan')}
              subtitle={t('account.company_plan_sub')}
              onPress={() => void openExternal(COMPANY_DASHBOARD_URL)}
              testID="account.row.companyPlan"
            />
          ) : null}
          <AccountRowButton title={t('account.receipts')} onPress={() => navigation.navigate('Receipts')} testID="account.row.receipts" />
          <AccountRowButton
            title={t('usage.title')}
            subtitle={t('usage.subtitle')}
            onPress={() => navigation.navigate('PlanUsage')}
            testID="account.row.usage"
          />
        </AccountSection>

        <AccountSection kicker={t('account.section_account')} testID="account.account">
          <BodyGoalsRow />
          {referralRow ? (
            <AccountRowButton
              title={t('account.refer')}
              subtitle={referralSubtitle(referralRow.rewardsEarned, language)}
              accessory={<Ionicons name="share-outline" size={14} color={colors.paper3} />}
              onPress={() => void shareReferral(referralRow.link, language)}
              testID="account.row.refer"
            />
          ) : null}
          <IdentityRow />
          <AccountRowButton
            title={t('account.language')}
            subtitle={languageRowSubtitle(language, languageSwitch.saving, language)}
            onPress={() => setLanguagePickerOpen(true)}
            testID="account.row.language"
          />
          <AccountRowButton
            title={t('account.android.notifications')}
            accessibilityHint={t('account.android.notifications_hint')}
            onPress={() => void openNotificationSettings()}
            testID="account.row.notifications"
          />
          <AccountRowButton
            title={t('account.help')}
            subtitle={SUPPORT_EMAIL}
            onPress={() => void openExternal(SUPPORT_MAILTO)}
            testID="account.row.help"
          />
          <AccountRowButton
            title={t('account.logout')}
            dim
            onPress={() => void useAppStore.getState().signOut()}
            testID="account.row.logout"
          />
          <DeletionRow />
        </AccountSection>

        <LegalFooter />
        <View style={styles.endSpacer} />
      </ScrollView>

      <Dialog
        visible={languagePickerOpen}
        onClose={() => setLanguagePickerOpen(false)}
        presentation="actionSheet"
        titleVisibility="visible"
        title={t('account.lang_title')}
        message={t('account.lang_msg')}
        buttons={[
          { label: t('account.lang_en'), onPress: () => pickLanguage('en'), testID: 'account.language.en' },
          { label: t('account.lang_is'), onPress: () => pickLanguage('is'), testID: 'account.language.is' },
          { label: t('common.cancel'), role: 'cancel' },
        ]}
        testID="account.languagePicker"
      />
      <Dialog
        visible={languageSwitch.error !== null}
        onClose={languageSwitch.dismissError}
        title={t('account.lang_failed_title')}
        message={languageSwitch.error ?? undefined}
        buttons={[{ label: t('common.ok') }]}
        testID="account.languageError"
      />
    </View>
  );
}

/** Terms · Privacy · Contact, and "Sporta ehf. · Reykjavík, Iceland" (iOS `legalFooter`). */
function LegalFooter() {
  const { t } = useT();
  return (
    <View style={styles.footer} testID="account.footer">
      <View style={styles.footerLinks}>
        <FooterLink label={t('account.terms')} url={TERMS_URL} />
        <FooterDot />
        <FooterLink label={t('account.privacy')} url={PRIVACY_URL} />
        <FooterDot />
        <FooterLink label={t('account.contact')} url={SUPPORT_MAILTO} />
      </View>
      <LPText size={11} color={colors.paper4} align="center">
        {t('account.legal_footer', { name: MerchantInfo.legalName })}
      </LPText>
    </View>
  );
}

function FooterLink({ label, url }: { label: string; url: string }) {
  return (
    <Pressable
      onPress={() => void openExternal(url)}
      accessibilityRole="link"
      accessibilityLabel={label}
      hitSlop={10}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <LPText size={12} color={colors.paper3}>
        {label}
      </LPText>
    </Pressable>
  );
}

function FooterDot() {
  return <View style={styles.footerDot} importantForAccessibility="no" accessibilityElementsHidden />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink },
  content: { paddingHorizontal: 20, gap: 22 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 2 },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Balances the back chevron so the kicker sits in the middle.
  topBarBalance: { width: 36, height: 36 },
  pressed: { opacity: 0.6 },
  footer: { alignItems: 'center', gap: 10, paddingTop: 8 },
  footerLinks: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap', justifyContent: 'center' },
  footerDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: colors.paper4 },
  // iOS ends the stack with `Spacer(minLength: 40)`.
  endSpacer: { height: 40 },
});
