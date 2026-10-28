/* eslint lifepass/no-literal-copy: "error" */
/**
 * Plan's proposal section (PLAN-4, mounted by PLAN-1): the programme the
 * Coach built, waiting to be started, in Plan's paper palette (iOS
 * PlanView `proposalCard`). PLAN-1 decides WHERE it stands: as the intro
 * section with no live plan, and in Today's place after a finished block (a
 * member who built the next block and tapped Not now is never invited to
 * build one again). With a live plan Plan shows the "A new plan is ready"
 * row instead, whose Review opens the programme overview in proposal mode.
 *
 * Every outcome reads Plan again; Start also lands the adopted banner.
 */
import { StyleSheet, View } from 'react-native';

import ProgramProposalCard from '../proposal/ProgramProposalCard';

export default function ProposalSection() {
  return (
    <View style={styles.inset}>
      <ProgramProposalCard palette="plan" testID="plan.proposal" />
    </View>
  );
}

const styles = StyleSheet.create({
  inset: { paddingHorizontal: 20 },
});
