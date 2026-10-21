import type { ComponentProps } from 'react';
import type { ImageSourcePropType } from 'react-native';
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

// ─── LEGACY: the first build's Home cards ─────────────────────────────────────
//
// @deprecated Read only by the first build's Home screen
// (src/screens/home/HomeScreen.tsx), which HOME-1 replaces; the new Home parks
// its own prompt for the Coach. Delete with that screen (QA-1).
// Image files live in assets/categories/ — filename should match `id`.

export type CoachCategory = {
  id: string;
  label: string;
  image: ImageSourcePropType;
  /** Sent to Coach when this card is tapped. */
  prompt: string;
};

/** @deprecated See above. */
export const coachCategories: CoachCategory[] = [
  {
    id: 'pools',
    label: 'Icelandic Pools',
    image: require('../../assets/categories/pools.jpg'),
    prompt: 'I want to try Icelandic swimming pools. Which ones are best to start with this week?',
  },
  {
    id: 'gyms',
    label: 'Gyms & Classes',
    image: require('../../assets/categories/gyms.jpg'),
    prompt: 'Suggest gym classes I should try this week.',
  },
  {
    id: 'wellness',
    label: 'Wellness',
    image: require('../../assets/categories/wellness.jpg'),
    prompt: "I'd like a relaxing wellness day. What do you suggest?",
  },
  {
    id: 'golf',
    label: 'Golf',
    image: require('../../assets/categories/golf.jpg'),
    prompt: 'Tell me about golf options available through LifePass.',
  },
  {
    id: 'spa',
    label: 'Spa & Lagoons',
    image: require('../../assets/categories/spa.jpg'),
    prompt: 'Plan a perfect spa or lagoon evening for me.',
  },
  {
    id: 'yoga',
    label: 'Yoga & Pilates',
    image: require('../../assets/categories/yoga.jpg'),
    prompt: "I'm new to yoga. Where should I start in Reykjavík?",
  },
];
