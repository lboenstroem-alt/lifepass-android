import type { ComponentProps } from 'react';
import type { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

// ─── The Coach's category tiles (iOS CoachView.swift `coachCategories`) ───────
//
// The six tiles of the category strip (the empty state's "What's nearby?"
// chips and the "Want to explore something else?" prompt after a search). A
// tap starts the venue wizard for the tile's category directly, under the
// tile's own LOCALIZED label (`useCoachStore.startSearch(id, labelKey)`); it
// never sends a prompt. The tiles used to send hard-coded English prompts, so
// an Icelandic member saw English "user" messages, and a prompt like "Suggest
// gym classes I should try this week." would now be routed to the chat as a
// schedule question.

/** An icon on a tile: the closest glyph to iOS's SF Symbol. */
export type CoachCategoryIcon =
  | { readonly family: 'ionicons'; readonly name: ComponentProps<typeof Ionicons>['name'] }
  | { readonly family: 'material'; readonly name: ComponentProps<typeof MaterialCommunityIcons>['name'] };

export interface CoachCategoryTile {
  /** The wizard key (`WIZARD_CATEGORY` in src/features/coach/store/coachStore.ts). */
  readonly id: 'pools' | 'gyms' | 'wellness' | 'golf' | 'spa' | 'yoga';
  /** The tile's label, and the member's bubble when it is tapped. */
  readonly labelKey: string;
  readonly icon: CoachCategoryIcon;
}

export const COACH_CATEGORY_TILES: readonly CoachCategoryTile[] = [
  // drop.fill
  { id: 'pools', labelKey: 'coach.cat.pools', icon: { family: 'ionicons', name: 'water' } },
  // dumbbell.fill
  { id: 'gyms', labelKey: 'coach.cat.gyms', icon: { family: 'ionicons', name: 'barbell' } },
  // leaf.fill
  { id: 'wellness', labelKey: 'coach.cat.wellness', icon: { family: 'ionicons', name: 'leaf' } },
  // figure.golf
  { id: 'golf', labelKey: 'coach.cat.golf', icon: { family: 'ionicons', name: 'golf' } },
  // sparkles
  { id: 'spa', labelKey: 'coach.cat.spa', icon: { family: 'ionicons', name: 'sparkles' } },
  // figure.mind.and.body
  { id: 'yoga', labelKey: 'coach.cat.yoga', icon: { family: 'material', name: 'yoga' } },
];
