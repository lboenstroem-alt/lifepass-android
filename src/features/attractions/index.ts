/**
 * What other features may use of the sights (the feature-boundaries lint
 * rule lets them in through this file, or the published slots
 * ./HomeOutsideCard.tsx, ./SightsSearchGroup.tsx, ./map/SightsLayer.tsx and
 * ./SightHeart.tsx, a place's heart, which draws icons and so stays out of
 * this file that non-screen code imports).
 *
 * The sight card itself is the shared route `AttractionDetail { slug }`:
 * open it as any shared route (`navigation.navigate('AttractionDetail', {
 * slug })` from a tab, `openSharedRoute` from a modal). It is the same card
 * from Home, Explore, the Coach's plan sights and chat, and Plan's hike rows,
 * as on iOS.
 *
 * For the Coach's plan sight cards and Plan's hike rows (COACH-3, PLAN-2),
 * which draw a sight from their own payloads (iOS `CoachPlanSight`,
 * `DayView.attraction`):
 *   - `AttractionRing`: the sight's hollow ring (tier, trailhead dot);
 *   - `kindRegionLine`: "Waterfall · South Iceland" from the app's
 *     dictionaries (kind falls back to "Sight", an unknown region is left out);
 *   - `parseAttractionDrive` / `parseRoadAccess`: the lossy reads of
 *     `driveFromReykjavik` and `roadAccess` (a drive under a minute, or an
 *     unknown access value, is none);
 *   - `roadDriveFromReykjavik`: the drive only where the road goes;
 *   - `isPlateImageUrl`, `drawableSightImageUrl`, `PLATE_PAPER`,
 *     `resolveAttractionAsset`: the plate rule (a map, shown whole on its
 *     paper, never credited as a photo), a photo only with its credit, and
 *     where an image URL points;
 *   - `sightDuration`: the card's own "1 h 20 min" wording; `trailFacts`, a
 *     walk's "7.1 km one way · 3 h there and back"; `creditLine`, a photo's
 *     "Photo: {credit} · {license}";
 *   - `ATTRACTION_CREDITS_URL`: the credits page the Plan and Body and goals
 *     footers link to.
 */
export { default as AttractionRing, ringDotColor, ringDotDiameter, ringLineWidth } from './AttractionRing';
export type { AttractionRingProps } from './AttractionRing';
export { kindLabel, kindRegionLine, regionLabel, ringDiameter, isAroundIceland } from './rules';
export {
  drawableSightImageUrl,
  isHike,
  isPlateImageUrl,
  PLATE_ASPECT_RATIO,
  PLATE_PAPER,
  roadDriveFromReykjavik,
  // Added by COACH-3 (a barrel line, BUILD_RULES' exception): a plan step's
  // straight-line distance reads "about 12 km away" with the card's own
  // kilometres (iOS `CoachPlanDistance.label` calls
  // `AttractionDetail.roadKilometres`).
  roadKilometres,
  sightDisplayName,
} from './model';
export { creditLine, driveKilometres, sightDistance, sightDuration, trailFacts } from './format';
export {
  httpsLink,
  parseAttractionDrive,
  parseRoadAccess,
  resolveAttractionAsset,
  type AttractionDrive,
  type AttractionRoadAccess,
  type AttractionTier,
} from '../../api/attractions';

/** The sights' credits page (iOS PlanView and BodyAndGoalsView footers, `plan.footer.credits`). */
export const ATTRACTION_CREDITS_URL = 'https://www.lifepass.is/attractions/credits';
