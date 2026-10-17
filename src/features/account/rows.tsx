/* eslint lifepass/no-literal-copy: "error" */
/**
 * The account row primitives: the port of iOS `AccountRowLabel`,
 * `AccountRowButton`, `AccountRowDivider`, `AccountCard` and
 * `AccountSection` (Views/Profile/AccountRows.swift).
 *
 * WHY THEY ARE SHARED. Body and goals is reached from the account list and
 * looks like part of it, and the Account slots (identity, cancel, deletion,
 * Body and goals) are filled by other packages: two copies of a 14 pt row
 * with a chevron drift within a release and the seam shows the moment a
 * member walks from one to the other. Import them from the feature's index:
 *
 *   import { AccountRowButton } from '../index';         // inside account/
 *   import { AccountRowButton } from '../../account';    // another feature
 *
 * DIVIDERS DRAW THEMSELVES. On iOS every call site writes `divider` between
 * two rows. Here a slot may render nothing (a slot whose package has not
 * landed, the identity row before the profile loads, the cancel row once a
 * cancellation is scheduled), and a divider written next to it would then
 * hang at the end of the card or double up. So every row draws the hairline
 * ABOVE itself, and `AccountCard` hides the first one: its content sits one
 * hairline higher, under the card's clipped top edge. A slot only renders
 * `AccountRowButton`s (or `AccountRowLabel`s); where it renders nothing, no
 * line is left behind.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Kicker, LPText } from '../../components/ui';
import { colors, hairline, radius } from '../../theme';

/** The hairline between two rows of the same card (inset 16, as iOS pads it). */
export function AccountRowDivider() {
  return <View style={styles.divider} importantForAccessibility="no" accessibilityElementsHidden />;
}

export interface AccountRowLabelProps {
  readonly title: string;
  readonly subtitle?: string | null;
  readonly destructive?: boolean;
  /** A row that does no navigation (Log out): dimmed, no chevron. */
  readonly dim?: boolean;
  /** Force the chevron on or off (a row that acts in place, a value row). Default: on unless `dim`. */
  readonly showsChevron?: boolean;
  /** Drawn where the chevron goes, instead of it (the share icon, a verified seal). */
  readonly accessory?: ReactNode;
  /** The row's opacity, for a row shown but not usable (iOS `.opacity(0.55)`). */
  readonly opacity?: number;
  readonly testID?: string;
}

/** What TalkBack reads for a row: the title, then the subtitle. */
export function accountRowLabel(title: string, subtitle?: string | null): string {
  return subtitle ? `${title}, ${subtitle}` : title;
}

/** The row's words and its chevron or accessory, without the hairline above it. */
function RowContent({ title, subtitle, destructive = false, dim = false, showsChevron, accessory }: AccountRowLabelProps) {
  const chevron = showsChevron ?? !dim;
  const titleColor = destructive ? colors.destructive : dim ? colors.paper3 : colors.paper;
  return (
    <View style={styles.row}>
      <View style={styles.words}>
        <LPText size={14} weight="medium" color={titleColor}>
          {title}
        </LPText>
        {subtitle ? (
          <LPText size={11} color={colors.paper3}>
            {subtitle}
          </LPText>
        ) : null}
      </View>
      {accessory ? (
        <View style={styles.accessory} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {accessory}
        </View>
      ) : chevron ? (
        <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden testID="account.row.chevron">
          <Ionicons name="chevron-forward" size={13} color={colors.paper3} />
        </View>
      ) : null}
    </View>
  );
}

/** A row that is not a button: a statement (verified identity), or a row a minor cannot open. */
export function AccountRowLabel(props: AccountRowLabelProps) {
  const { title, subtitle, opacity, testID } = props;
  return (
    <View testID={testID} style={opacity !== undefined && { opacity }}>
      <AccountRowDivider />
      <View accessible accessibilityLabel={accountRowLabel(title, subtitle)} accessibilityRole="text">
        <RowContent {...props} />
      </View>
    </View>
  );
}

export interface AccountRowButtonProps extends AccountRowLabelProps {
  readonly onPress: () => void;
  /** Drawn at 0.45 and not pressable when false (iOS `isEnabled`). */
  readonly isEnabled?: boolean;
  readonly accessibilityHint?: string;
}

/** A tappable row: the whole row is the target, the hairline above it is not. */
export function AccountRowButton(props: AccountRowButtonProps) {
  const { title, subtitle, onPress, isEnabled = true, accessibilityHint, testID, opacity } = props;
  return (
    <View style={[!isEnabled && styles.disabled, opacity !== undefined && { opacity }]}>
      <AccountRowDivider />
      <Pressable
        testID={testID}
        onPress={onPress}
        disabled={!isEnabled}
        accessibilityRole="button"
        accessibilityLabel={accountRowLabel(title, subtitle)}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: !isEnabled }}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <RowContent {...props} />
      </Pressable>
    </View>
  );
}

/** The card every group of rows sits in: ink2, corner 14, a 0.5 hairline. Hides the first row's divider. */
export function AccountCard({ children, testID }: { readonly children: ReactNode; readonly testID?: string }) {
  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.cardContent} testID={testID ? `${testID}.content` : undefined}>
        {children}
      </View>
    </View>
  );
}

/** A card with a kicker above it: how every Account and Body and goals section is built. */
export function AccountSection({
  kicker,
  children,
  testID,
}: {
  readonly kicker: string;
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.kicker}>
        <Kicker text={kicker} color={colors.paper3} accessibilityRole="header" />
      </View>
      <AccountCard>{children}</AccountCard>
    </View>
  );
}

const styles = StyleSheet.create({
  divider: { height: hairline, backgroundColor: colors.line, marginHorizontal: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  words: { flex: 1, gap: 2 },
  accessory: { marginLeft: 8 },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.45 },
  card: {
    backgroundColor: colors.ink2,
    borderRadius: radius.card,
    borderWidth: hairline,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  // One hairline up: the first row's divider sits under the clipped top edge.
  cardContent: { marginTop: -hairline },
  section: { gap: 10 },
  kicker: { paddingHorizontal: 4 },
});
