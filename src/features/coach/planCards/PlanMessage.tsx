/* eslint lifepass/no-literal-copy: "error" */
/**
 * A day plan in the Coach chat (iOS CoachPlanView.swift): the intro bubble,
 * then the steps in Before / Main / After order, each with its uppercase
 * slot label, its note and its card on a rust dot rail, then the
 * refinement chips and "Plan something else".
 *
 * - A venue step is drawn from the plan's own fields until the venue's full
 *   row loads (by slug, right after the plan lands), then as the carousel's
 *   card with the heart and price pill. Either way "Book it" opens the
 *   venue's page.
 * - A class step's Book opens the class sheet on that exact session, or the
 *   venue's page when the feed has no such class.
 * - A sight step opens the sight's card.
 * - The chips wait while a reply is in flight (`busy`): a second tap must
 *   not spend a second call.
 *
 * The message's `text` is the intro: what the saved chat keeps once the
 * cards are gone, and what the model reads of it on a later free chat.
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Kicker, LPText } from '../../../components/ui';
import { hiddenFromAccessibility } from '../../../components/ui/a11y';
import { useT } from '../../../i18n';
import { assistantBubbleStyle, CoachAssistantAvatar, MessageBubble } from '../../../screens/coach/MessageBubble';
import { VenueMiniCard } from '../../../screens/coach/VenueCarouselMessage';
import type { Venue } from '../../../types/venue';
import { planDistanceLabel, type CoachPlanStep } from '../dayPlan/decode';
import { refineChipLabel } from '../dayPlan/model';
import { bookPlanClass, openPlanSight, openPlanVenue, planPayloadOf, refineDayPlan, restartDayPlan } from '../dayPlan/wizard';
import type { CoachMessageRendererProps } from '../flows/types';
import { coachPalette } from '../theme/palette';
import { PLAN_INDENT, PLAN_STEP_INSET, planCardWidth, PlanClassCard, PlanSightCard, PlanVenueCard } from './PlanCards';

export default function PlanMessage({ message, busy }: CoachMessageRendererProps) {
  const { t } = useT();
  // iOS's 250, narrowed on a window too small for it (./PlanCards.tsx `planCardWidth`).
  const cardWidth = planCardWidth(useWindowDimensions().width);
  const payload = planPayloadOf(message);
  if (!payload) return <MessageBubble role="assistant" text={message.text} />;
  const { plan, venues } = payload;

  return (
    <View style={styles.root} testID={`coach.plan.${message.id}`}>
      <View style={styles.introRow}>
        <CoachAssistantAvatar />
        <View style={[styles.intro, assistantBubbleStyle]}>
          <LPText size={14} color={coachPalette.textPrimary} style={styles.introText}>
            {message.text}
          </LPText>
        </View>
      </View>

      <View style={styles.indent}>
        {plan.steps.map((step, index) => (
          <StepRow
            key={`${index}-${step.id}`}
            step={step}
            venues={venues}
            isLast={index === plan.steps.length - 1}
            cardWidth={cardWidth}
          />
        ))}
      </View>

      <View style={[styles.indent, styles.chips]}>
        {plan.chips.map((chip) => {
          const label = refineChipLabel(chip, t);
          return (
            <Pressable
              key={chip}
              onPress={() => void refineDayPlan(message.id, chip)}
              disabled={busy}
              style={({ pressed }) => [styles.chip, styles.refineChip, (busy || pressed) && styles.dimmed]}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ disabled: busy }}
              testID={`coach.plan.chip.${chip}`}
            >
              <LPText size={13} weight="medium" color={coachPalette.textPrimary}>
                {label}
              </LPText>
            </Pressable>
          );
        })}
        <Pressable
          onPress={restartDayPlan}
          disabled={busy}
          style={({ pressed }) => [styles.chip, styles.newPlan, (busy || pressed) && styles.dimmed]}
          accessibilityRole="button"
          accessibilityLabel={t('coach.plan.new')}
          accessibilityState={{ disabled: busy }}
          testID="coach.plan.new"
        >
          <MaterialCommunityIcons name="rotate-left" size={13} color={coachPalette.textSecondary} {...hiddenFromAccessibility} />
          <LPText size={13} weight="medium" color={coachPalette.textSecondary}>
            {t('coach.plan.new')}
          </LPText>
        </Pressable>
      </View>
    </View>
  );
}

/** One step: the slot label, the note and the card, on the rail (a dot, and a line on to the next step). */
function StepRow({
  step,
  venues,
  isLast,
  cardWidth,
}: {
  step: CoachPlanStep;
  venues: Readonly<Record<string, Venue>>;
  isLast: boolean;
  cardWidth: number;
}) {
  const { t, language } = useT();
  const distance = step.distance ? planDistanceLabel(step.distance, language, t) : null;
  const basis = step.distance?.basis ?? null;

  return (
    <View style={[styles.step, !isLast && styles.stepGap]} testID={`coach.plan.step.${step.id}`}>
      {/* The rail rides behind the step, so it is exactly as tall as the step whatever the card's height. */}
      <View style={styles.rail} {...hiddenFromAccessibility}>
        {!isLast ? <View style={styles.railLine} /> : null}
        <View style={styles.railDot} />
      </View>

      <Kicker text={t(`coach.plan.slot.${step.slot}`)} color={coachPalette.textMeta} style={styles.slot} />
      {step.note !== '' ? (
        <LPText size={13} color={coachPalette.textSecondary} style={[styles.note, { maxWidth: cardWidth + 20 }]}>
          {step.note}
        </LPText>
      ) : null}

      <StepCard step={step} venues={venues} distance={distance} basis={basis} width={cardWidth} />
    </View>
  );
}

function StepCard({
  step,
  venues,
  distance,
  basis,
  width,
}: {
  step: CoachPlanStep;
  venues: Readonly<Record<string, Venue>>;
  distance: string | null;
  basis: 'drive' | 'straight_line' | null;
  width: number;
}) {
  switch (step.kind) {
    case 'venue': {
      const full = venues[step.venue.slug];
      if (full) {
        return <VenueMiniCard venue={full} onBook={(venue) => openPlanVenue(venue.slug)} detailLine={distance} width={width} />;
      }
      return <PlanVenueCard venue={step.venue} detailLine={distance} onOpen={() => openPlanVenue(step.venue.slug)} width={width} />;
    }
    case 'class':
      return <PlanClassCard session={step.classSession} distance={distance} basis={basis} onBook={bookPlanClass} width={width} />;
    case 'sight':
      return (
        <PlanSightCard sight={step.sight} distance={distance} basis={basis} onOpen={() => openPlanSight(step.sight.slug)} width={width} />
      );
  }
}

const styles = StyleSheet.create({
  root: { gap: 14, alignSelf: 'stretch' },
  introRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  intro: { paddingHorizontal: 14, paddingVertical: 10, flexShrink: 1 },
  introText: { lineHeight: 20 },
  indent: { paddingLeft: PLAN_INDENT },
  step: { paddingLeft: PLAN_STEP_INSET, gap: 6, alignItems: 'flex-start' },
  stepGap: { paddingBottom: 20 },
  rail: { position: 'absolute', left: 2, top: 0, bottom: 0, width: 10, alignItems: 'center' },
  railLine: { position: 'absolute', top: 12, bottom: 0, width: 1.5, backgroundColor: coachPalette.stroke },
  railDot: { marginTop: 2, width: 10, height: 10, borderRadius: 5, backgroundColor: coachPalette.accent },
  slot: { fontFamily: 'monospace', fontSize: 10, letterSpacing: 1.4 },
  note: { lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    borderRadius: 999,
    borderWidth: 0.8,
    borderColor: coachPalette.stroke,
  },
  refineChip: { backgroundColor: coachPalette.tile },
  newPlan: {},
  dimmed: { opacity: 0.5 },
});
