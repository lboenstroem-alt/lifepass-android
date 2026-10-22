/**
 * Plan's monthly feedback section (iOS PlanView `feedbackSection`, `SPEC`
 * 9.2): the card right after the weekly review, filled by FEED-1 and mounted
 * by PLAN-1 with no props (plan 3.0.3).
 *
 * Drawn only while the server advertises `health_feedback` (and FB-1 has not
 * 404'd under that list), the member's consent stands and the strip shows
 * today, and only when the card has something to draw. Nothing at all
 * otherwise, which is the page without the feature exactly.
 *
 * What the card's buttons do, as on iOS:
 *   See your month / the row    the report, pushed (`feedback_opened`, card)
 *   Past months                 the history, pushed
 *   Choose what is in it        Body and goals on its feedback section
 *   a line's action             ../../feedback actions (Plan to its root, then
 *                               the Coach, Change days or the meal page)
 *   Hide                        the note goes now; a failed hide puts it back
 *   the note on screen          marked seen, only while Plan's first screen is
 *                               the one showing (Android keeps the tab and the
 *                               screens under a pushed one mounted)
 *   Got it                      the intro goes for good
 *   Include food and weight     the switch, then "Food and weight are now in
 *                               your feedback." when it took
 *   Not now                     the switch stays off, the offer goes for good
 */
import { useAppStore } from '../../../stores/appStore';
import { useHealthStore } from '../../../health/store';
import { track } from '../../../lib/analytics';
import {
  FeedbackCard,
  isCardEmpty,
  tapFeedbackAction,
  useFeedbackActionResolver,
  useFeedbackCardState,
  useFeedbackStore,
  useScreenFocused,
  useSupportsFeedback,
} from '../../feedback';
import { pushPlanRoute, usePlanView } from '../shell';

export default function FeedbackSection() {
  const view = usePlanView();
  const onScreen = useScreenFocused();
  const supports = useSupportsFeedback();
  const profileId = useAppStore((s) => s.profile?.id ?? null);
  const state = useFeedbackCardState();
  const resolveAction = useFeedbackActionResolver();

  if (!profileId || !supports || !view.hasConsent || !view.isShowingToday || isCardEmpty(state)) return null;

  const store = useFeedbackStore.getState();
  return (
    <FeedbackCard
      state={state}
      resolveAction={resolveAction}
      onOpenReport={(reportId) => {
        track('feedback_opened', { entry: 'card' });
        pushPlanRoute('FeedbackReport', { reportId });
      }}
      onOpenHistory={() => pushPlanRoute('FeedbackHistory')}
      onChooseSettings={() => pushPlanRoute('BodyAndGoals', { anchor: 'feedback' })}
      onAction={(action) => tapFeedbackAction(action, { fromPushedScreen: false })}
      onDismissNote={(id) => void store.dismissNote(id)}
      onNoteSeen={(id) => void store.markSeen(id)}
      onScreen={onScreen}
      onIntroClosed={() => void store.dismissIntro(profileId)}
      onIncludeFood={() => {
        void store.answerFoodOffer(true, profileId).then(() => {
          if (useFeedbackStore.getState().summary?.settings?.includeFoodAndWeight === true) {
            useHealthStore.getState().setToast('feedback.offer.done');
          }
        });
      }}
      onDeclineFood={() => void store.answerFoodOffer(false, profileId)}
      testID="feedback.section"
    />
  );
}
