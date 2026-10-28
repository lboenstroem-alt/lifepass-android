/* eslint lifepass/no-literal-copy: "error" */
// The lower half of the page (iOS VenueDetailView `openingHoursBlock` and
// `contactBlock`): the venue's usual weekly hours, only when it has hours, and
// "Getting there", only when there is an address, a phone or somewhere to
// give directions to.
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors, radius } from '../../../theme';
import { WEEKDAYS, type Venue } from '../../../types/venue';
import { hasDirections, hourText, showsGettingThere } from '../model';
import { DirectionsCapsule, SectionTitle } from './shared';

/**
 * "Hours" / "Usual hours": Monday to Sunday, each "06:00 – 22:00", "Closed" or a dash.
 * One weekly set staff edit, not this week's calendar (holidays and one-off
 * closures are not in it), so the kicker promises usual hours, as on iOS.
 */
export function OpeningHoursBlock({ venue }: { readonly venue: Venue }) {
  const { t } = useT();
  const hours = venue.openingHours;
  if (!hours) return null;
  return (
    <View style={styles.section} testID="venue.hours">
      <SectionTitle title={t('venue.hours')} kicker={t('venue.hours_usual')} />
      <View style={styles.hoursCard}>
        {WEEKDAYS.map((day, index) => {
          const value = hourText(hours[day], t);
          const color =
            value.kind === 'closed' ? colors.destructive : value.kind === 'open' ? colors.paper2 : colors.paper3;
          return (
            <View key={day}>
              {index > 0 ? <View style={styles.divider} /> : null}
              <View style={styles.hoursRow} accessible>
                <LPText size={13} weight="medium" color={colors.paper} style={styles.day}>
                  {t(`venue.day.${day}`)}
                </LPText>
                <LPText size={13} color={color} testID={`venue.hours.${day}`}>
                  {value.text}
                </LPText>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

type IoniconName = ComponentProps<typeof Ionicons>['name'];

function ContactRow({ icon, text }: { readonly icon: IoniconName; readonly text: string }) {
  return (
    <View style={styles.contactRow}>
      <Ionicons name={icon} size={16} color={colors.rust2} style={styles.contactIcon} />
      <LPText size={13} color={colors.paper} style={styles.contactText} selectable>
        {text}
      </LPText>
    </View>
  );
}

/**
 * "Getting there": the address, the same Directions capsule as at the top
 * (2.5.4: a member who scrolled down here need not scroll back up), and the
 * phone, as text.
 */
export function GettingThereBlock({ venue, onDirections }: { readonly venue: Venue; readonly onDirections: () => void }) {
  const { t } = useT();
  if (!showsGettingThere(venue)) return null;
  return (
    <View style={styles.section} testID="venue.getting_there">
      <SectionTitle title={t('venue.getting_there')} />
      <View style={styles.contactCard}>
        {venue.address !== null ? <ContactRow icon="location-outline" text={venue.address} /> : null}
        {hasDirections(venue) ? <DirectionsCapsule onPress={onDirections} style={styles.contactDirections} /> : null}
        {venue.phone !== null ? <ContactRow icon="call-outline" text={venue.phone} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  hoursCard: {
    paddingVertical: 4,
    backgroundColor: colors.ink2,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.line,
  },
  hoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  day: { minWidth: 92 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginHorizontal: 16 },
  contactCard: {
    padding: 14,
    gap: 10,
    backgroundColor: colors.ink2,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.line,
  },
  contactRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  contactIcon: { width: 20, marginTop: 1 },
  contactText: { flex: 1 },
  contactDirections: { marginLeft: 32 },
});
