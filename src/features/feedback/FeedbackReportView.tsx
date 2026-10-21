/**
 * One month's feedback, or one mid-month note, read in full (iOS
 * Views/Plan/FeedbackReportView.swift, `SPEC` 9.3).
 *
 * Loads FB-4 itself, so a notification tap, the Plan card, the history list
 * and a report opened from Body and goals' history sheet all land on the same
 * view. The words are the server's, rendered in the member's language on
 * every read, with food and weight already left out when the member's switch
 * says so; this view only lays them out.
 *
 *   loading     two skeleton cards ("Loading" to TalkBack)
 *   failed      the health error state with Try again
 *   not found   "This feedback is no longer available." (a 404, a note with
 *               nothing left to show, or the feature not usable here)
 *   loaded      kicker and title, the left-out line, the note or the
 *               sections, and the footer
 *
 * Opening an unseen monthly report marks it seen; a note is marked from its
 * card. Without `resolveAction` (the Body and goals sheet) no action is
 * drawn: an action there would have nowhere to go.
 */
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  fetchFeedbackReport,
  fetchFeedbackReports,
  isEmptyNote,
  type FeedbackAction,
  type FeedbackMessage,
  type FeedbackReport,
  type FeedbackSection,
} from '../../api/feedback';
import { ApiError } from '../../api/errors';
import { Card, ErrorState, Kicker, LPText, SkeletonCard, TopBar } from '../../components/ui';
import { useHealthStore } from '../../health/store';
import { useT, type Lang } from '../../i18n';
import { selectHasHealthConsent, useAppStore } from '../../stores/appStore';
import { colors, hairline } from '../../theme';

import type { ShownFeedbackAction } from './actions';
import { supportsFeedback, useFeedbackStore } from './feedbackStore';
import { FeedbackActionButton, FeedbackTextButton } from './parts';

export type FeedbackReportViewProps = {
  /** The report to read; without one, the month's (`periodMonth`) or the current one. */
  reportId?: string | null;
  periodMonth?: string | null;
  /** Which action a line may offer; omitted, no action is drawn (Body and goals' sheet). */
  resolveAction?: (action: FeedbackAction | null) => ShownFeedbackAction | null;
  onAction?: (action: ShownFeedbackAction) => void;
  onBack?: () => void;
  /** "Feedback settings": Body and goals on its feedback section. Omitted, the link is not drawn. */
  onOpenSettings?: () => void;
  /** "See past months", under a monthly report. Omitted, the link is not drawn. */
  onOpenHistory?: () => void;
  /**
   * Bumped each time the view shows again after something covered it (iOS
   * `.task` runs again on every appearance): it reads again, keeping the
   * report on screen meanwhile. Settings changed in Body and goals land
   * here on the way back.
   */
  reloadKey?: number;
  testID?: string;
};

type Phase = 'loading' | 'loaded' | 'notFound' | 'failed';

/** iOS leaves 140 pt under the page: the tab bar floats over it, plus room to breathe. */
const BOTTOM_ROOM = 64;

/**
 * Which report to load. A report id is used as it is. A month (a route
 * opened with `periodMonth`, Android's deep-link form) is the summary's
 * latest when it is that month, else that month in the first page of the
 * history. With neither, the current report once a read says which it is.
 */
async function resolveReportId(
  reportId: string | null | undefined,
  periodMonth: string | null | undefined,
  language: Lang,
  signal: AbortSignal,
): Promise<string | null> {
  if (reportId) return reportId;
  const store = useFeedbackStore.getState();
  if (!periodMonth) {
    await store.refresh();
    const latest = useFeedbackStore.getState().summary?.latest;
    return latest && latest.current ? latest.id : null;
  }
  const latest = store.summary?.latest;
  if (latest && latest.periodMonth === periodMonth) return latest.id;
  const page = await fetchFeedbackReports({ cursor: null, language, signal });
  return page.reports.find((row) => row.periodMonth === periodMonth)?.id ?? null;
}

export default function FeedbackReportView({
  reportId,
  periodMonth,
  resolveAction,
  onAction,
  onBack,
  onOpenSettings,
  onOpenHistory,
  reloadKey = 0,
  testID = 'feedback.detail',
}: FeedbackReportViewProps) {
  const { t, language } = useT();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? insets.bottom;
  const [report, setReport] = useState<FeedbackReport | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const reportRef = useRef<FeedbackReport | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const show = useCallback((loaded: FeedbackReport) => {
    if (isEmptyNote(loaded)) {
      reportRef.current = null;
      setReport(null);
      setPhase('notFound');
      return;
    }
    reportRef.current = loaded;
    setReport(loaded);
    setPhase('loaded');
    // A monthly report is seen when it is opened; a note is marked from its card (`SPEC` 9.3).
    if (loaded.kind === 'monthly' && loaded.seenAt === null) void useFeedbackStore.getState().markSeen(loaded.id);
  }, []);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    if (reportRef.current === null) setPhase('loading');
    const app = useAppStore.getState();
    if (!supportsFeedback(app) || !selectHasHealthConsent(app)) {
      setPhase('notFound');
      return;
    }
    try {
      const id = await resolveReportId(reportId, periodMonth, language, abort.signal);
      if (abort.signal.aborted) return;
      if (!id) {
        setPhase('notFound');
        return;
      }
      const answer = await fetchFeedbackReport(id, language, { signal: abort.signal });
      if (abort.signal.aborted) return;
      useAppStore.getState().noteServerFeatures(answer.features);
      show(answer.report);
    } catch (error) {
      if (abort.signal.aborted) return;
      if (error instanceof ApiError) {
        if (error.isCancellation) return;
        if (error.status === 404) {
          setPhase('notFound');
          return;
        }
        if (error.isProblem('health_consent_required', 'health_minor_blocked')) {
          useHealthStore.getState().handle(error, { foreground: true });
        }
      }
      setPhase(reportRef.current === null ? 'failed' : 'loaded');
    }
  }, [reportId, periodMonth, language, show]);

  // iOS `.task(id: appState.language)`: every word is server copy in the account
  // language, read again on every appearance (`reloadKey`).
  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load, reloadKey]);

  const titleKey = report?.kind === 'note' ? 'feedback.detail.note_title' : 'feedback.detail.title';

  return (
    <View style={styles.page} testID={testID}>
      <TopBar title={t(titleKey)} onBack={onBack} testID={`${testID}.bar`} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + BOTTOM_ROOM }]}
        showsVerticalScrollIndicator={false}
      >
        {phase === 'loading' ? (
          <View
            style={styles.skeletons}
            accessible
            accessibilityLabel={t('a11y.loading')}
            testID={`${testID}.loading`}
          >
            <SkeletonCard rows={4} />
            <SkeletonCard rows={3} showsHeader={false} />
          </View>
        ) : null}
        {phase === 'failed' ? <ErrorState onRetry={() => void load()} testID={`${testID}.error`} /> : null}
        {phase === 'notFound' ? (
          <LPText size={15} color={colors.paper2} style={styles.notFound} testID="feedback.detail.not_found">
            {t('feedback.detail.not_found')}
          </LPText>
        ) : null}
        {phase === 'loaded' && report ? (
          <ReportContent
            report={report}
            resolveAction={resolveAction}
            onAction={onAction}
            onOpenSettings={onOpenSettings}
            onOpenHistory={onOpenHistory}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

type ContentProps = Pick<FeedbackReportViewProps, 'resolveAction' | 'onAction' | 'onOpenSettings' | 'onOpenHistory'> & {
  report: FeedbackReport;
};

function ReportContent({ report, resolveAction, onAction, onOpenSettings, onOpenHistory }: ContentProps) {
  const { t } = useT();
  const action = (raw: FeedbackAction | null) => (
    <LineAction action={raw} resolveAction={resolveAction} onAction={onAction} />
  );
  const noteText = report.note?.text && report.note.text.trim().length > 0 ? report.note.text : null;
  return (
    <>
      <View style={styles.header}>
        <Kicker text={t(report.kind === 'note' ? 'feedback.note.kicker' : 'feedback.card.kicker')} />
        <LPText serif size={28} color={colors.paper} accessibilityRole="header" testID="feedback.detail.heading">
          {report.title ?? t('feedback.detail.title')}
        </LPText>
      </View>

      {report.leftOutLine ? (
        <View style={styles.leftOut} testID="feedback.detail.left_out">
          <LPText size={13} color={colors.paper2}>
            {report.leftOutLine}
          </LPText>
          {onOpenSettings ? (
            <FeedbackTextButton
              label={t('feedback.detail.settings')}
              onPress={onOpenSettings}
              color={colors.rust}
              testID="feedback.detail.left_out.settings"
            />
          ) : null}
        </View>
      ) : null}

      {report.kind === 'note' ? (
        noteText ? (
          <Card style={[styles.margin, styles.noteCard]} testID="feedback.detail.note">
            <LPText serif size={17} color={colors.paper}>
              {noteText}
            </LPText>
            {action(report.note?.action ?? null)}
          </Card>
        ) : null
      ) : (
        report.sections.map((section, index) => (
          <SectionView key={`${index}-${section.topic}`} section={section} action={action} />
        ))
      )}

      <Footer report={report} onOpenSettings={onOpenSettings} onOpenHistory={onOpenHistory} />
    </>
  );
}

function LineAction({
  action,
  resolveAction,
  onAction,
}: {
  action: FeedbackAction | null;
  resolveAction?: (action: FeedbackAction | null) => ShownFeedbackAction | null;
  onAction?: (action: ShownFeedbackAction) => void;
}) {
  if (!resolveAction) return null;
  const shown = resolveAction(action);
  if (!shown) return null;
  return <FeedbackActionButton action={shown} onPress={() => onAction?.(shown)} />;
}

function SectionView({ section, action }: { section: FeedbackSection; action: (raw: FeedbackAction | null) => ReactNode }) {
  const { t } = useT();
  return (
    <View style={styles.section} testID={`feedback.section.${section.topic}`}>
      <LPText serif size={20} color={colors.paper} accessibilityRole="header" style={styles.sectionTitle}>
        {section.title ?? ''}
      </LPText>
      <Card style={[styles.margin, styles.sectionCard]}>
        {section.metrics.map((metric, index) => (
          <View key={`m-${index}`}>
            {index > 0 ? <View style={styles.rule} /> : null}
            <View
              style={styles.metric}
              accessible
              accessibilityLabel={t('feedback.a11y.metric', { label: metric.label ?? '', value: metric.value ?? '' })}
            >
              <LPText size={13} color={colors.paper2} style={styles.metricLabel}>
                {metric.label ?? ''}
              </LPText>
              <LPText size={14} weight="medium" color={colors.paper} align="right" style={styles.metricValue}>
                {metric.value ?? ''}
              </LPText>
            </View>
          </View>
        ))}
        {section.messages.map((message, index) => (
          <MessageRow
            key={`l-${index}`}
            message={message}
            divider={index > 0 || section.metrics.length > 0}
            size={14}
            color={colors.paper}
            action={action}
          />
        ))}
        {section.hint ? (
          <MessageRow
            message={section.hint}
            divider={section.metrics.length > 0 || section.messages.length > 0}
            size={13}
            color={colors.paper3}
            action={action}
          />
        ) : null}
      </Card>
    </View>
  );
}

function MessageRow({
  message,
  divider,
  size,
  color,
  action,
}: {
  message: FeedbackMessage;
  divider: boolean;
  size: number;
  color: string;
  action: (raw: FeedbackAction | null) => ReactNode;
}) {
  return (
    <View style={styles.message}>
      {divider ? <View style={styles.rule} /> : null}
      <LPText size={size} color={color} style={styles.messageText}>
        {message.text ?? ''}
      </LPText>
      <View style={styles.messageAction}>{action(message.action)}</View>
    </View>
  );
}

function Footer({ report, onOpenSettings, onOpenHistory }: Pick<ContentProps, 'report' | 'onOpenSettings' | 'onOpenHistory'>) {
  const { t } = useT();
  const showsHistory = report.kind === 'monthly' && onOpenHistory !== undefined;
  return (
    <View style={styles.footer}>
      {report.disclaimer ? (
        <LPText size={11} color={colors.paper3} testID="feedback.detail.disclaimer">
          {report.disclaimer}
        </LPText>
      ) : null}
      {onOpenSettings || showsHistory ? (
        <View style={styles.footerLinks}>
          {onOpenSettings ? (
            <FeedbackTextButton label={t('feedback.detail.settings')} onPress={onOpenSettings} testID="feedback.detail.settings" />
          ) : null}
          {showsHistory && onOpenHistory ? (
            <FeedbackTextButton label={t('feedback.detail.history')} onPress={onOpenHistory} testID="feedback.detail.history" />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  scroll: { flex: 1 },
  content: { paddingTop: 16, gap: 24 },
  skeletons: { gap: 20, paddingHorizontal: 20 },
  notFound: { paddingHorizontal: 24, paddingTop: 24 },
  header: { gap: 10, paddingHorizontal: 24 },
  leftOut: {
    marginHorizontal: 20,
    padding: 14,
    gap: 8,
    borderRadius: 12,
    backgroundColor: colors.ink3,
    alignItems: 'flex-start',
  },
  margin: { marginHorizontal: 20 },
  noteCard: { padding: 14, gap: 12 },
  section: { gap: 12 },
  sectionTitle: { paddingHorizontal: 24 },
  sectionCard: { paddingBottom: 4 },
  rule: { height: hairline, backgroundColor: colors.line },
  metric: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  metricLabel: { flex: 1 },
  metricValue: { flexShrink: 1, maxWidth: '55%' },
  message: { gap: 10 },
  messageText: { paddingHorizontal: 14, paddingTop: 12 },
  messageAction: { paddingHorizontal: 14, paddingBottom: 2 },
  footer: { gap: 8, paddingHorizontal: 24 },
  footerLinks: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16 },
});
