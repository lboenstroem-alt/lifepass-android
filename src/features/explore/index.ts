// Explore's public face for other features (plan 3.0.3, feature boundaries).
//
//   ExploreModeToggle     the Venues / Classes switch; the classes feed
//                         (CLASS-1) draws it in its own filter row, as iOS
//                         `ClassesDiscoveryView` draws `ExploreModeToggle`.
//   LocationDeniedBanner  "Location is off" with Open; the Explore map
//                         (EXPL-2) mounts it in its overlay stack, under
//                         the legend. Nothing else draws it.
export { default as ExploreModeToggle } from './ExploreModeToggle';
export type { ExploreMode, ExploreModeToggleProps } from './ExploreModeToggle';
export { default as LocationDeniedBanner } from './LocationDeniedBanner';
export type { LocationDeniedBannerProps } from './LocationDeniedBanner';
