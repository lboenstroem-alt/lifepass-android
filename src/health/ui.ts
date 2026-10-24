/**
 * The health platform's screens: import from here in components.
 *
 *   import { HealthConsentSheet, HealthHost, MinorCard } from '../../health/ui';
 *
 * Kept apart from ./index.ts so non-UI code never loads a component.
 */
export { default as HealthConsentSheet, type HealthConsentSheetProps } from './consent/HealthConsentSheet';
export { default as HealthConsentHost, type HealthConsentHostProps } from './consent/HealthConsentHost';
export { default as MealGateSheet, type MealGateSheetProps } from './gate/MealGateSheet';
export { default as MinorCard, type MinorCardProps } from './minor/MinorCard';
export { default as HealthHost, type HealthHostProps } from './HealthHost';
export {
  default as AiConsentBlock,
  SHEET_CONSENT_PALETTE,
  type AiConsentBlockProps,
  type AiConsentPalette,
} from './consent/AiConsentBlock';
