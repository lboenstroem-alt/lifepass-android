// The confirm step's middle (iOS BookingChargeSection): a gate refusal in
// place of everything else, or the premium rung picker (BOOK-2) and the
// charge disclosure. Shared by the full flow and the class sheet (CLASS-2),
// so a money or refusal line reads the same wherever a member books.
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ctaLabelKey, type RefusalCta } from '../../../api/refusals';
import { LPText } from '../../../components/ui';
import { hiddenFromAccessibility } from '../../../components/ui/a11y';
import { useT } from '../../../i18n';
import { colors, parseColor, radius } from '../../../theme';
import { bookingCopy, type BookingIcon } from '../bookingCopy';
import {
  selectedVisitChoice,
  visitChoiceOptions,
  type BookingSessionStore,
  type GateRefusal,
} from '../bookingSession';
import VisitChoicePicker from '../party/VisitChoicePicker';
import { useBooking } from '../useBookingSession';

export interface BookingChargeSectionProps {
  readonly store: BookingSessionStore;
  /** Whether the screen can take a refusal's step (`useBookingRefusalSteps().offers`). */
  readonly offers: (cta: RefusalCta) => boolean;
  /** Takes a refusal's step (`useBookingRefusalSteps().take`). */
  readonly onStep: (cta: RefusalCta) => void;
}

export default function BookingChargeSection({ store, offers, onStep }: BookingChargeSectionProps) {
  const { t, language } = useT();
  const gateRefusal = useBooking(store, (s) => s.gateRefusal);
  const isLoadingPreview = useBooking(store, (s) => s.isLoadingPreview);
  const preview = useBooking(store, (s) => s.preview);
  const isBooking = useBooking(store, (s) => s.isBooking);
  const options = useBooking(store, visitChoiceOptions);
  const selected = useBooking(store, selectedVisitChoice);

  if (gateRefusal) return <BookingGateRefusalPanel refusal={gateRefusal} offers={offers} onStep={onStep} />;

  const copy = bookingCopy(language);
  return (
    <View style={styles.section}>
      {options.length > 0 ? (
        <VisitChoicePicker
          choices={options.map((option) => option.choice)}
          // Each rung's own price, so the picker can show what it costs (iOS
          // draws `Venue.iskPrefix(option.priceIsk)` on every row).
          options={options}
          selected={selected}
          onSelect={(choice) => void store.getState().changeVisitChoice(choice)}
          disabled={isBooking}
        />
      ) : null}
      {isLoadingPreview ? (
        <View style={styles.checking} accessible accessibilityLiveRegion="polite" testID="booking.preview.checking">
          <ActivityIndicator size="small" color={colors.actionFill} />
          <LPText size={12} color={colors.mutedTextStrong}>
            {t('consent.checking')}
          </LPText>
        </View>
      ) : preview ? (
        <BookingDisclosureNote icon={copy.disclosureIcon(preview)} text={copy.disclosureText(preview)} />
      ) : null}
    </View>
  );
}

export interface BookingGateRefusalPanelProps {
  readonly refusal: GateRefusal;
  readonly offers: (cta: RefusalCta) => boolean;
  readonly onStep: (cta: RefusalCta) => void;
}

/**
 * A refusal in place of the disclosure, in the member's words, with its next
 * step as a button whenever the screen can take it (2.5.5: not only "View
 * plans"). Confirm is hidden while it shows.
 */
export function BookingGateRefusalPanel({ refusal, offers, onStep }: BookingGateRefusalPanelProps) {
  const { t } = useT();
  const cta = refusal.cta && offers(refusal.cta) ? refusal.cta : null;
  return (
    <View style={styles.panel} testID="booking.refusal" accessibilityLiveRegion="polite">
      <View style={styles.panelText}>
        <View {...hiddenFromAccessibility} style={styles.icon}>
          <Ionicons name="alert-circle-outline" size={15} color={colors.destructive} />
        </View>
        <LPText size={13} style={styles.flex} testID="booking.refusal.message">
          {t(refusal.messageKey)}
        </LPText>
      </View>
      {cta ? (
        <Pressable
          onPress={() => onStep(cta)}
          accessibilityRole="button"
          accessibilityLabel={t(ctaLabelKey(cta))}
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
          testID="refusal.cta"
        >
          <LPText size={13} weight="semibold" color={colors.onAccent}>
            {t(ctaLabelKey(cta))}
          </LPText>
        </Pressable>
      ) : null}
    </View>
  );
}

/** An icon and a muted line on the accent wash: the disclosure's shape. */
export function BookingDisclosureNote({ icon, text }: { readonly icon: BookingIcon; readonly text: string }) {
  return (
    <View style={styles.note} testID="booking.disclosure">
      <View {...hiddenFromAccessibility} style={styles.icon}>
        <Ionicons name={icon} size={14} color={colors.accentText} />
      </View>
      <LPText size={12} color={colors.mutedTextStrong} style={styles.flex} testID="booking.disclosure.text">
        {text}
      </LPText>
    </View>
  );
}

/** A token at an opacity (iOS `Color.lpDestructive.opacity(0.08)`), so the panel follows the token. */
function tint(token: string, opacity: number): string {
  const [r, g, b, a] = parseColor(token);
  const channel = (value: number) => Math.round(value * 255);
  return `rgba(${channel(r)},${channel(g)},${channel(b)},${+(a * opacity).toFixed(3)})`;
}

const styles = StyleSheet.create({
  section: {
    gap: 12,
  },
  flex: {
    flex: 1,
  },
  checking: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  panel: {
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: tint(colors.destructive, 0.08),
    borderWidth: 1,
    borderColor: tint(colors.destructive, 0.25),
  },
  panelText: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  icon: {
    paddingTop: 2,
  },
  cta: {
    alignSelf: 'flex-start',
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.actionFill,
  },
  pressed: {
    opacity: 0.8,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.rust3,
  },
});
