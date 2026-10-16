// The LifePass UI kit (package F5). Import from here:
//
//   import { TopBar, Sheet, PrimaryButton, showToast } from '../components/ui';
//
// Every component takes its words from the caller (already translated with
// t()) or from the generated iOS keys, and carries its TalkBack role, label
// and state. Colours and faces come from src/theme; large text and reduce
// motion from src/hooks/useA11ySize and src/hooks/useReduceMotion; haptics
// from src/lib/haptics.
export { default as LPText } from './LPText';
export type { LPTextProps } from './LPText';
export { default as Kicker } from './Kicker';
export type { KickerProps } from './Kicker';
export { default as Wordmark } from './Wordmark';
export { default as TopBar } from './TopBar';
export type { TopBarProps, TopBarTrailing } from './TopBar';
export { default as PrimaryButton, READABLE_DISABLED } from './PrimaryButton';
export type { PrimaryButtonProps, PrimaryButtonShape, PrimaryButtonTone } from './PrimaryButton';
export { default as Card } from './Card';
export type { CardProps } from './Card';
export { default as Sheet, SHEET_CLOSE_FALLBACK_MS } from './Sheet';
export type { SheetProps } from './Sheet';
export { default as SheetTextInput, useInSheet } from './SheetTextInput';
export { Dialog, DialogHost, showDialog, dismissAllDialogs, orderButtons } from './Dialog';
export type { DialogButton, DialogButtonRole, DialogOptions, DialogProps } from './Dialog';
export { default as ConfirmSheet } from './ConfirmSheet';
export type { ConfirmSheetProps } from './ConfirmSheet';
export { ToastHost, showToast, dismissToast, TOAST_MS, ACTION_TOAST_MS } from './Toast';
export type { ToastAction, ToastOptions, ToastHostProps } from './Toast';
export { default as StatusBanner } from './StatusBanner';
export type { StatusBannerProps } from './StatusBanner';
export { SkeletonBlock, SkeletonCard } from './Skeleton';
export type { SkeletonBlockProps, SkeletonCardProps } from './Skeleton';
export { default as ErrorState } from './ErrorState';
export type { ErrorStateProps } from './ErrorState';
export { default as EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';
export { default as EstimateChip } from './EstimateChip';
export { Chip, ChipRow } from './Chip';
export type { ChipProps, ChipRowProps, ChipTone } from './Chip';
export { default as SegmentedControl } from './SegmentedControl';
export type { Segment, SegmentedControlProps } from './SegmentedControl';
export { default as NumberStepper } from './NumberStepper';
export type { NumberStepperProps } from './NumberStepper';
export {
  parseDecimal,
  parseWholeNumber,
  formatDecimalInput,
  stepText,
  decimalsOf,
  sanitiseDecimalTyping,
} from './numberInput';
export type { StepRule } from './numberInput';
export { default as Callout, calloutPath, CALLOUT_ARROW } from './Callout';
export type { CalloutProps } from './Callout';
export { default as CheckboxRow } from './CheckboxRow';
export type { CheckboxRowProps } from './CheckboxRow';
export { default as ToggleRow } from './ToggleRow';
export type { ToggleRowProps } from './ToggleRow';
export { default as MenuPicker } from './MenuPicker';
export type { MenuOption, MenuPickerProps } from './MenuPicker';
export { default as VenueImage, IMAGE_ATTEMPTS, imageRetryDelayMs } from './VenueImage';
export type { VenueImageProps } from './VenueImage';
export { normaliseImageUrl } from './imageUrl';
export { default as UiKitProvider } from './UiKitProvider';
export type { UiKitProviderProps } from './UiKitProvider';
export { announce, recommendedTimeout, hiddenFromAccessibility } from './a11y';
