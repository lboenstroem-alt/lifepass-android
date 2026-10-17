/**
 * The Plan tab (iOS PlanView.swift): what to do today, how the month is
 * going, what was eaten.
 *
 * THIS FILE IS THE PAGE, NOT ITS RULES. Which body renders is
 * `resolvePlanSection` (./shell/sectionRule.ts); the load sequence, the
 * parked actions, the week moves and the banners' decisions are the shell's
 * (./shell/planShell.ts), which every section calls too. The page lays out:
 *
 *   the top bar ("Plan", "Week 2 of 4" over the plan only, the gear)
 *   ONE status banner (past due, then a failed outbox item, then offline)
 *   the adopted banner (once, after an adopt)
 *   "Looking for your bookings?" (three visits)
 *   the body: skeleton | error | under-18 | gate | intro | plan
 *   the footer (not under the under-18 card)
 *
 * The cards are other packages' sections (plan 3.0.3), mounted here with no
 * props; each reads the day itself and draws nothing when it has nothing.
 * The health scores slot stays empty on Android (no Health Connect, owner
 * decision).
 *
 * WHEN IT READS. Every appearance (a tab switch, back from a pushed page)
 * clears the last adopted banner, counts a visit, returns the strip to today
 * and reads inside the five-minute freshness window; a change of the account
 * language reads again, since every title is server copy in that language;
 * back from a sheet over the tabs (the meal page, Plans, the runner) keeps
 * the day the strip was on, as iOS's sheets do. Pull to refresh forces it.
 */
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AccessibilityInfo, findNodeHandle, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { ErrorState, showToast, TopBar } from '../../components/ui';
import { isLiveStatus, selectHasLiveProgram, selectProposal, useHealthStore } from '../../health';
import { HealthConsentSheet, MealGateSheet } from '../../health/ui';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useT } from '../../i18n';
import { todayServerDay } from '../../i18n/format';
import { rootRouteName } from '../../navigation/navigationRef';
import type { TabRootProps } from '../../navigation/types';
import { useAppStore } from '../../stores/appStore';
import { useIntentStore } from '../../stores/intentStore';
import { colors } from '../../theme';

import AdoptedBanner from './banners/AdoptedBanner';
import BookingsHintBanner from './banners/BookingsHintBanner';
import PlanStatusBanner from './banners/PlanStatusBanner';
import ProposalWaitingRow from './banners/ProposalWaitingRow';
import PlanGateCard from './gate/PlanGateCard';
import { trialUrl } from './gate/gateRules';
import { collapseIntro, useIntroCollapsed } from './intro/introCollapse';
import PlanIntroCard from './intro/PlanIntroCard';
import PlanMinorCard from './minor/PlanMinorCard';
import FeedbackSection from './sections/Feedback';
import HealthScoresSection from './sections/HealthScores';
import HistorySection from './sections/History';
import NutritionSection from './sections/Nutrition';
import OverviewSection from './sections/Overview';
import ProposalSection from './sections/Proposal';
import TodaySection from './sections/Today';
import WeeklyReviewSection from './sections/WeeklyReview';
import { installedOutboxes, usePlanBridges } from './shell/bridges';
import { scrollDecision } from './shell/parkedActions';
import { PlanFooter, PlanSkeleton } from './shell/PlanChrome';
import {
  attachPlanNavigator,
  clearLocalPlanSheets,
  consumePendingPlanAction,
  deliverParkedPlanAction,
  evaluateBookingsHint,
  finishPlanScroll,
  movePlanWeek,
  openPlanMealCapture,
  openPlanModal,
  planDidAppear,
  planReturnedFromSheet,
  pushPlanRoute,
  refreshOutbox,
  reloadPlan,
  runPlanTask,
  selectPlanDate,
  supportsFeedbackNow,
  usePlanShell,
} from './shell/planShell';
import { usePlanView, type PlanViewModel } from './shell/planView';
import type { PlanSectionAnchor } from './shell/sectionRule';
import SectionSlot from './shell/SectionSlot';
import PlanWeekStrip from './week/PlanWeekStrip';

/** iOS VStack(spacing: 24) and `.padding(.top, 16)`. */
const ROW_GAP = 24;
const TOP_PADDING = 16;
/** iOS leaves 140 pt under the page: the 76 pt tab bar floats over it, plus room to breathe. */
const BOTTOM_ROOM = 64;

export default function PlanScreen({ navigation }: TabRootProps<'PlanMain'>) {
  const { t } = useT();
  const view = usePlanView();
  const appLanguage = useAppStore((s) => s.language);
  const loadState = useHealthStore((s) => s.loadState);
  const toastKey = useHealthStore((s) => s.toastKey);
  const program = useHealthStore((s) => s.today?.program ?? null);
  const scrollTarget = usePlanShell((s) => s.scrollTarget);
  const reviewFocusNonce = usePlanShell((s) => s.reviewFocusNonce);
  const pendingPlanAction = useIntentStore((s) => s.pendingPlanAction);
  const feedbackBridge = usePlanBridges((s) => s.feedback);
  const outboxes = usePlanBridges((s) => s.outboxes);
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
  const reduceMotion = useReduceMotion();
  const focused = useIsFocused();
  const [refreshing, setRefreshing] = useState(false);
  const [feedbackTick, setFeedbackTick] = useState(0);

  // The shell pushes onto THIS stack (iOS `planPath`) while Plan is mounted.
  useEffect(
    () =>
      attachPlanNavigator({
        navigate: (name, params) => (navigation.navigate as unknown as (name: string, params?: object) => void)(name, params),
        popToTop: () => {
          // Popping a stack that is already at its root is an unhandled action.
          if (navigation.getState().index > 0) navigation.popToTop();
        },
      }),
    [navigation],
  );

  // Appearances (iOS `onAppear` and `.task`). A blur while a root modal comes
  // up (the meal page, Plans, the runner) is a sheet over Plan, not leaving it.
  const underModal = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (underModal.current) {
        underModal.current = false;
        planReturnedFromSheet();
      } else {
        planDidAppear();
      }
      return () => {
        const root = rootRouteName();
        underModal.current = root !== null && root !== 'Main';
      };
    }, []),
  );

  // The account language changed on screen: read again (iOS `.task(id: language)`).
  const lastLanguage = useRef(appLanguage);
  useEffect(() => {
    if (lastLanguage.current === appLanguage) return;
    lastLanguage.current = appLanguage;
    if (focused) runPlanTask();
  }, [appLanguage, focused]);

  // The profile arrived after this appearance (a cold launch onto Plan): the
  // bookings hint is decided for the member now on screen, without counting
  // another visit.
  const profileId = useAppStore((s) => s.profile?.id ?? null);
  const lastProfileId = useRef(profileId);
  useEffect(() => {
    if (lastProfileId.current === profileId) return;
    lastProfileId.current = profileId;
    if (focused) void evaluateBookingsHint();
  }, [profileId, focused]);

  // An action parked while Plan is already the tab on screen (a notification tap).
  useEffect(() => {
    if (focused && pendingPlanAction) consumePendingPlanAction();
  }, [focused, pendingPlanAction]);

  // A held action waits for the read and for the profile (access).
  useEffect(() => {
    if (focused) deliverParkedPlanAction();
  }, [focused, loadState, view.access, view.hasConsent, feedbackTick]);

  // The feedback read is not the day's read; its answer can land a scroll or an action.
  useEffect(() => feedbackBridge?.subscribe(() => setFeedbackTick((n) => n + 1)), [feedbackBridge]);

  // An outbox item that failed, or went through in the background, changes the banner.
  useEffect(() => {
    const unsubscribes = installedOutboxes().map((source) => source.subscribe?.(refreshOutbox));
    refreshOutbox();
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe?.());
  }, [outboxes]);

  // "This was changed on another device" and its kind, for the page on screen.
  useEffect(() => {
    if (!focused || !toastKey) return;
    showToast(t(toastKey), { kind: 'health' });
    useHealthStore.getState().setToast(null);
  }, [focused, toastKey, t]);

  // Scrolling to a section a notification asked for, once it exists.
  const scrollRef = useRef<ScrollView>(null);
  const anchors = useRef<Partial<Record<PlanSectionAnchor, number>>>({});
  const deliverScroll = useCallback(() => {
    const target = usePlanShell.getState().scrollTarget;
    if (!target) return;
    const decision = scrollDecision(target, {
      hasReviewSection: hasReviewSection(view),
      showsFeedbackSection: showsFeedbackSection(view),
      healthLoadState: loadState.kind,
      feedbackLoadState: feedbackBridge?.loadState() ?? 'idle',
    });
    if (decision === 'drop') {
      finishPlanScroll(target, false);
      return;
    }
    if (decision === 'wait') return;
    const y = anchors.current[target];
    // Drawn, but not laid out yet: its layout tries again.
    if (y === undefined) return;
    scrollRef.current?.scrollTo({ y, animated: !reduceMotion });
    finishPlanScroll(target, true);
  }, [view, loadState, feedbackBridge, reduceMotion]);
  // feedbackTick: the feedback card's content can be what was missing.
  useEffect(() => deliverScroll(), [deliverScroll, scrollTarget, feedbackTick]);
  const onAnchorLayout = useCallback(
    (anchor: PlanSectionAnchor, y: number) => {
      anchors.current[anchor] = y;
      if (usePlanShell.getState().scrollTarget === anchor) deliverScroll();
    },
    [deliverScroll],
  );
  const onAnchorEmpty = useCallback((anchor: PlanSectionAnchor) => {
    delete anchors.current[anchor];
  }, []);

  // TalkBack follows a scroll onto the weekly review (iOS `reviewFocused`).
  const reviewRef = useRef<View>(null);
  useEffect(() => {
    if (reviewFocusNonce === 0) return;
    const node = findNodeHandle(reviewRef.current);
    if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
  }, [reviewFocusNonce]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reloadPlan({ force: true });
    } finally {
      setRefreshing(false);
    }
  }, []);

  // The week counter, and ONLY over the plan itself: a lapsed member's cached
  // day still carries the programme that was running when the membership
  // stopped, and "Week 2 of 4" over a gate card telling them they have no
  // plan is the bar contradicting the page.
  const subtitle =
    view.section === 'plan' && program && isLiveStatus(program.status)
      ? t('plan.week_of', { week: program.weekNo ?? 1, weeks: program.weeks ?? 4 })
      : undefined;

  const slot = { onAnchorLayout, onAnchorEmpty };

  return (
    <View style={styles.screen} testID="plan.screen">
      <TopBar
        title={t('plan.title')}
        subtitle={subtitle}
        // The gear opens Body and goals, and is hidden for a member under 18:
        // a settings gear over a card that says "this is not for you" is a control.
        trailing={
          view.access === 'minor'
            ? undefined
            : { kind: 'gear', onPress: () => pushPlanRoute('BodyAndGoals', {}), labelKey: 'a11y.body_goals' }
        }
        busy={loadState.kind === 'loading' && view.today !== null}
        testID="plan.topBar"
      />
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + BOTTOM_ROOM }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.paper3} colors={[colors.rust]} />}
        testID="plan.scroll"
      >
        <PlanStatusBanner />
        <AdoptedBanner />
        <BookingsHintBanner />

        <PlanBody view={view} slot={slot} reviewRef={reviewRef} />

        {view.section !== 'minor' ? (
          <SectionSlot anchor="footer" {...slot}>
            <PlanFooter />
          </SectionSlot>
        ) : null}
      </ScrollView>
      <LocalHealthSheets />
    </View>
  );
}

type SlotHandlers = {
  onAnchorLayout: (anchor: PlanSectionAnchor, y: number) => void;
  onAnchorEmpty: (anchor: PlanSectionAnchor) => void;
};

/** The weekly review (or its check-in prompt) is drawn for the day on screen (iOS `hasReviewSection`). */
function hasReviewSection(view: PlanViewModel): boolean {
  const day = view.shownDay;
  if (!day) return false;
  if (day.checkIn?.due === true && view.access === 'entitled') return true;
  return day.review !== null;
}

/** The feedback card has something to draw for the day on screen (iOS `showsFeedbackSection`). */
function showsFeedbackSection(view: PlanViewModel): boolean {
  if (!supportsFeedbackNow() || !view.hasConsent || !view.isShowingToday) return false;
  try {
    return usePlanBridges.getState().feedback?.hasCardContent() === true;
  } catch {
    return false;
  }
}

/** The body for the section the rule chose. Fragments, so every slot is a row of the page. */
function PlanBody({ view, slot, reviewRef }: { view: PlanViewModel; slot: SlotHandlers; reviewRef: RefObject<View | null> }) {
  switch (view.section) {
    case 'loading':
      return <PlanSkeleton />;
    case 'error':
      return <ErrorState onRetry={() => void reloadPlan({ force: true })} testID="plan.error" />;
    case 'minor':
      return <PlanMinorCard />;
    case 'gate':
      return <GateBody view={view} slot={slot} reviewRef={reviewRef} />;
    case 'intro':
      return <IntroBody view={view} slot={slot} reviewRef={reviewRef} />;
    case 'plan':
      return <ActivePlanBody view={view} slot={slot} reviewRef={reviewRef} />;
  }
}

type BodyProps = { view: PlanViewModel; slot: SlotHandlers; reviewRef: RefObject<View | null> };

/**
 * A member whose membership does not include the plan. A lapsed member whose
 * consent still stands keeps their history, read only: their plan is gone,
 * what they logged is not.
 */
function GateBody({ view, slot, reviewRef }: BodyProps) {
  const { t, language } = useT();
  const trialEligible = useAppStore((s) => s.profile?.health?.trialEligible === true);
  return (
    <>
      <PlanGateCard
        access={view.access}
        trialEligible={trialEligible}
        hasConsent={view.hasConsent}
        onChoosePlans={() => openPlanModal('Plans')}
        onOpenAccount={() => pushPlanRoute('Account')}
        onStartTrial={() => void WebBrowser.openBrowserAsync(trialUrl(language)).catch(() => undefined)}
        onPlanMyDay={() => {
          const intents = useIntentStore.getState();
          intents.parkCoachPrompt(t('coach.chip.plan_day'));
          intents.requestTab('Coach');
        }}
        onManageData={() => pushPlanRoute('BodyAndGoals', {})}
      />
      {view.hasConsent && view.shownDay ? (
        <ReadOnlyColumn slot={slot} reviewRef={reviewRef} withFeedback={false} />
      ) : null}
    </>
  );
}

/** An entitled member without a plan: the proposal the Coach built, or the intro card. */
function IntroBody({ view, slot, reviewRef }: BodyProps) {
  const proposal = useHealthStore(selectProposal);
  const adoptedProposalId = usePlanShell((s) => s.adoptedProposalId);
  const loadFailed = useHealthStore((s) => s.loadState.kind === 'failed');
  const profileId = useAppStore((s) => s.profile?.id ?? null);
  const collapsed = useIntroCollapsed(profileId);

  let lead: ReactNode;
  if (proposal && proposal.program.id !== adoptedProposalId) {
    lead = (
      <SectionSlot testID="plan.slot.proposal">
        <ProposalSection />
      </SectionSlot>
    );
  } else if (adoptedProposalId !== null && !view.hasProgramToShow) {
    // ADOPTED, AND THE READ THAT MAKES IT REAL IS STILL IN FLIGHT. Drawing
    // the proposal card again would put Start under "Your plan starts...",
    // and a second tap would replace the plan adopted seconds ago. So: the
    // skeleton while the read runs, the honest error if it fails.
    lead = loadFailed ? <ErrorState onRetry={() => void reloadPlan({ force: true })} testID="plan.error" /> : <PlanSkeleton />;
  } else if (collapsed === null) {
    // Whether this member said Not now is not read yet: neither form flashes.
    lead = null;
  } else {
    lead = (
      <PlanIntroCard
        isCollapsed={collapsed}
        onGetPlan={() => {
          const intents = useIntentStore.getState();
          intents.parkCoachProgram({ kind: 'planTab' });
          intents.requestTab('Coach');
        }}
        onLogMeal={() => openPlanMealCapture('search', todayServerDay())}
        onNotNow={() => {
          if (profileId) collapseIntro(profileId);
        }}
      />
    );
  }

  return (
    <>
      {lead}
      {view.hasConsent && view.shownDay ? (
        <ReadOnlyColumn slot={slot} reviewRef={reviewRef} withFeedback />
      ) : null}
    </>
  );
}

/** Food, scores, the review, the feedback and the history: under the gate and the intro. */
function ReadOnlyColumn({ slot, reviewRef, withFeedback }: { slot: SlotHandlers; reviewRef: RefObject<View | null>; withFeedback: boolean }) {
  return (
    <>
      <SectionSlot anchor="nutrition" {...slot} testID="plan.slot.nutrition">
        <NutritionSection />
      </SectionSlot>
      <SectionSlot anchor="appleHealth" {...slot} testID="plan.slot.scores">
        <HealthScoresSection />
      </SectionSlot>
      <SectionSlot anchor="review" ref={reviewRef} {...slot} testID="plan.slot.review">
        <WeeklyReviewSection />
      </SectionSlot>
      {withFeedback ? (
        <SectionSlot anchor="feedback" {...slot} testID="plan.slot.feedback">
          <FeedbackSection />
        </SectionSlot>
      ) : null}
      <SectionSlot anchor="history" {...slot} testID="plan.slot.history">
        <HistorySection />
      </SectionSlot>
    </>
  );
}

/** A live, paused or finished programme (3.4 rows 3 to 15). */
function ActivePlanBody({ view, slot, reviewRef }: BodyProps) {
  const proposal = useHealthStore(selectProposal);
  const hasLiveProgram = useHealthStore(selectHasLiveProgram);
  const day = view.shownDay;
  if (!day) return null;
  const week = day.week;
  return (
    <>
      {proposal && hasLiveProgram ? <ProposalWaitingRow programId={proposal.program.id} /> : null}

      {view.isBlockFinished && proposal ? (
        // A member who built the next block and tapped Not now is never
        // invited to build one again: the proposal takes Today's place.
        <SectionSlot testID="plan.slot.proposal">
          <ProposalSection />
        </SectionSlot>
      ) : (
        <SectionSlot testID="plan.slot.today">
          <TodaySection />
        </SectionSlot>
      )}

      {week ? (
        <PlanWeekStrip
          week={week}
          selectedDate={view.selectedDate}
          todayDate={todayServerDay()}
          isPaused={day.program?.status === 'paused'}
          onSelect={selectPlanDate}
          onMoveWeek={(delta) => movePlanWeek(delta, week)}
        />
      ) : null}

      <SectionSlot anchor="nutrition" {...slot} testID="plan.slot.nutrition">
        <NutritionSection />
      </SectionSlot>
      <SectionSlot anchor="appleHealth" {...slot} testID="plan.slot.scores">
        <HealthScoresSection />
      </SectionSlot>
      <SectionSlot anchor="review" ref={reviewRef} {...slot} testID="plan.slot.review">
        <WeeklyReviewSection />
      </SectionSlot>
      <SectionSlot anchor="feedback" {...slot} testID="plan.slot.feedback">
        <FeedbackSection />
      </SectionSlot>
      <SectionSlot anchor="overview" {...slot} testID="plan.slot.overview">
        <OverviewSection />
      </SectionSlot>
      <SectionSlot anchor="history" {...slot} testID="plan.slot.history">
        <HistorySection />
      </SectionSlot>
    </>
  );
}

/**
 * The consent sheet and the membership gate, drawn here when the app shell
 * has no host mounted for them (Log a meal on the intro card). Each stays
 * mounted after its first use so it can slide away, and the consent sheet
 * can run what was asked for once it has gone.
 */
function LocalHealthSheets() {
  const consent = usePlanShell((s) => s.localConsent);
  const gate = usePlanShell((s) => s.localMealGate);
  const lastConsent = useRef(consent);
  const lastGate = useRef(gate);
  if (consent) lastConsent.current = consent;
  if (gate) lastGate.current = gate;
  const consentRequest = lastConsent.current;
  const gateAccess = lastGate.current;
  return (
    <>
      {consentRequest ? (
        <HealthConsentSheet
          visible={consent !== null}
          entry="plan"
          onClose={clearLocalPlanSheets}
          onGranted={consentRequest.onGranted}
          onOpenAccount={() => pushPlanRoute('Account')}
          testID="plan.consentSheet"
        />
      ) : null}
      {gateAccess ? (
        <MealGateSheet
          visible={gate !== null}
          access={gateAccess}
          onClose={clearLocalPlanSheets}
          onSeeMemberships={() => openPlanModal('Plans')}
          onOpenAccount={() => pushPlanRoute('Account')}
          testID="plan.mealGate"
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  scroll: { flex: 1 },
  content: { paddingTop: TOP_PADDING, gap: ROW_GAP },
});
