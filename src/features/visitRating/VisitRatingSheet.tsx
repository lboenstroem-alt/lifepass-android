/* eslint lifepass/no-literal-copy: "error" */
/**
 * "How was your visit?": the sheet, mounted once by the tabs shell (outside
 * any screen, like the class sheet), so a card's star and a tapped
 * notification open the same one over whatever is showing (docs/05, "The
 * answer"; the copy is the contract's).
 *
 * THE FORM, top to bottom: the title and the venue name; Overall (needed
 * before Send); Equipment and Cleanliness, each "Optional"; the comment
 * ("Comment (optional)", at most 500 characters, "{count}/500"), or, when
 * the member already wrote a review of the venue, the note that the stars
 * replace the review's and its words stay; the public note. Send (off until
 * Overall is chosen) and "Not now" are pinned below, so they stay in reach
 * at every text size; at the accessibility sizes the sheet opens full height
 * and the form scrolls.
 *
 * THE THANK-YOU: "Thanks for rating!" and its line; while the member has no
 * written review, "Want to tell other members more?" and "Write a public
 * review", which opens the venue's page (where the app's review form is);
 * Done closes. A 4 or 5 star answer then lets the Google Play ask try its
 * own gates (src/features/storeReview), once the sheet has gone and never
 * when the member went on to write.
 *
 * A REFUSED SEND (./store.ts `send`): a closed ask (409), a voided visit
 * (403) or another member's ask (404) closes the sheet and says why in a
 * toast once it has gone; no answer, a 5xx or a 400 keeps the sheet with
 * "Couldn't send your rating. Try again." (Send sends the same answer again
 * under the same key); a 429 also holds Send back for its Retry-After.
 *
 * THE NOTIFICATION TAP (src/app/notificationRouter.ts parks it): the sheet
 * opens for whatever ask the server says is current, once no booking,
 * payment or check-in flow is on screen, within the intent store's window.
 *
 * A development build started with `visitRating=<variant>` puts the card or
 * the sheet in a known state, with no request (./fixtures.ts).
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { VISIT_RATING_COMMENT_MAX } from '../../api/visitRating';
import { flowOnScreen, subscribeFlowsOnScreen } from '../../app/flowsOnScreen';
import {
  announce,
  hiddenFromAccessibility,
  LPText,
  PrimaryButton,
  Sheet,
  SheetTextInput,
  showToast,
} from '../../components/ui';
import { useA11ySize } from '../../hooks/useA11ySize';
import { useT } from '../../i18n';
import { navigateInCurrentTab } from '../../navigation/navigationRef';
import { useIntentStore } from '../../stores/intentStore';
import { colors, hairline, minTouch, radius, sans } from '../../theme';

import { applyVisitRatingFixture, takeVisitRatingFixture } from './fixtures';
import StarRating from './StarRating';
import { canSend, type StarRow, type VisitRatingSheetState } from './store';
import { useVisitRating, visitRatingActions } from './useVisitRating';

/** Opens the sheet for a tapped notification once nothing it must not cover is on screen. */
function useNotificationTap(): void {
  const tappedAt = useIntentStore((state) => state.pendingVisitRatingTap);
  useEffect(() => {
    if (tappedAt === null) return;
    let done = false;
    let stop: (() => void) | null = null;
    const attempt = () => {
      if (done || flowOnScreen() !== null) return;
      done = true;
      stop?.();
      // Taken whether or not it is still fresh: a stale tap is dropped.
      if (useIntentStore.getState().takeVisitRatingTap()) void visitRatingActions().openFromNotification();
    };
    stop = subscribeFlowsOnScreen(attempt);
    attempt();
    return () => {
      done = true;
      stop?.();
    };
  }, [tappedAt]);
}

/** Re-renders when a 429's wait is over, so Send comes back by itself. */
function useSendUnblock(until: number | null): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (until === null) return;
    const wait = until - Date.now();
    if (wait <= 0) return;
    const timer = setTimeout(() => setTick((tick) => tick + 1), wait + 50);
    return () => clearTimeout(timer);
  }, [until]);
}

function StarsRow({
  sheet,
  row,
  labelKey,
  optional,
}: {
  sheet: VisitRatingSheetState;
  row: StarRow;
  labelKey: string;
  optional: boolean;
}) {
  const { t } = useT();
  const label = t(labelKey);
  const hint = t('visitRating.optional');
  return (
    <View style={styles.starsRow} testID={`visitRating.row.${row}`}>
      {/* Said by the stars themselves (their label), so not twice. */}
      <View style={styles.rowWords} {...hiddenFromAccessibility}>
        <LPText size={15} weight="semibold" color={colors.paper}>
          {label}
        </LPText>
        {optional ? (
          <LPText size={12} color={colors.mutedTextStrong}>
            {hint}
          </LPText>
        ) : null}
      </View>
      <StarRating
        label={optional ? `${label}, ${hint}` : label}
        value={sheet[row]}
        onChange={(value) => visitRatingActions().setStars(row, value)}
        clearable={optional}
        disabled={sheet.phase !== 'form'}
        size={row === 'overall' ? 34 : 28}
        testID={`visitRating.stars.${row}`}
      />
    </View>
  );
}

function Form({ sheet }: { sheet: VisitRatingSheetState }) {
  const { t } = useT();
  return (
    <View style={styles.form}>
      <StarsRow sheet={sheet} row="overall" labelKey="visitRating.overall" optional={false} />
      <StarsRow sheet={sheet} row="equipment" labelKey="visitRating.equipment" optional />
      <StarsRow sheet={sheet} row="cleanliness" labelKey="visitRating.cleanliness" optional />

      {sheet.hasWrittenReview ? (
        <LPText size={13} color={colors.mutedTextStrong} testID="visitRating.replaceNote">
          {t('visitRating.replaceNote')}
        </LPText>
      ) : (
        <View style={styles.comment}>
          {/* The field says its own label to TalkBack. */}
          <LPText size={13} weight="semibold" color={colors.paper2} importantForAccessibility="no">
            {t('visitRating.comment.label')}
          </LPText>
          <SheetTextInput
            value={sheet.comment}
            onChangeText={(text) => visitRatingActions().setComment(text)}
            placeholder={t('visitRating.comment.placeholder')}
            placeholderTextColor={colors.paper3}
            accessibilityLabel={t('visitRating.comment.label')}
            editable={sheet.phase === 'form'}
            maxLength={VISIT_RATING_COMMENT_MAX}
            multiline
            textAlignVertical="top"
            style={styles.input}
            testID="visitRating.comment"
          />
          <LPText size={11} color={colors.mutedTextStrong} align="right" testID="visitRating.counter">
            {t('visitRating.counter', { count: sheet.comment.length })}
          </LPText>
        </View>
      )}

      <LPText size={12} color={colors.mutedTextStrong} testID="visitRating.publicNote">
        {t('visitRating.publicNote')}
      </LPText>
    </View>
  );
}

function Thanks({ sheet, onWriteReview }: { sheet: VisitRatingSheetState; onWriteReview: () => void }) {
  const { t } = useT();
  const offersReview = !sheet.hasWrittenReview && sheet.prompt.venueSlug !== null;
  return (
    <View style={styles.thanks} testID="visitRating.thanks">
      <LPText size={15} color={colors.mutedTextStrong}>
        {t('visitRating.thanks.line')}
      </LPText>
      {offersReview ? (
        <View style={styles.more}>
          <LPText size={15} color={colors.paper2}>
            {t('visitRating.thanks.more')}
          </LPText>
          <Pressable
            onPress={onWriteReview}
            accessibilityRole="button"
            style={({ pressed }) => [styles.reviewButton, pressed && styles.pressed]}
            testID="visitRating.writeReview"
          >
            <LPText size={15} weight="semibold" color={colors.accentText}>
              {t('visitRating.thanks.writeReview')}
            </LPText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export default function VisitRatingSheetHost() {
  const { t } = useT();
  const { isAccessibilitySize } = useA11ySize();
  const sheet = useVisitRating((state) => state.sheet);
  useNotificationTap();
  useSendUnblock(sheet?.sendBlockedUntil ?? null);

  // A development build started with `visitRating=<variant>` (./fixtures.ts), once.
  useEffect(() => {
    const variant = takeVisitRatingFixture();
    if (variant) void applyVisitRatingFixture(variant);
  }, []);

  // The thank-you replaces the form under TalkBack's focus: say it.
  const thanked = sheet?.phase === 'thanks';
  useEffect(() => {
    if (thanked) announce(`${t('visitRating.thanks.title')} ${t('visitRating.thanks.line')}`);
  }, [thanked, t]);

  // What is on screen, kept while the sheet slides away so it keeps its words.
  const lastShown = useRef<VisitRatingSheetState | null>(null);
  if (sheet) lastShown.current = sheet;
  const shown = sheet ?? lastShown.current;
  // The venue page "Write a public review" opens once the sheet has gone (a
  // page opened while a sheet is up opens under it).
  const reviewSlug = useRef<string | null>(null);
  const titleRef = useRef(null);

  if (!shown) return null;

  const thanks = shown.phase === 'thanks';
  const sending = shown.phase === 'sending';
  const sendable = canSend(shown);

  const writeReview = () => {
    const prompt = visitRatingActions().writeReview();
    reviewSlug.current = prompt?.venueSlug ?? null;
  };

  const gone = () => {
    lastShown.current = null;
    const actions = visitRatingActions();
    actions.sheetGone();
    const notice = actions.takeNotice();
    if (notice) showToast(t(notice));
    const slug = reviewSlug.current;
    reviewSlug.current = null;
    if (slug) navigateInCurrentTab('VenueDetail', { slug });
  };

  const footer = thanks ? (
    <PrimaryButton title={t('visitRating.close')} onPress={() => visitRatingActions().closeSheet()} testID="visitRating.done" />
  ) : (
    <>
      {shown.errorKey ? (
        <LPText
          size={13}
          color={colors.destructive}
          align="center"
          accessibilityLiveRegion="polite"
          testID="visitRating.error"
        >
          {t(shown.errorKey)}
        </LPText>
      ) : null}
      <PrimaryButton
        title={t('visitRating.send')}
        onPress={() => void visitRatingActions().send()}
        disabled={!sendable && !sending}
        loading={sending}
        style={!sendable && !sending ? styles.dimmed : undefined}
        testID="visitRating.send"
      />
      <Pressable
        onPress={() => visitRatingActions().notNow()}
        disabled={sending}
        accessibilityRole="button"
        accessibilityState={{ disabled: sending }}
        style={({ pressed }) => [styles.notNow, pressed && styles.pressed]}
        testID="visitRating.notNow"
      >
        <LPText size={15} weight="medium" color={colors.paper2}>
          {t('visitRating.dismiss')}
        </LPText>
      </Pressable>
    </>
  );

  return (
    <Sheet
      visible={sheet !== null}
      onClose={() => visitRatingActions().closeSheet()}
      onClosed={gone}
      busy={sending}
      fullHeight={isAccessibilitySize}
      footer={footer}
      initialFocusRef={titleRef}
      testID="visitRating.sheet"
    >
      <View style={styles.header}>
        <LPText ref={titleRef} serif size={24} tracking={-0.4} color={colors.paper} accessibilityRole="header">
          {t(thanks ? 'visitRating.thanks.title' : 'visitRating.sheet.title')}
        </LPText>
        <LPText size={15} weight="medium" color={colors.paper2} testID="visitRating.venue">
          {shown.prompt.venueName}
        </LPText>
      </View>
      {thanks ? <Thanks sheet={shown} onWriteReview={writeReview} /> : <Form sheet={shown} />}
    </Sheet>
  );
}

// Four lines of 15 dp text: room for a short comment without pushing the
// note and Send away; a longer one scrolls inside the box.
const INPUT_LINE = 20;
const INPUT_HEIGHT = INPUT_LINE * 4 + 24;

const styles = StyleSheet.create({
  header: { gap: 4, paddingBottom: 16 },
  form: { gap: 18, paddingBottom: 8 },
  starsRow: { gap: 4 },
  rowWords: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 8 },
  comment: { gap: 6 },
  input: {
    ...sans(15),
    color: colors.paper,
    minHeight: INPUT_HEIGHT,
    maxHeight: INPUT_HEIGHT,
    lineHeight: INPUT_LINE,
    padding: 12,
    backgroundColor: colors.ink2,
    borderRadius: radius.field,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  thanks: { gap: 16, paddingBottom: 8 },
  more: { gap: 6 },
  reviewButton: { minHeight: minTouch, justifyContent: 'center', alignSelf: 'flex-start' },
  notNow: { minHeight: minTouch, alignItems: 'center', justifyContent: 'center' },
  dimmed: { opacity: 0.5 },
  pressed: { opacity: 0.6 },
});
