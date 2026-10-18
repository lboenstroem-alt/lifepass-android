/**
 * The meal outbox (MEAL-1): new meals saved offline, sent later with the key
 * minted at Save, never lost and never logged twice.
 */
export * from './rules';
export * from './mealOutbox';
