/**
 * Stand-ins for the Account slots that draw the way their fillers draw on
 * their own branches, hairlines included, so the screen's rule (exactly one
 * line between two rows, as iOS writes `divider`) is tested against the real
 * seams rather than against plain text:
 *
 * - IdentityRow, AUTH-3 (parity/auth-3): renders only once the profile has
 *   loaded; a hairline BELOW itself unless told `divider={false}`.
 * - DeletionRow, ACCT-4 (parity/acct-4): always renders; no hairline.
 * - MembershipActions, ACCT-3 (parity/acct-3, CancelSubscriptionRow): a
 *   hairline ABOVE itself, while the plan is held and not already ending.
 * - BodyGoalsRow, BODY-1 (not built yet): through `AccountRowButton`, the
 *   contract in ../rows.tsx.
 *
 *   jest.mock('../slots/IdentityRow', () => require('./slotFillers').identityRow);
 *
 * If a filler changes how it draws its line, change its stand-in here with it.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppStore } from '../../../stores/appStore';
import { colors, hairline } from '../../../theme';
import { AccountRowButton } from '../rows';

/** A hairline as the fillers draw their own (the same look as AccountRowDivider). */
function OwnHairline() {
  return <View style={styles.hairline} importantForAccessibility="no" accessibilityElementsHidden />;
}

function Row({ label, testID }: { label: string; testID: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} onPress={() => undefined}>
      <Text>{label}</Text>
    </Pressable>
  );
}

function IdentityRow({ divider = true }: { divider?: boolean }) {
  const profileLoaded = useAppStore((state) => state.profile !== null);
  if (!profileLoaded) return null;
  return (
    <>
      <Row label="Identity (kennitala)" testID="slot.IdentityRow" />
      {divider ? <OwnHairline /> : null}
    </>
  );
}

function DeletionRow() {
  return <Row label="Delete account" testID="slot.DeletionRow" />;
}

function MembershipActions() {
  const cancellable = useAppStore((state) => state.subscription !== null && state.subscription.cancelAtPeriodEnd !== true);
  if (!cancellable) return null;
  return (
    <View>
      <OwnHairline />
      <Row label="Cancel subscription" testID="slot.MembershipActions" />
    </View>
  );
}

function BodyGoalsRow() {
  return <AccountRowButton title="Body and goals" onPress={() => undefined} testID="slot.BodyGoalsRow" />;
}

const module = <T,>(component: T) => ({ __esModule: true, default: component });

export const identityRow = module(IdentityRow);
export const deletionRow = module(DeletionRow);
export const membershipActions = module(MembershipActions);
export const bodyGoalsRow = module(BodyGoalsRow);

/** The line every row and filler draws: a view one hairline high in the line colour. */
function isHairline(style: unknown): boolean {
  const flat = StyleSheet.flatten(style as never) as { height?: unknown; backgroundColor?: unknown } | undefined;
  return flat?.height === hairline && flat?.backgroundColor === colors.line;
}

type Node = { props: Record<string, unknown>; children: unknown[] };

/**
 * A card read top to bottom as TalkBack meets its rows and the eye meets its
 * lines: each row by its label, each hairline as "—". A section's kicker is
 * left out.
 */
export function linesAndRows(root: Node): string[] {
  const found: string[] = [];
  const walk = (node: Node) => {
    const { accessibilityRole, accessibilityLabel, style } = node.props;
    if (accessibilityRole === 'header') return;
    if (isHairline(style)) {
      found.push('—');
      return;
    }
    if ((accessibilityRole === 'button' || accessibilityRole === 'text') && typeof accessibilityLabel === 'string') {
      found.push(accessibilityLabel);
      return;
    }
    for (const child of node.children) {
      if (typeof child === 'object' && child !== null) walk(child as Node);
    }
  };
  walk(root);
  return found;
}

/**
 * What the member sees of a card: the card hides a first line under its
 * clipped top edge (../rows.tsx), so a leading "—" is dropped.
 */
export function seenInCard(tokens: string[]): string[] {
  return tokens[0] === '—' ? tokens.slice(1) : tokens;
}

const styles = StyleSheet.create({
  hairline: { height: hairline, backgroundColor: colors.line, marginHorizontal: 16 },
});
