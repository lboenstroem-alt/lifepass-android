/**
 * The meal models (MEAL-1): wire types, the fail-soft decoders, the wire
 * encoders and the editable item. The other meal packages and Plan import
 * from here:
 *
 *   import { decodeMealRecord, draftFromChoice, draftInput, type MealItemDraft } from '../types';
 */
export * from './models';
export * from './decode';
export * from './encode';
export * from './draft';
export * from './draftFactory';
export { characterPrefix, trimWhitespace } from './text';
