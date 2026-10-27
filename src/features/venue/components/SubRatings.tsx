/* eslint lifepass/no-literal-copy: "error" */
/**
 * A venue's Equipment and Cleanliness averages (API 0.46.0): "Tækjabúnaður
 * ★ 4,5" and "Hreinlæti ★ 4,8", from the stars members gave in their visit
 * ratings. The server sends a sub-score only once 3 or more members gave one,
 * so each row shows only when it is there, and the whole block is nothing
 * without either. Drawn in the venue page's reviews section (from the venue
 * row) and under the reviews page's average (from the reviews summary).
 *
 * TalkBack reads each row as one element: "Equipment, 4.5 out of 5 stars".
 */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { hiddenFromAccessibility, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';
import type { SubRating } from '../../../types/venue';
import { ratingText } from '../model';

export interface SubRatingRow {
  readonly key: 'equipment' | 'cleanliness';
  readonly labelKey: string;
  readonly value: SubRating;
}

/** The rows to show, Equipment first, as the website orders them; empty without either. */
export function subRatingRows(equipment: SubRating | null, cleanliness: SubRating | null): SubRatingRow[] {
  const rows: SubRatingRow[] = [];
  if (equipment) rows.push({ key: 'equipment', labelKey: 'venue.ratings.equipment', value: equipment });
  if (cleanliness) rows.push({ key: 'cleanliness', labelKey: 'venue.ratings.cleanliness', value: cleanliness });
  return rows;
}

export default function SubRatings({
  equipment,
  cleanliness,
  align = 'start',
  style,
  testID = 'venue.subratings',
}: {
  readonly equipment: SubRating | null;
  readonly cleanliness: SubRating | null;
  /** `center` under the reviews page's centred average. */
  readonly align?: 'start' | 'center';
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}) {
  const { t, language } = useT();
  const rows = subRatingRows(equipment, cleanliness);
  if (rows.length === 0) return null;
  return (
    <View style={[styles.rows, align === 'center' && styles.centred, style]} testID={testID}>
      {rows.map((row) => {
        const label = t(row.labelKey);
        const average = ratingText(row.value.average, language);
        return (
          <View
            key={row.key}
            style={styles.row}
            accessible
            accessibilityRole="text"
            accessibilityLabel={`${label}, ${t('venue2.a11y.rating', { count: average })}`}
            testID={`${testID}.${row.key}`}
          >
            <LPText size={12} color={colors.paper3}>
              {label}
            </LPText>
            <View {...hiddenFromAccessibility}>
              <Ionicons name="star" size={10} color={colors.signal} />
            </View>
            <LPText size={12} weight="semibold" color={colors.paper} style={styles.figure}>
              {average}
            </LPText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rows: { gap: 4 },
  centred: { alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  figure: { fontVariant: ['tabular-nums'] },
});
