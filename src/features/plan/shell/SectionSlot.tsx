/**
 * Where Plan mounts a section another package draws (plan 3.0.3: Today,
 * Nutrition, the review, the feedback, This plan, the history...).
 *
 * TWO JOBS:
 *
 * 1. SPACING LIKE A SWIFTUI STACK. iOS lays the page out in a VStack with 24
 *    pt between rows, and a card that has nothing to draw is no row at all,
 *    so it takes no space. A Yoga `gap` is applied between every child,
 *    however empty, and Plan cannot know which section will draw anything
 *    (each decides for itself). So a slot measures its content: while it is
 *    empty it sits out of the flow (absolute, invisible) and takes no gap;
 *    the moment its section draws something it joins the flow.
 *
 * 2. AN ANCHOR. A notification can ask Plan to land on a section (the weekly
 *    review, the monthly feedback); the slot reports where it sits so the
 *    screen can scroll there, and takes the report back the moment it is no
 *    longer true: when its section empties, and when the slot goes (the body
 *    switched from the gate to the intro to the plan). A y left behind would
 *    be scrolled to before the new slot has laid out, and the page would
 *    land wherever the old card used to be.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import type { PlanSectionAnchor } from './sectionRule';

export type SectionSlotProps = {
  children: ReactNode;
  anchor?: PlanSectionAnchor;
  /** Where the slot's top sits in the page, once it draws something. */
  onAnchorLayout?: (anchor: PlanSectionAnchor, y: number) => void;
  /** The slot has nothing to draw any more, or is gone: its last y is not true. */
  onAnchorEmpty?: (anchor: PlanSectionAnchor) => void;
  testID?: string;
};

export default function SectionSlot({ children, anchor, onAnchorLayout, onAnchorEmpty, testID }: SectionSlotProps) {
  const [hasContent, setHasContent] = useState(false);

  // The unmount takes the anchor back with the handler of the moment.
  const onEmptyRef = useRef(onAnchorEmpty);
  useEffect(() => {
    onEmptyRef.current = onAnchorEmpty;
  }, [onAnchorEmpty]);
  useEffect(() => {
    if (!anchor) return undefined;
    return () => onEmptyRef.current?.(anchor);
  }, [anchor]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    const next = height > 0;
    if (next !== hasContent) setHasContent(next);
    if (!anchor) return;
    // An out-of-flow slot's y is not where it will land; wait for the flow.
    if (next && hasContent) onAnchorLayout?.(anchor, y);
    if (!next) onAnchorEmpty?.(anchor);
  };
  return (
    <View onLayout={onLayout} style={hasContent ? undefined : styles.empty} testID={testID}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },
});
