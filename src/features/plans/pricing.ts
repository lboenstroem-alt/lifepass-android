/**
 * What a plan card says with the catalogue beside it: its price, the live
 * tier facts, and the terms line under the cards. The pure half of iOS
 * `PlansViewModel` (priceLabel, finePrintTermsKey, tierFacts) and
 * `PlansView.featureLines`.
 */
import { iskPrefix, translate, translatePlural, type Lang } from '../../i18n';

import { priceIskForSlug, tierForSlug, type CatalogTier, type PlanCatalog } from './catalog';
import { featureLines, isDayPass, isSubscription, type Plan } from './plans';

/**
 * The card's price, "ISK 14,900" (iOS `Venue.iskPrefix`, the same in both
 * languages), or null when the catalogue has no entry for it or is absent.
 * ABSENT rather than zero: a member who sees no price is where we already
 * were; a member shown "ISK 0" for a paid plan is actively misled.
 */
export function priceLabel(plan: Plan, catalog: PlanCatalog | null): string | null {
  if (!catalog) return null;
  const isk = priceIskForSlug(catalog, plan.id);
  return isk === null ? null : iskPrefix(isk);
}

/**
 * The terms line under the cards for the selected plan. It says "Price shown
 * at checkout" only while that card shows no price (no catalogue, or no entry
 * for it); once the card shows the catalogue's price, that would contradict
 * the screen. A day pass is a "Prepaid day pass", a pack a "Prepaid visit
 * pack": one visit on one day is not a pack. No plan (an empty pass list)
 * reads as a pack.
 */
export function finePrintTermsKey(plan: Plan | null, catalog: PlanCatalog | null): string {
  const priced = plan !== null && priceLabel(plan, catalog) !== null;
  if (plan && isSubscription(plan)) return priced ? 'plans.fine.sub_terms_priced' : 'plans.fine.sub_terms';
  if (plan && isDayPass(plan)) return priced ? 'plans.fine.day_pass_terms_priced' : 'plans.fine.day_pass_terms';
  return priced ? 'plans.fine.pass_terms_priced' : 'plans.fine.pass_terms';
}

/**
 * The live tier facts (visit caps) for a membership card, or null for a pass
 * or while the catalogue is absent: the card then falls back to a generic
 * "monthly visits" line rather than inventing numbers.
 */
export function tierFacts(plan: Plan, catalog: PlanCatalog | null): CatalogTier | null {
  if (!isSubscription(plan) || !catalog) return null;
  return tierForSlug(catalog, plan.id);
}

/**
 * Every line a card lists, in `lang`. A membership card leads with the
 * tier's REAL visit numbers from the priced catalogue (the same figures
 * lifepass.is/plans states) ahead of the qualitative lines; while the
 * catalogue is absent (offline, a failed read) it leads with one generic
 * translated line instead: no number shown is where we already were, an
 * invented one misleads. Passes state their fixed visit counts in the static
 * copy.
 */
export function cardFeatureLines(plan: Plan, catalog: PlanCatalog | null, lang: Lang): string[] {
  const copy = featureLines(plan, lang);
  if (!isSubscription(plan)) return copy;
  const tier = tierFacts(plan, catalog);
  if (!tier) return [translate('plans.fact.fallback', lang), ...copy];
  return [
    translate('plans.fact.network', lang, { count: tier.networkCap }),
    translate('plans.fact.pools', lang, { count: tier.poolCap }),
    // "Up to 1 check-in a day" / "Allt að 21 innritun á dag": the Icelandic rule.
    translatePlural('plans.fact.daily', tier.dailyCap, lang),
    ...copy,
  ];
}
