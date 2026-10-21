/**
 * The slot Plan mounts a section in: out of the flow while it draws nothing,
 * its anchor reported only from its place in the flow, and taken back the
 * moment it is not true any more (the section emptied, or the slot went with
 * a body switch).
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import SectionSlot from '../SectionSlot';
import type { PlanSectionAnchor } from '../sectionRule';

function handlers() {
  const laidOut: [PlanSectionAnchor, number][] = [];
  const emptied: PlanSectionAnchor[] = [];
  return {
    laidOut,
    emptied,
    onAnchorLayout: (anchor: PlanSectionAnchor, y: number) => laidOut.push([anchor, y]),
    onAnchorEmpty: (anchor: PlanSectionAnchor) => emptied.push(anchor),
  };
}

async function layOut(y: number, height: number) {
  await fireEvent(screen.getByTestId('slot', { includeHiddenElements: true }), 'layout', {
    nativeEvent: { layout: { x: 0, y, width: 360, height } },
  });
}

describe('a section slot', () => {
  it('joins the flow once its section draws, and reports its place in the flow only', async () => {
    const h = handlers();
    await render(
      <SectionSlot anchor="review" onAnchorLayout={h.onAnchorLayout} onAnchorEmpty={h.onAnchorEmpty} testID="slot">
        <Text>Your week</Text>
      </SectionSlot>,
    );
    expect(StyleSheet.flatten(screen.getByTestId('slot', { includeHiddenElements: true }).props.style)?.position).toBe('absolute');
    await layOut(0, 200);
    expect(h.laidOut).toEqual([]);
    expect(StyleSheet.flatten(screen.getByTestId('slot').props.style)?.position).toBeUndefined();
    await layOut(420, 200);
    expect(h.laidOut).toEqual([['review', 420]]);
  });

  it('takes its anchor back when its section empties, and when it goes', async () => {
    const h = handlers();
    await render(
      <SectionSlot anchor="feedback" onAnchorLayout={h.onAnchorLayout} onAnchorEmpty={h.onAnchorEmpty} testID="slot">
        <Text>This month</Text>
      </SectionSlot>,
    );
    await layOut(0, 120);
    await layOut(500, 120);
    await layOut(500, 0);
    expect(h.emptied).toEqual(['feedback']);
    await screen.unmount();
    expect(h.emptied).toEqual(['feedback', 'feedback']);
  });
});
