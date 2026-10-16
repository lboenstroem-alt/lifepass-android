/* eslint lifepass/no-literal-copy: "error" */
// The "Book it" pill on Home's venue cards (iOS HomeView's BookItPill). The
// whole card is already the tap target (it opens the venue), so this is a
// label, not a button: no nested tap, and TalkBack reads it with the card.
import { StyleSheet, View } from 'react-native';

import { useT } from '../i18n';
import { colors, radius } from '../theme';
import LPText from './ui/LPText';

type Props = {
  /** Stretch to fill the parent's width (the Nearby card). */
  fullWidth?: boolean;
};

export default function BookItPill({ fullWidth = false }: Props) {
  const { t } = useT();
  return (
    <View style={[styles.pill, fullWidth ? styles.fullWidth : styles.hugging]}>
      <LPText size={12} weight="semibold" color={colors.onAccent}>
        {t('coach.venue.book_it')}
      </LPText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    backgroundColor: colors.rust,
    borderRadius: radius.pill,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: { alignSelf: 'stretch' },
  hugging: { paddingHorizontal: 14 },
});
