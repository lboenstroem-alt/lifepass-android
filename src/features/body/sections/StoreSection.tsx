/**
 * 6. What we store (iOS `storeSection`): one row, "What we store and why",
 * that opens to the consent sheet's own lines (a second wording of the same
 * promise is a second promise to keep in step) and how long each kind is
 * kept. Shown with or without consent: it is what the member would be
 * agreeing to.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';
import { AccountRowDivider, AccountSection } from '../../account';

import { RETENTION_KEY, STORE_LINE_KEYS } from '../model';

export default function StoreSection() {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const title = t('bodygoals.store_title');
  return (
    <AccountSection kicker={t('healthconsent.store.kicker')} testID="bodygoals.store">
      <AccountRowDivider />
      <View style={styles.block}>
        <Pressable
          onPress={() => setExpanded((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ expanded }}
          style={({ pressed }) => [styles.disclosure, pressed && styles.pressed]}
          testID="bodygoals.store.toggle"
        >
          <LPText size={14} weight="medium" color={colors.paper} style={styles.title}>
            {title}
          </LPText>
          <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={13} color={colors.paper3} />
        </Pressable>
        {expanded ? (
          <View style={styles.lines} testID="bodygoals.store.lines">
            {[...STORE_LINE_KEYS, RETENTION_KEY].map((key) => (
              <LPText key={key} size={13} color={colors.paper2}>
                {t(key)}
              </LPText>
            ))}
          </View>
        ) : null}
      </View>
    </AccountSection>
  );
}

const styles = StyleSheet.create({
  block: { paddingHorizontal: 16, paddingVertical: 6 },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  title: { flex: 1 },
  pressed: { opacity: 0.6 },
  lines: { gap: 10, paddingTop: 10, paddingBottom: 8 },
});
