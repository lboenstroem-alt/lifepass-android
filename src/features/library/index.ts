/**
 * Profile's public face, for other features (the lint rule
 * `lifepass/feature-boundaries` lets them in only through here):
 *
 * - `SavedSheet`: the Coach drawer's "Saved" (iOS `FavouritesView`, presented
 *   from CoachView as a full-height sheet): saved venues with their Premium
 *   tag, saved classes, and the "For you" suggestions with their reasons.
 *   Controlled, like every kit sheet:
 *
 *     const [savedOpen, setSavedOpen] = useState(false);
 *     <SavedSheet visible={savedOpen} onClose={() => setSavedOpen(false)} />
 *
 *   It closes itself before it opens a venue, Profile or Explore.
 *
 * Profile itself is a route (`Profile { initialTab }`, src/navigation), opened
 * with `openProfile` (src/navigation/profile.ts).
 */
export { default as SavedSheet, type SavedSheetProps } from './saved/SavedSheet';
