/* eslint lifepass/no-literal-copy: "error" */
/**
 * "Report this reply" (Android only; Google Play's AI-generated content
 * policy): the sheet a Coach reply's "..." button, its long-press or
 * TalkBack's "Report this reply" action opens (src/screens/coach/MessageBubble.tsx).
 *
 *   Report this reply
 *   Only this reply and what you add here go to the LifePass team. ...
 *   What's wrong with it?
 *     ( ) Offensive or hateful
 *     ( ) Harmful or unsafe advice
 *     ( ) Wrong or misleading
 *     ( ) Something else
 *   [ Anything to add? (optional) ]          500 at most
 *   the reason it did not go through
 *   Send                                     off until a reason is chosen
 *   Cancel
 *
 * ONE PRESENTATION, ONE KEY. The parent mounts one instance per opening
 * (keyed), so each opening starts with nothing chosen and mints one
 * Idempotency-Key. A Send again after a failure the server may not have
 * seen (offline, a timeout, a 5xx) reuses it, so a report that did arrive
 * is never stored twice; after an answer that is final (429, a refusal) the
 * next Send is a new attempt with a new key (./outcome.ts).
 *
 * Success closes the sheet and the app's toast thanks the member. A failure
 * stays on the sheet, in words, with the choices kept. A session the client
 * has ended (`NotAuthenticatedError`) is the app's session-expired handling:
 * the app goes to sign-in, so the sheet only closes. A 401 whose refresh
 * only failed for a while keeps the session, so it is a failure in words
 * like any other (./outcome.ts). While the report is on its way
 * the sheet cannot be closed (pan, backdrop, hardware back); otherwise
 * hardware back closes it (the UI kit Sheet).
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type Text } from 'react-native';

import { newIdempotencyKey } from '../../../api';
import { announce, LPText, PrimaryButton, Sheet, SheetTextInput, showToast } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors, hairline, radius } from '../../../theme';

import {
  postReplyReport,
  REPLY_REPORT_NOTE_MAX,
  REPLY_REPORT_REASONS,
  replyReportBody,
  type ReplyReportBody,
  type ReplyReportReason,
  type ReplyReportReceipt,
} from './api';
import { replyReportFailure } from './outcome';

export type SendReplyReport = (
  body: ReplyReportBody,
  options: { readonly idempotencyKey: string; readonly signal?: AbortSignal },
) => Promise<ReplyReportReceipt>;

export interface ReplyReportSheetProps {
  readonly visible: boolean;
  /** The reply exactly as its bubble shows it. */
  readonly reply: string;
  /** Cancel, back, a pan down, the report sent, or a session that ended. */
  readonly onClose: () => void;
  /** The sheet has gone (the parent unmounts this presentation). */
  readonly onClosed?: () => void;
  /** Tests: the call (default `POST /coach/reports`). */
  readonly send?: SendReplyReport;
}

/** The copy key of a reason's row. */
export function replyReportReasonKey(reason: ReplyReportReason): string {
  return `coach.report.reason.${reason}`;
}

export default function ReplyReportSheet({ visible, reply, onClose, onClosed, send = postReplyReport }: ReplyReportSheetProps) {
  const { t, language } = useT();
  const titleRef = useRef<Text>(null);
  const [reason, setReason] = useState<ReplyReportReason | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Minted with the presentation, reused on a retry (see the header).
  const key = useRef<string | null>(null);
  if (key.current === null) key.current = newIdempotencyKey();
  const inFlight = useRef(false);
  const alive = useRef(true);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // The screen went (a sign-out): nothing is waited for or shown.
      abort.current?.abort();
    };
  }, []);

  const submit = async () => {
    if (!reason || inFlight.current) return;
    const body = replyReportBody({ reply, reason, note, language });
    if (!body) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    const controller = new AbortController();
    abort.current = controller;
    try {
      await send(body, { idempotencyKey: key.current ?? newIdempotencyKey(), signal: controller.signal });
      if (!alive.current) return;
      showToast(t('coach.report.sent'));
      onClose();
    } catch (caught) {
      if (!alive.current) return;
      const failure = replyReportFailure(caught);
      if (failure.kind === 'cancelled') return;
      if (failure.kind === 'signedOut') {
        onClose();
        return;
      }
      if (!failure.keepKey) key.current = newIdempotencyKey();
      setError(failure.message);
      announce(failure.message);
    } finally {
      inFlight.current = false;
      if (abort.current === controller) abort.current = null;
      if (alive.current) setSending(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      onClosed={onClosed}
      busy={sending}
      initialFocusRef={titleRef}
      testID="coach.report.sheet"
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <LPText ref={titleRef} serif size={24} color={colors.paper} accessibilityRole="header">
            {t('coach.report.title')}
          </LPText>
          <LPText size={13} color={colors.paper2}>
            {t('coach.report.privacy')}
          </LPText>
        </View>

        <View style={styles.block}>
          <LPText size={13} weight="semibold" color={colors.paper2}>
            {t('coach.report.reasons')}
          </LPText>
          <View style={styles.card} accessibilityRole="radiogroup">
            {REPLY_REPORT_REASONS.map((value, index) => (
              <ReasonRow
                key={value}
                label={t(replyReportReasonKey(value))}
                selected={reason === value}
                first={index === 0}
                disabled={sending}
                onPress={() => setReason(value)}
                testID={`coach.report.reason.${value}`}
              />
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <SheetTextInput
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={REPLY_REPORT_NOTE_MAX}
            editable={!sending}
            placeholder={t('coach.report.note')}
            placeholderTextColor={colors.paper3}
            accessibilityLabel={t('coach.report.note')}
            textAlignVertical="top"
            style={styles.input}
            testID="coach.report.note"
          />
        </View>

        {error ? (
          <View accessibilityLiveRegion="polite">
            <LPText size={13} color={colors.destructive} testID="coach.report.error">
              {error}
            </LPText>
          </View>
        ) : null}

        <PrimaryButton
          title={t('coach.report.send')}
          onPress={() => void submit()}
          disabled={reason === null}
          loading={sending}
          testID="coach.report.send"
        />

        <Pressable
          onPress={onClose}
          disabled={sending}
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel')}
          accessibilityState={{ disabled: sending }}
          style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
          testID="coach.report.cancel"
        >
          <LPText size={14} weight="semibold" color={colors.paper2}>
            {t('common.cancel')}
          </LPText>
        </Pressable>
      </View>
    </Sheet>
  );
}

function ReasonRow({
  label,
  selected,
  first,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  first: boolean;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, selected, disabled }}
      style={({ pressed }) => [styles.radioRow, !first && styles.radioDivider, pressed && styles.pressed]}
      testID={testID}
    >
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={18}
        color={selected ? colors.rust : colors.paper3}
        importantForAccessibility="no"
      />
      <LPText size={14} color={colors.paper} style={styles.flex}>
        {label}
      </LPText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: 18, paddingTop: 8, paddingBottom: 8 },
  header: { gap: 6 },
  block: { gap: 8 },
  card: {
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    minHeight: 48,
    paddingVertical: 8,
  },
  radioDivider: { borderTopWidth: hairline, borderTopColor: colors.line },
  field: {
    borderRadius: radius.field,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  input: {
    minHeight: 96,
    maxHeight: 160,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.paper,
  },
  cancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  flex: { flex: 1 },
});
