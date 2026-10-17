/**
 * Root modal `WriteReview` ({ venueId, venueName }): the Android port of iOS
 * `WriteReviewSheet` (Views/Venues/VenueDetailView.swift).
 *
 *   - "Cancel" on the left of the inline title "Write a review" (and hardware
 *     back) closes it without sending.
 *   - "How was your experience?", five stars to pick from, "Comments" with
 *     the placeholder "Tell other members what made this venue special…",
 *     and under the field a counter "{n}/50" while the trimmed comment is
 *     under 50 characters (the server's minimum, counted as Swift counts
 *     characters).
 *   - "Submit review" ("Submitting…" while it is sent) is off until there is
 *     a rating and 50 or more trimmed characters.
 *   - Submit sends the rating, the trimmed comment and today's date (UTC) with
 *     a new Idempotency-Key. A refusal shows in red under the field in the
 *     formatter's words. On success the venue's reviews are read again (the
 *     venue page's block and the reviews page show the new one) and the sheet
 *     closes.
 */
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { errorMessage } from '../../../api';
import { hiddenFromAccessibility, Kicker, LPText, PrimaryButton } from '../../../components/ui';
import { useT } from '../../../i18n';
import type { RootModalProps } from '../../../navigation/types';
import { colors, hairline, radius, sans } from '../../../theme';
import { postVenueReview } from './api';
import { ReviewsHeader } from './components';
import { canSubmitReview, commentCounterText, isCommentTooShort, reviewGuardKey, trimComment } from './model';
import { loadVenueReviews } from './store';

/** The keyboard's height while it is up (edge to edge, the window is never resized for it). */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) => setHeight(event.endCoordinates.height));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return height;
}

export default function WriteReviewScreen({ navigation, route }: RootModalProps<'WriteReview'>) {
  const { venueId } = route.params;
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  // Set synchronously, so two taps landing before the "Submitting…" render
  // still send one review (iOS disables the button in the same pass).
  const inFlight = useRef(false);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const tooShort = isCommentTooShort(comment);
  const enabled = canSubmitReview(rating, comment, submitting);

  const submit = async () => {
    if (inFlight.current) return;
    // The guard iOS runs first: the server refuses a rating outside 1 to 5
    // and a comment under 50 characters.
    const guard = reviewGuardKey(rating, comment);
    if (guard) {
      setError(t(guard));
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await postVenueReview(venueId, { rating, comment: trimComment(comment) });
    } catch (e) {
      inFlight.current = false;
      if (mounted.current) {
        setError(errorMessage(e));
        setSubmitting(false);
      }
      return;
    }
    inFlight.current = false;
    // iOS `onSubmitted` reloads the reviews, then the sheet dismisses. The
    // reload runs even if the member already closed the sheet.
    void loadVenueReviews(venueId, { force: true }).catch(() => null);
    if (mounted.current) {
      setSubmitting(false);
      navigation.goBack();
    }
  };

  return (
    <View style={styles.page} testID="write-review-screen">
      <ReviewsHeader
        title={t('venue.write_review')}
        action={t('common.cancel')}
        actionSide="leading"
        actionColor={colors.paper2}
        onAction={() => navigation.goBack()}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: 20 + Math.max(insets.bottom, keyboardHeight) }]}
      >
        <LPText serif size={22} tracking={-0.4} align="center" accessibilityRole="header" style={styles.question}>
          {t('venue.review_how')}
        </LPText>

        <View style={styles.picker} accessibilityRole="radiogroup">
          {[1, 2, 3, 4, 5].map((i) => {
            const on = i <= rating;
            return (
              <Pressable
                key={i}
                onPress={() => setRating(i)}
                accessibilityRole="radio"
                accessibilityLabel={t('venue2.a11y.rating', { count: i })}
                accessibilityState={{ checked: i === rating }}
                hitSlop={4}
                testID={`write-review-star-${i}`}
              >
                <Ionicons
                  name={on ? 'star' : 'star-outline'}
                  size={36}
                  color={on ? colors.signal : colors.paper4}
                  style={on ? styles.starOn : null}
                  {...hiddenFromAccessibility}
                />
              </Pressable>
            );
          })}
        </View>

        <View style={styles.commentBlock}>
          <Kicker text={t('venue.review_comments')} color={colors.paper3} />
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder={t('venue.review_placeholder')}
            placeholderTextColor={colors.paper3}
            accessibilityLabel={t('venue.review_comments')}
            multiline
            textAlignVertical="top"
            selectionColor={colors.rust}
            cursorColor={colors.rust}
            style={styles.input}
            testID="write-review-comment"
          />
          {tooShort ? (
            <LPText size={11} color={colors.paper3} align="right" testID="write-review-counter">
              {commentCounterText(comment)}
            </LPText>
          ) : null}
        </View>

        {error ? (
          <LPText
            size={13}
            color={colors.destructive}
            align="center"
            accessibilityLiveRegion="polite"
            testID="write-review-error"
          >
            {error}
          </LPText>
        ) : null}

        <PrimaryButton
          title={submitting ? t('venue.review_submitting') : t('venue.review_submit')}
          onPress={() => void submit()}
          disabled={!enabled}
          // iOS dims the refused button to 50 %.
          style={!enabled ? styles.dimmed : undefined}
          testID="write-review-submit"
        />
      </ScrollView>
    </View>
  );
}

// Five lines of 15 pt text, the room iOS reserves (`lineLimit(5, reservesSpace: true)`).
const INPUT_LINE = 20;

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  content: { padding: 20, gap: 28 },
  question: { paddingTop: 8 },
  picker: { flexDirection: 'row', justifyContent: 'center', gap: 12, paddingVertical: 8 },
  starOn: { transform: [{ scale: 1.1 }] },
  commentBlock: { gap: 6, paddingHorizontal: 4 },
  input: {
    ...sans(15),
    color: colors.paper,
    minHeight: INPUT_LINE * 5 + 28,
    lineHeight: INPUT_LINE,
    padding: 14,
    backgroundColor: colors.ink2,
    borderRadius: radius.field,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  dimmed: { opacity: 0.5 },
});
