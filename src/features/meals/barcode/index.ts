/**
 * Barcode mode (MEAL-3): the meal page's `BarcodeMode` slot, the two-way
 * lookup, the normaliser and the read lock.
 */
export { default as BarcodeScanMode, barcodeCentreY, bracketPath } from './BarcodeScanMode';
export { default as BarcodeResultSheet, per100gLine } from './BarcodeResultSheet';
export { default as TypedBarcodeSheet } from './TypedBarcodeSheet';
export { BarcodeLookupModel, BARCODE_EARLY_OPEN_MS, type BarcodeLookupState, type BarcodeResult, type BarcodeSource } from './lookupModel';
export {
  barcodeDigits,
  checkDigitFor,
  expandUPCE,
  hasValidCheckDigit,
  isValidTypedBarcode,
  MEAL_BARCODE_TYPES,
  normaliseBarcode,
  symbologyOf,
  VALID_BARCODE_LENGTHS,
  type BarcodeSymbology,
} from './normaliser';
export { BarcodeReadLock, BARCODE_CONFIRM_MS, BARCODE_RESUME_DELAY_MS, type BarcodeRead } from './readLock';
