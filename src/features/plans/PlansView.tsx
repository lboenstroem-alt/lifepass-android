/**
 * Plans: the memberships and the visitor passes, the root modal `Plans`
 * (mounted by ./PlansScreen.tsx). The Android port of iOS PlansView
 * (Views/Plans/PlansView.swift), opened over the tab bar from anywhere (Account, Plan and usage, a refusal's "See plans",
 * the Plan tab, Coach, the meal and health gates).
 *
 * From the top: the hero with the back chevron, the heading for the segment
 * on screen and the link to "How LifePass works" (./PlanInfoSheet.tsx), the
 * memberships / passes toggle, the eID note for an unverified member, the
 * cards (./PlanCard.tsx), the fine print, and the floating Continue with the
 * "Step 1" chip above it.
 *
 * THE CATALOGUE (`GET /catalog/plans`) is read once per visit, best effort and
 * silently (./catalogStore.ts): prices, the live tier facts, and which passes
 * are on sale. Without it the cards still render, without prices, and the
 * passes are the built-in list minus those off sale.
 *
 * THE eID GATE. A membership needs a kennitala verified with Kenni; a pass
 * doesn't. Continue on a membership while unverified PARKS the plan (and any
 * code typed for it) and opens the Kenni sheet; when the sheet closes and the
 * profile now says verified, the purchase resumes by itself (the member
 * already said "buy this plan"). Closing it unverified never resumes. "See
 * visitor passes" in the sheet clears what was parked and shows the passes.
 * A server refusal (`kennitala_verification_required`, the local flag can be
 * stale) parks the SUBMITTED plan, not the live selection.
 *
 * THE CHECKOUT after the gate is ./purchase.ts (PLANS-2's payment sheet).
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Kicker, LPText } from '../../components/ui';
import { hiddenFromAccessibility } from '../../components/ui/a11y';
import { openKenniSheet } from '../kenni';
import { useT } from '../../i18n';
import { track } from '../../lib/analytics';
import type { RootModalProps } from '../../navigation/types';
import { selectIsKennitalaVerified, useAppStore } from '../../stores/appStore';
import { colors } from '../../theme';

import { currentPlanCatalog, loadPlanCatalog, resetPlanCatalog, usePlanCatalog } from './catalogStore';
import EidHint from './EidHint';
import PlanCard from './PlanCard';
import PlanInfoSheet from './PlanInfoSheet';
import { continueName, isSubscription, type Plan } from './plans';
import { finePrintTermsKey } from './pricing';
import { usePlanCheckout } from './purchase';
import SegmentToggle from './SegmentToggle';
import {
  displayedPlans,
  initialSegment,
  keptSelection,
  popularSlug,
  selectedPlanIn,
  type PlansSegmentValue,
} from './selection';

const HERO = require('../../../assets/plans/plans-hero.jpg');

const HERO_HEIGHT = 190;
/** iOS `.padding(.bottom, 36)` under the Continue cluster. */
const CTA_BOTTOM = 36;
/** iOS `Spacer(minLength: 100)` at the end of the scroll. */
const MIN_BOTTOM_SPACE = 100;

/** iOS lpInk (#F8F6F1) at 30 %: the top of the hero's fade. */
const HERO_FADE_TOP = 'rgba(248,246,241,0.3)';
/** iOS lpInk2 at 70 %: the back button's disc over the photo. */
const BACK_DISC = 'rgba(242,239,232,0.7)';

interface Selection {
  readonly segment: PlansSegmentValue;
  /** The selected card's slug (kept across a catalogue change while it is listed). */
  readonly slug: string | null;
}

/** A plan waiting for the Kenni sheet to close verified, with the code typed for it. */
interface Parked {
  readonly plan: Plan;
  readonly code: string;
}

function initialSelection(segment?: PlansSegmentValue, slug?: string): Selection {
  const opening = initialSegment(segment, slug);
  const plans = displayedPlans(opening, null);
  return { segment: opening, slug: keptSelection(plans, slug ?? null) };
}

export default function PlansView({ navigation, route }: RootModalProps<'Plans'>) {
  const { t, language } = useT();
  const insets = useSafeAreaInsets();
  const catalog = usePlanCatalog();
  const profileLoaded = useAppStore((s) => s.profile !== null);
  const verified = useAppStore(selectIsKennitalaVerified);

  const [selection, setSelection] = useState<Selection>(() =>
    initialSelection(route.params?.segment, route.params?.slug),
  );
  const [infoOpen, setInfoOpen] = useState(false);
  const [ctaHeight, setCtaHeight] = useState(0);

  const plans = useMemo(() => displayedPlans(selection.segment, catalog), [selection.segment, catalog]);
  // The catalogue arrived (or was re-read) and the list changed: the card that
  // was selected stays selected wherever it now sits, else the popular one.
  const keptSlug = keptSelection(plans, selection.slug);
  useEffect(() => {
    if (keptSlug !== selection.slug) setSelection((s) => ({ ...s, slug: keptSlug }));
  }, [keptSlug, selection.slug]);
  const selected = selectedPlanIn(plans, keptSlug);

  // One catalogue per visit (iOS builds a fresh view model per sheet).
  useEffect(() => {
    resetPlanCatalog();
    void loadPlanCatalog();
    return () => resetPlanCatalog();
  }, []);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Switching segment selects that segment's popular card (Plus, Adventurer). */
  const showSegment = useCallback((segment: PlansSegmentValue) => {
    setSelection((s) =>
      s.segment === segment ? s : { segment, slug: popularSlug(displayedPlans(segment, currentPlanCatalog())) },
    );
  }, []);

  // ---- The eID gate --------------------------------------------------------

  const parked = useRef<Parked | null>(null);
  // `handlePurchase` and the Kenni sheet's close call each other; the sheet's
  // callbacks outlive the render that opened it, so they reach the latest
  // handler through this ref.
  const purchaseRef = useRef<(plan: Plan, code: string) => void>(() => undefined);

  const openKenni = useCallback(
    (plan: Plan, code: string) => {
      parked.current = { plan, code };
      openKenniSheet({
        bodyKey: 'kenni.body',
        // Without Icelandic eID there is no membership, but a visitor pass is
        // one tap away.
        onSeePasses: () => {
          parked.current = null;
          showSegment('passes');
        },
        onClose: () => {
          const pending = parked.current;
          parked.current = null;
          if (!pending || !mounted.current) return;
          void resumeIfVerified(pending, () => mounted.current, purchaseRef);
        },
      });
    },
    [showSegment],
  );

  const checkout = usePlanCheckout({
    // The server's refusal: the SUBMITTED plan is parked, not the selection.
    onKennitalaRequired: (plan, code) => {
      if (mounted.current) openKenni(plan, code);
    },
    onFinished: () => {
      if (mounted.current && navigation.isFocused()) navigation.goBack();
    },
  });

  const handlePurchase = useCallback(
    (plan: Plan, code: string) => {
      // Memberships need a kennitala verified with Kenni first (Icelandic
      // residency); passes don't. Read at the tap: a profile read may have
      // landed since the last render.
      if (isSubscription(plan) && !selectIsKennitalaVerified(useAppStore.getState())) {
        openKenni(plan, code);
        return;
      }
      track('plan_selected', { plan_id: plan.id, mode: plan.mode });
      checkout.begin(plan, code);
    },
    [checkout, openKenni],
  );
  useEffect(() => {
    purchaseRef.current = handlePurchase;
  }, [handlePurchase]);

  // ---- Layout --------------------------------------------------------------

  // Gated on the profile having loaded, so a verified member never sees the
  // note or the chip flash in during the first read.
  const unverified = profileLoaded && !verified;
  const showsEidHint = selection.segment === 'monthly' && unverified;
  const showsKenniStep = selected !== null && isSubscription(selected) && unverified;
  const showsCta = selected !== null && !checkout.verifying;
  const bottomSpace = Math.max(MIN_BOTTOM_SPACE, ctaHeight + CTA_BOTTOM + 16) + insets.bottom;

  const onCtaLayout = useCallback((event: LayoutChangeEvent) => {
    setCtaHeight(Math.round(event.nativeEvent.layout.height));
  }, []);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: bottomSpace }} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={{ height: HERO_HEIGHT + insets.top }}>
          <Image source={HERO} resizeMode="cover" style={StyleSheet.absoluteFill} {...hiddenFromAccessibility} />
          <LinearGradient
            colors={[HERO_FADE_TOP, colors.ink]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
            {...hiddenFromAccessibility}
          />
          <View style={[styles.heroBar, { paddingTop: insets.top + 8 }]}>
            <Pressable
              onPress={() => navigation.goBack()}
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
              hitSlop={6}
              testID="plans.back"
              style={styles.back}
            >
              <Ionicons name="chevron-back" size={17} color={colors.paper} />
            </Pressable>
            <Kicker text={t('plans.title')} color={colors.paper2} accessibilityRole="header" style={styles.kicker} />
            <View style={styles.backSpacer} />
          </View>
        </View>

        {/* The heading names the segment actually on screen. */}
        <View style={styles.titleBlock}>
          <LPText serif size={30} tracking={-1} accessibilityRole="header">
            {t(selection.segment === 'monthly' ? 'plans.heading.memberships' : 'plans.heading.passes')}
          </LPText>
          <LPText size={13} color={colors.paper2} style={styles.intro}>
            {t(selection.segment === 'monthly' ? 'plans.intro.memberships' : 'plans.intro.passes')}
          </LPText>
          {/* Text, not a bare info glyph: the affordance says what it opens. */}
          <Pressable
            onPress={() => setInfoOpen(true)}
            accessibilityRole="button"
            hitSlop={{ top: 12, bottom: 12 }}
            testID="plans.info.link"
            style={styles.infoLink}
          >
            <Ionicons name="information-circle-outline" size={14} color={colors.accentText} />
            <LPText size={12.5} weight="semibold" color={colors.accentText} style={styles.infoText}>
              {t('plans.info.link')}
            </LPText>
          </Pressable>
        </View>

        <View style={styles.segment}>
          <SegmentToggle value={selection.segment} onChange={showSegment} />
        </View>

        {showsEidHint && (
          <View style={styles.eidHint}>
            <EidHint onSeePasses={() => showSegment('passes')} />
          </View>
        )}

        <View style={styles.list}>
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              catalog={catalog}
              selected={plan.id === selected?.id}
              onPress={() => setSelection((s) => ({ ...s, slug: plan.id }))}
            />
          ))}
          {/* The catalogue lists no pass at all: say so, rather than an empty tab with no Continue. */}
          {plans.length === 0 && (
            <LPText size={13} color={colors.paper2} align="center" style={styles.none}>
              {t('plans.passes.none')}
            </LPText>
          )}
        </View>

        <View style={styles.finePrint}>
          <View style={styles.dots}>
            <View style={styles.dotItem}>
              <View style={[styles.dot, { backgroundColor: colors.moss }]} />
              <LPText size={11} color={colors.mutedTextStrong}>
                {t('plans.fine.inbundle')}
              </LPText>
            </View>
            <View style={styles.dotItem}>
              <View style={[styles.dot, { backgroundColor: colors.signal }]} />
              <LPText size={11} color={colors.mutedTextStrong}>
                {t('plans.fine.premium')}
              </LPText>
            </View>
          </View>
          <LPText size={11} color={colors.mutedTextStrong} align="center" testID="plans.terms">
            {t(finePrintTermsKey(selected, catalog))}
          </LPText>
        </View>
      </ScrollView>

      {showsCta && selected && (
        <View
          pointerEvents="box-none"
          style={[styles.cta, { bottom: CTA_BOTTOM + insets.bottom }]}
          onLayout={onCtaLayout}
        >
          {checkout.chip}
          {/* Verifying with Kenni is a hard requirement for a membership: a
              visible step BEFORE Continue instead of an unexplained interstitial. */}
          {showsKenniStep && (
            <Pressable
              onPress={() => openKenni(selected, '')}
              accessibilityRole="button"
              testID="plans.kenni_step"
              style={styles.chip}
            >
              <Ionicons name="shield-checkmark-outline" size={12} color={colors.paper} />
              <LPText size={12} weight="semibold" style={styles.shrink}>
                {t('plans.kenni_step')}
              </LPText>
            </Pressable>
          )}
          <Pressable
            onPress={() => handlePurchase(selected, '')}
            disabled={checkout.busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: checkout.busy, busy: checkout.busy }}
            testID="plans.continue"
            style={[styles.continue, checkout.busy && styles.held]}
          >
            <LPText size={14} weight="semibold" color={colors.onAccent} style={styles.shrink}>
              {t('plans.continue', { name: continueName(selected, language) })}
            </LPText>
            <Ionicons name="arrow-forward" size={13} color={colors.onAccent} />
          </Pressable>
        </View>
      )}

      {checkout.element}

      <PlanInfoSheet visible={infoOpen} onClose={() => setInfoOpen(false)} catalog={catalog} />
    </View>
  );
}

/**
 * The Kenni sheet closed with a plan parked: resume it if the member is now
 * verified. The sheet re-reads the profile when a verification succeeds; if
 * that read has not landed yet, one more read settles it, so a purchase
 * resumes only after a REAL verification and never on a stale flag.
 */
async function resumeIfVerified(
  pending: Parked,
  stillHere: () => boolean,
  purchase: { readonly current: (plan: Plan, code: string) => void },
): Promise<void> {
  const verifiedNow = () => selectIsKennitalaVerified(useAppStore.getState());
  if (!verifiedNow()) {
    await useAppStore.getState().loadProfile();
    if (!verifiedNow()) return;
  }
  if (stillHere()) purchase.current(pending.plan, pending.code);
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink },
  heroBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  back: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BACK_DISC,
    borderWidth: 1,
    borderColor: colors.line2,
  },
  backSpacer: { width: 38, height: 38 },
  kicker: { flexShrink: 1, textAlign: 'center' },
  titleBlock: { marginTop: -24, paddingHorizontal: 28, paddingBottom: 16, gap: 6 },
  intro: { lineHeight: 18 },
  infoLink: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 2, alignSelf: 'flex-start' },
  infoText: { flexShrink: 1 },
  segment: { paddingHorizontal: 28, paddingBottom: 18 },
  eidHint: { paddingHorizontal: 20, paddingBottom: 14 },
  list: { paddingHorizontal: 20, paddingBottom: 18, gap: 10 },
  none: { paddingVertical: 24 },
  finePrint: { paddingHorizontal: 20, paddingTop: 20, gap: 6 },
  dots: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 14, rowGap: 4 },
  dotItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  cta: { position: 'absolute', right: 20, left: 20, alignItems: 'flex-end', gap: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.ink2,
  },
  continue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 999,
    // iOS fills it lpRust; white text on the readable fill (F5's contrast tokens).
    backgroundColor: colors.actionFill,
    shadowColor: colors.rust,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  held: { opacity: 0.5 },
  shrink: { flexShrink: 1 },
});
