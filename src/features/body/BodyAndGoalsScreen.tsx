/**
 * Route `BodyAndGoals`: the member's control room for health data, the
 * Android port of iOS Views/Health/BodyAndGoalsView.swift (`ios-ux.md` 10).
 *
 * EVERYTHING A MEMBER CAN DO WITH THEIR OWN HEALTH DATA IS ON THIS ONE PAGE:
 * turn tracking on or off, see and delete single weigh-ins, set the calorie
 * goal, choose the reminders, download the lot, and delete the lot. Consent
 * is only real when withdrawing it is as easy as giving it, and a member who
 * has to hunt for the off switch has not been given a choice.
 *
 * Opened from Plan's gear and the gate's "Manage your data" (entry `plan`),
 * the adopted banner's Change (anchor `reminders`) and the feedback's
 * settings (anchor `feedback`, entry `banner`), and Account's row (`account`).
 *
 *   under 18     the fixed under-18 notice and the footer, nothing else
 *   otherwise    1 Tracking
 *                with consent: 2 Your body, 3 Your plan (a live plan),
 *                4 the health-data connection (HC slot: Android ships no
 *                Health Connect, owner decision, so it renders nothing),
 *                5 Reminders, the monthly feedback (FEED-1's slot)
 *                6 What we store, 7 Your data, the footer
 *
 * TWO THINGS THAT LOOK LIKE ONE. "Delete all health data" and the tracking
 * switch run the SAME call, because withdrawal IS erasure: the server deletes
 * every health row in the same transaction and answers with the counts,
 * which the "Deleted" sheet shows, so the member sees what went rather than
 * being told "done". THE MEMBER IS TOLD FIRST, and this phone's own copy is
 * wiped only once that sheet has gone (./withdraw/finishWithdrawal.ts says
 * why it cannot run earlier).
 *
 * NOTHING HERE NAMES APPLE HEALTH OR HEALTH CONNECT (owner decision): the
 * lines iOS words with Apple Health use BODY-1's neutral Android copy, and
 * the Apple Health section, its hints and its connect flow are not drawn.
 */
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isCancellation, isOffline, newIdempotencyKey } from '../../api';
import { isLiveProgramStatus, type HealthConsent } from '../../api/profile';
import { Dialog } from '../../components/ui';
import {
  consentWithdrawalBody,
  livePlanGoal,
  mayTakeTarget,
  setHealthConsent,
  useHealthStore,
} from '../../health';
import { HealthConsentSheet } from '../../health/ui';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useT } from '../../i18n';
import { track } from '../../lib/analytics';
import { popTabToRoot } from '../../navigation/navigationRef';
import type { BodyAndGoalsAnchor, SharedRouteProps } from '../../navigation/types';
import { selectSupportsTargetWeight, useAppStore } from '../../stores/appStore';
import { useIntentStore } from '../../stores/intentStore';
import { colors } from '../../theme';

import { clearLeftoverExports } from './export/cleanup';
import { startExport } from './export/startExport';
import LogWeightSheet from './logWeight/LogWeightSheet';
import {
  bodyGoalsEntry,
  CHART_MIN_WEEKS,
  chartTargetKg,
  chartWeeks,
  DELETE_BODY_KEY,
  goalSubtitle,
  goalSubtitleWhenLapsed,
  hasStandingConsent,
  latestTitle,
  showsTargetRow,
  targetSubtitle,
  trackingSubtitle,
} from './model';
import { useReminderSettings } from './reminders/useReminderSettings';
import BodySection from './sections/BodySection';
import DataSection from './sections/DataSection';
import { BodyGoalsFooter, MinorNotice, PlanSection } from './sections/misc';
import RemindersSection from './sections/RemindersSection';
import StoreSection from './sections/StoreSection';
import TrackingSection from './sections/TrackingSection';
import { openBodySheet, openTargetSheet } from './sheets';
import FeedbackSwitches from './slots/FeedbackSwitches';
import HealthConnectRow from './slots/HealthConnectRow';
import { BodyTopBar } from './ui/parts';
import { useBodyGoalsReads } from './useBodyGoalsReads';
import DeletedEverythingSheet from './withdraw/DeletedEverythingSheet';
import { deletionCounts, type HealthDeletionCounts } from './withdraw/deletionCounts';
import { finishWithdrawal } from './withdraw/finishWithdrawal';

/** Which control raised the delete question (`health_consent_withdrawn.entry`): which one members reach for is worth knowing. */
type WithdrawEntry = 'toggle' | 'delete_all';

/** The space between two sections (iOS `VStack(spacing: 22)`). */
const SECTION_GAP = 22;

export default function BodyAndGoalsScreen({ navigation, route }: SharedRouteProps<'BodyAndGoals'>) {
  const { t, language } = useT();
  const insets = useSafeAreaInsets();
  // The tab bar floats over the page; in the shared sheet there is none.
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? insets.bottom;
  const reduceMotion = useReduceMotion();
  const anchor = route.params?.anchor;

  const profile = useAppStore((s) => s.profile);
  const access = useAppStore((s) => s.healthAccess);
  const supportsTargetWeight = useAppStore(selectSupportsTargetWeight);
  const dayProgram = useHealthStore((s) => s.today?.program ?? null);
  const weighIn = useHealthStore((s) => s.today?.weighIn ?? null);
  const checkIn = useHealthStore((s) => s.today?.checkIn ?? null);
  const health = profile?.health ?? null;
  const profileId = profile?.id ?? null;

  // The consent this page withdrew, once the server confirmed it (../model
  // `hasStandingConsent`). A ref beside the state, so a read started from a
  // callback sees the value set a moment earlier.
  const [withdrawnConsent, setWithdrawnConsentState] = useState<HealthConsent | null>(null);
  const withdrawnRef = useRef<HealthConsent | null>(null);
  const setWithdrawnConsent = useCallback((consent: HealthConsent | null) => {
    withdrawnRef.current = consent;
    setWithdrawnConsentState(consent);
  }, []);
  const hasConsent = hasStandingConsent(health?.consent, withdrawnConsent);
  const isEntitled = access === 'entitled';

  const reads = useBodyGoalsReads(() => {
    const app = useAppStore.getState();
    return {
      hasConsent: hasStandingConsent(app.profile?.health?.consent, withdrawnRef.current),
      access: app.healthAccess,
      language: app.language,
    };
  });
  const reminders = useReminderSettings(profileId);

  const [consentOpen, setConsentOpen] = useState(false);
  const [logWeightOpen, setLogWeightOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [withdrawEntry, setWithdrawEntry] = useState<WithdrawEntry>('toggle');
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawErrorKey, setWithdrawErrorKey] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<HealthDeletionCounts | null>(null);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportErrorKey, setExportErrorKey] = useState<string | null>(null);

  /** The wipe this phone still owes, held until the member has closed the result sheet. */
  const wipePending = useRef<string | null | false>(false);

  // ---------------------------------------------------------------------
  // Appearing (iOS `.task(id: language)` and `.onAppear`)

  // Where the member came from, read once: the route under this one when it opened.
  const [entry] = useState(() => bodyGoalsEntry(previousRouteName(navigation.getState(), route.key), anchor));
  const load = reads.load;
  const reloadReminders = reminders.reload;
  const refreshPermission = reminders.refreshPermission;
  useFocusEffect(
    useCallback(() => {
      void load();
      void reloadReminders();
      void refreshPermission();
      track('body_goals_opened', { entry });
    }, [load, reloadReminders, refreshPermission, entry]),
  );

  // A language change re-reads: the goal's words come back in the new one
  // (iOS `.task(id: appState.language)`).
  const languageSeen = useRef(language);
  useEffect(() => {
    if (languageSeen.current === language) return;
    languageSeen.current = language;
    void load();
  }, [language, load]);

  // Back from the system settings (Open Settings): the denied row goes as soon as it is true.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshPermission();
    });
    return () => subscription.remove();
  }, [refreshPermission]);

  // An export a share never got to delete (Android killed the app while
  // another app had the file) goes the next time this page opens; one a
  // share in this run still holds waits for its own moment (./export/cleanup.ts).
  useEffect(() => {
    void clearLeftoverExports().catch(() => undefined);
  }, []);

  // A page that goes away with the wipe still owed (the screen was removed
  // under the sheet) still wipes: the server has deleted everything. A
  // withdrawal still in flight when the page goes wipes as it lands
  // (`withdraw`), since it finds no page to show its sheet on.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (wipePending.current !== false) {
        const id = wipePending.current;
        wipePending.current = false;
        void finishWithdrawal(id);
      }
    };
  }, []);

  // ---------------------------------------------------------------------
  // Scrolling to an anchor (iOS `proxy.scrollTo(anchor, anchor: .top)`)

  const scrollRef = useRef<ScrollView>(null);
  const scrolledToAnchor = useRef(false);
  const onAnchorLayout = useCallback(
    (which: BodyAndGoalsAnchor) => (event: LayoutChangeEvent) => {
      if (which !== anchor || scrolledToAnchor.current) return;
      const { y, height } = event.nativeEvent.layout;
      if (height <= 0) return;
      scrolledToAnchor.current = true;
      // One frame later: the sections above it have laid out by then.
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ y, animated: !reduceMotion }));
    },
    [anchor, reduceMotion],
  );

  // ---------------------------------------------------------------------
  // Actions

  const reloadAfterSave = useCallback(() => {
    void (async () => {
      await useAppStore.getState().loadProfile();
      await load();
    })();
  }, [load]);

  const openTracking = () => {
    setWithdrawEntry('toggle');
    setConfirmOpen(true);
  };

  const openDeleteAll = () => {
    setWithdrawEntry('delete_all');
    setConfirmOpen(true);
  };

  const withdraw = async () => {
    if (isWithdrawing) return;
    setIsWithdrawing(true);
    setWithdrawErrorKey(null);
    const consent = health?.consent ?? null;
    try {
      const result = await setHealthConsent(consentWithdrawalBody(consent?.version), newIdempotencyKey());
      track('health_consent_withdrawn', { entry: withdrawEntry });
      useAppStore.getState().applyHealthDataDeleted();
      if (!mounted.current) {
        // The member left while the call ran (back is never blocked): the
        // server has deleted everything and there is no sheet left to wait
        // for, so this phone's copy goes now.
        void finishWithdrawal(profileId);
        return;
      }
      // The page shows the profile with no health data at once, whatever a
      // read in flight does, and the wipe waits for the result sheet.
      setWithdrawnConsent(consent);
      wipePending.current = profileId;
      setIsWithdrawing(false);
      reads.clear();
      setDeleted(deletionCounts(result.deleted));
      setDeletedOpen(true);
    } catch (error) {
      setIsWithdrawing(false);
      if (isCancellation(error)) return;
      setWithdrawErrorKey(isOffline(error) ? 'health.offline.action_hint' : 'common.error_body');
    }
  };

  const onDeletedClosed = () => {
    if (wipePending.current === false) return;
    const id = wipePending.current;
    wipePending.current = false;
    // `withdrawnConsent` stays: it keeps a stale profile read from drawing
    // deleted numbers again, and stops mattering once the member consents anew.
    void finishWithdrawal(id, () => reloadReminders());
  };

  const runExport = () => {
    if (isExporting) return;
    setIsExporting(true);
    setExportErrorKey(null);
    // The export belongs to this page and this member: one that lands after
    // either has gone opens no share sheet (./export/startExport.ts).
    const owner = useAppStore.getState().userId;
    void startExport({
      isCurrent: () => {
        const app = useAppStore.getState();
        return mounted.current && owner !== null && app.isAuthenticated && app.userId === owner;
      },
      onReady: () => setIsExporting(false),
      onFailed: (key) => {
        setIsExporting(false);
        setExportErrorKey(key);
      },
      onCancelled: () => setIsExporting(false),
    });
  };

  /**
   * Account (the consent sheet's way to a pending deletion), iOS
   * `openAccount()`: opened from Account, it is the screen underneath, so
   * going back is the way there (React Navigation 7's `navigate` would push
   * a second Account); from Plan it is pushed on Plan's stack.
   */
  const openAccount = () => {
    if (previousRouteName(navigation.getState(), route.key) === 'Account') navigation.popTo('Account');
    else navigation.navigate('Account');
  };

  const openPlanRoot = () => {
    // Plan, at its root: emptying Plan's stack also pops this page when Plan pushed it.
    popTabToRoot('Plan');
    useIntentStore.getState().requestTab('Plan');
  };

  // ---------------------------------------------------------------------
  // The page

  const weeks = chartWeeks(reads.trend);
  const targetKg = chartTargetKg(supportsTargetWeight, reads.targetWeight);
  const program = health?.program ?? null;
  const liveProgram = program && isLiveProgramStatus(program.status) ? program : null;
  const targetShown = showsTargetRow({
    supportsTargetWeight,
    targetWeight: reads.targetWeight,
    calorieGoal: reads.goal?.goal,
    livePlanMayTakeTarget: mayTakeTarget(livePlanGoal(dayProgram, program)),
  });

  return (
    <View style={styles.root}>
      <BodyTopBar title={t('bodygoals.title')} onBack={() => navigation.goBack()} testID="bodygoals.bar" />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + 40 }]}
        testID="bodygoals.scroll"
      >
        {access === 'minor' ? (
          <Section first>
            <MinorNotice />
          </Section>
        ) : (
          <>
            <Section first>
              <TrackingSection
                hasConsent={hasConsent}
                subtitle={trackingSubtitle(t, language, { hasConsent, consentedAt: health?.consent?.consentedAt ?? null, access })}
                enabled={isEntitled}
                isWithdrawing={isWithdrawing}
                errorKey={withdrawErrorKey}
                onTurnOn={() => setConsentOpen(true)}
                onTurnOff={openTracking}
              />
            </Section>
            {hasConsent ? (
              <>
                <Section>
                  <BodySection
                    isEntitled={isEntitled}
                    latestTitle={latestTitle(t, language, health?.latest)}
                    chart={weeks && weeks.length >= CHART_MIN_WEEKS ? { weeks, direction: reads.trend?.direction ?? null, targetKg } : null}
                    goalSubtitle={isEntitled ? goalSubtitle(t, language, reads.goal) : goalSubtitleWhenLapsed(t, language, reads.goal)}
                    target={
                      targetShown
                        ? { subtitle: targetSubtitle(t, language, reads.targetWeight), reached: reads.targetWeight?.reachedAt != null }
                        : null
                    }
                    loadFailed={reads.loadFailed}
                    onUpdateBody={() => openBodySheet({ kind: 'update', programId: program?.id ?? null, onSaved: reloadAfterSave })}
                    onLogWeight={() => setLogWeightOpen(true)}
                    onGoal={() => openBodySheet({ kind: 'goal', onSaved: reloadAfterSave })}
                    onTarget={() =>
                      openTargetSheet({
                        kind: 'save',
                        existing: reads.targetWeight,
                        onSaved: () =>
                          void (async () => {
                            await useAppStore.getState().loadProfile();
                            await useHealthStore.getState().load({ force: true });
                            await load();
                          })(),
                      })
                    }
                    onHistory={() => navigation.navigate('Measurements')}
                    onRetry={() => void load()}
                  />
                </Section>
                {liveProgram ? (
                  <Section>
                    <PlanSection program={liveProgram} onOpen={openPlanRoot} />
                  </Section>
                ) : null}
                <SlotSection testID="bodygoals.slot.healthConnect">
                  <HealthConnectRow />
                </SlotSection>
                <Section onLayout={onAnchorLayout('reminders')}>
                  <RemindersSection settings={reminders} />
                </Section>
                <SlotSection onLayout={onAnchorLayout('feedback')} testID="bodygoals.slot.feedback">
                  <FeedbackSwitches />
                </SlotSection>
              </>
            ) : null}
            <Section>
              <StoreSection />
            </Section>
            <Section onLayout={onAnchorLayout('data')}>
              <DataSection
                hasConsent={hasConsent}
                isExporting={isExporting}
                exportErrorKey={exportErrorKey}
                isWithdrawing={isWithdrawing}
                onExport={runExport}
                onDeleteAll={openDeleteAll}
              />
            </Section>
          </>
        )}
        <Section>
          <BodyGoalsFooter />
        </Section>
      </ScrollView>

      <Dialog
        visible={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t('bodygoals.delete_title')}
        message={t(DELETE_BODY_KEY)}
        buttons={[
          { label: t('common.cancel'), role: 'cancel', testID: 'bodygoals.delete.cancel' },
          { label: t('bodygoals.delete_confirm'), role: 'destructive', onPress: () => void withdraw(), testID: 'bodygoals.delete.confirm' },
        ]}
        testID="bodygoals.delete.confirmDialog"
      />

      <HealthConsentSheet
        visible={consentOpen}
        entry="account"
        onClose={() => setConsentOpen(false)}
        onGranted={() => {
          // The member said yes again, here: nothing is withdrawn any more,
          // whatever the profile read that followed managed to do.
          setWithdrawnConsent(null);
          void load();
        }}
        onOpenAccount={openAccount}
        testID="bodygoals.consent"
      />

      <LogWeightSheet
        visible={logWeightOpen}
        onClose={() => setLogWeightOpen(false)}
        weighIn={weighIn}
        checkIn={checkIn}
        onWeightLogged={() => reloadAfterSave()}
      />

      <DeletedEverythingSheet
        visible={deletedOpen}
        counts={deleted}
        onClose={() => setDeletedOpen(false)}
        onClosed={onDeletedClosed}
      />
    </View>
  );
}

/** The route under `key` in the stack (Account, or one of Plan's screens). */
function previousRouteName(
  state: { readonly routes: readonly { readonly name: string; readonly key: string }[] } | undefined,
  key: string,
): string | null {
  const index = state?.routes.findIndex((route) => route.key === key) ?? -1;
  return index > 0 ? (state?.routes[index - 1]?.name ?? null) : null;
}

/** One section, the gap above it unless it is the first. */
function Section({ first = false, onLayout, children }: { readonly first?: boolean; readonly onLayout?: (event: LayoutChangeEvent) => void; readonly children: ReactNode }) {
  return (
    <View style={!first && styles.gap} onLayout={onLayout}>
      {children}
    </View>
  );
}

/**
 * A section another package fills (the health-data connection, the monthly
 * feedback), which may render nothing: the gap above it appears only once it
 * has drawn something, so an empty slot leaves no hole between two cards.
 *
 * Its layout is passed on only once that gap is in place: the first one
 * (drawn, no gap yet) has a `y` a gap too high, and scrolling to it would
 * open the feedback anchor on the blank strip above the section. Adding the
 * gap moves the section, which lays it out again.
 */
function SlotSection({
  onLayout,
  testID,
  children,
}: {
  readonly onLayout?: (event: LayoutChangeEvent) => void;
  readonly testID?: string;
  readonly children: ReactNode;
}) {
  const [drawn, setDrawn] = useState(false);
  return (
    <View
      testID={testID}
      style={drawn && styles.gap}
      onLayout={(event) => {
        const next = event.nativeEvent.layout.height > 0;
        if (next !== drawn) setDrawn(next);
        if (next && drawn) onLayout?.(event);
      }}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink },
  content: { paddingHorizontal: 20, paddingTop: 8 },
  gap: { marginTop: SECTION_GAP },
});
