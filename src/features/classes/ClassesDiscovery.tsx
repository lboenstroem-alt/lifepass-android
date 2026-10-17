// @f4-stub (plan 3.0.3): the classes feed, filled by CLASS-1; mounted by EXPL-1 (the Classes half of Explore) and by the `ClassesDiscoveryModal` route.
//
// iOS `ClassesDiscoveryView(exploreMode:initialCategory:initialDate:showsModeToggle:)`.
// Keep the default export and its props; replace the body (and this marker).
// Renders nothing until CLASS-1 lands.

export interface ClassesDiscoveryProps {
  /** A `catalog_categories` slug to open on (Plan's class session). */
  readonly initialCategory?: string;
  /** A `YYYY-MM-DD` day to open on. */
  readonly initialDate?: string;
  /** The Venues / Classes switch belongs to Explore; presented from Plan there is nothing to switch to. */
  readonly showsModeToggle: boolean;
  /** Explore only: the switch's "Venues" side. */
  readonly onShowVenues?: () => void;
}

export default function ClassesDiscovery(_props: ClassesDiscoveryProps) {
  return null;
}
