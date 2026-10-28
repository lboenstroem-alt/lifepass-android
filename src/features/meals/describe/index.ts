/**
 * "Describe what you ate" (MEAL-5, plan 3.0.3); used by MEAL-2 (the meal
 * page's search).
 *
 * iOS `MealDescribeSheet`: the member describes a meal in words, the server
 * estimates it into a draft (OP-56, behind the `meal_describe` feature and
 * its consent version). `DescribeHost` is mounted once by F4's tabs shell.
 *
 * For the meal page:
 *
 *   if (useDescribeOffered(date)) ...  // the entries: "Describe a meal", "Describe it instead"
 *   track('meal_describe_opened', { entry: 'empty_search' });
 *   openDescribe({ text: query, slot, date, onDraft: (id, meal) => openDraft(id, meal), onSearch: setQuery });
 *
 * The opener tracks `meal_describe_opened` (its entry); the sheet tracks the
 * rest. Words handed in are capped as the field caps them.
 */
export { default as DescribeHost } from './DescribeHost';
export {
  closeDescribe,
  openDescribe,
  type DescribePrefill,
} from './presenter';
export { DESCRIBE_PAST_DAYS, isDescribeAvailableOn, isDescribeOffered, useDescribeOffered } from './availability';
export {
  capDescribeText,
  cleanDescribeText,
  describeLength,
  DESCRIBE_MAX_LENGTH,
  DESCRIBE_MIN_LENGTH,
  isDescribeSendable,
  MealDescribeText,
} from './describeText';
