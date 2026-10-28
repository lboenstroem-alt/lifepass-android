/**
 * The plans and passes LifePass sells: the Android port of iOS `Plan`
 * (Models/Plan.swift).
 *
 * Each one is keyed by its REAL v1 product slug (`plan-base/plus/max`,
 * `pass-explorer/adventurer/local`, `pass-day-*`), which is what
 * `POST /payments/checkout-sessions` accepts. Credits and luxury were removed
 * in v1: plans are tier allowances plus the premium surcharge, passes are
 * prepaid visit packs.
 *
 * THE COPY IS TRANSLATED. The subtitle and the feature lines are string keys,
 * not English text, so an Icelandic screen reads Icelandic cards. The names
 * Base, Plus, Max, Explorer, Adventurer and Local are product names and read
 * the same in both languages, as on lifepass.is; a day pass is named by its
 * category in the reader's language ("Gym Day Pass", "Rækt dagspassi"), as the
 * website names it.
 *
 * The static list owns the COPY (names, feature lines, which card is
 * "popular"); the priced catalogue (./catalog.ts) owns the NUMBERS. They are
 * joined on the product slug.
 */
import { lookup, pluralKey, type Lang } from '../../i18n';

export type PlanMode = 'subscription' | 'pass';

/** One line of what a card includes. */
export type PlanFeature =
  /** A fixed line: its string key. */
  | { readonly kind: 'line'; readonly key: string }
  /** "6 visits" / "6 heimsóknir" (counted: "1 visit", "21 heimsókn"). */
  | { readonly kind: 'visits'; readonly count: number }
  /** "Valid 60 days" / "60 daga gildistími". */
  | { readonly kind: 'validDays'; readonly days: number };

export interface Plan {
  /** The v1 product slug (the checkout `productSlug`). */
  readonly id: string;
  /** The product name, the same in both languages (Base, Explorer, ...). A day pass is shown by `nameKey`. */
  readonly name: string;
  /**
   * A name that depends on the language (the day passes), as `<nameKey>.name`
   * and, for "Continue with {name}", `<nameKey>.with` (Icelandic puts the name
   * in the dative after "með": "Áfram með Rækt dagspassa"). Absent for a
   * product name.
   */
  readonly nameKey?: string;
  /** The line beside the name ("The regular" / "Fastagesturinn"). */
  readonly subtitleKey: string;
  /** What's included: qualitative (no invented credits or prices). Pass visit counts are fixed by the product. */
  readonly features: readonly PlanFeature[];
  readonly isPopular: boolean;
  readonly mode: PlanMode;
}

const line = (key: string): PlanFeature => ({ kind: 'line', key });
const visits = (count: number): PlanFeature => ({ kind: 'visits', count });
const validDays = (days: number): PlanFeature => ({ kind: 'validDays', days });

/** The line in `lang`. */
export function featureText(feature: PlanFeature, lang: Lang): string {
  switch (feature.kind) {
    case 'line':
      return lookup(feature.key, lang);
    case 'visits':
      return lookup(pluralKey('plans.card.visits', feature.count, lang), lang).split('{count}').join(String(feature.count));
    case 'validDays':
      return lookup(pluralKey('plans.card.valid_days', feature.days, lang), lang).split('{count}').join(String(feature.days));
  }
}

/** Every key a line can read, in either language (both plural forms of a counted line). */
export function featureKeys(feature: PlanFeature): string[] {
  switch (feature.kind) {
    case 'line':
      return [feature.key];
    case 'visits':
      return ['plans.card.visits.one', 'plans.card.visits.many'];
    case 'validDays':
      return ['plans.card.valid_days.one', 'plans.card.valid_days.many'];
  }
}

export function isSubscription(plan: Plan): boolean {
  return plan.mode === 'subscription';
}

/**
 * A single-day pass (`pass-day-*`), as opposed to a multi-visit pack. The
 * terms line under the cards names which one is selected.
 */
export function isDayPass(plan: Plan): boolean {
  return plan.mode === 'pass' && plan.id.startsWith('pass-day-');
}

/** The name on the card and in the purchase confirmation, in `lang`. */
export function displayName(plan: Plan, lang: Lang): string {
  return plan.nameKey ? lookup(`${plan.nameKey}.name`, lang) : plan.name;
}

/** The name as "Continue with {name}" takes it, in `lang`. */
export function continueName(plan: Plan, lang: Lang): string {
  return plan.nameKey ? lookup(`${plan.nameKey}.with`, lang) : plan.name;
}

/** The subtitle in `lang`. */
export function subtitle(plan: Plan, lang: Lang): string {
  return lookup(plan.subtitleKey, lang);
}

/** The static feature lines in `lang` (a membership card adds the live tier facts in front: ./pricing.ts). */
export function featureLines(plan: Plan, lang: Lang): string[] {
  return plan.features.map((feature) => featureText(feature, lang));
}

/** Every string key this plan's copy reads (the copy tests check each exists in both languages). */
export function copyKeys(plan: Plan): string[] {
  const keys = [plan.subtitleKey, ...plan.features.flatMap(featureKeys)];
  if (plan.nameKey) keys.push(`${plan.nameKey}.name`, `${plan.nameKey}.with`);
  return keys;
}

// ---------------------------------------------------------------------------
// Subscriptions (monthly, no minimum commitment)

// Subscription features carry the QUALITATIVE tail only. The visit numbers
// ("10 gym & studio visits a month", pool visits, the per-day limit) are put
// in front live from the priced catalogue (./pricing.ts), the same numbers
// lifepass.is/plans shows, with a translated generic line as the fallback
// while the catalogue is absent. Vague ranking copy ("more visits than Base")
// was the support complaint that forced this: a member could not see what any
// tier actually includes.
export const SUBSCRIPTION_PLANS: readonly Plan[] = [
  {
    id: 'plan-base',
    name: 'Base',
    subtitleKey: 'plans.card.base.subtitle',
    features: [line('plans.card.inbundle'), line('plans.card.premium_payg'), line('plans.card.cancel_anytime')],
    isPopular: false,
    mode: 'subscription',
  },
  {
    id: 'plan-plus',
    name: 'Plus',
    subtitleKey: 'plans.card.plus.subtitle',
    features: [line('plans.card.inbundle'), line('plans.card.premium_payg'), line('plans.card.cancel_anytime')],
    isPopular: true,
    mode: 'subscription',
  },
  {
    id: 'plan-max',
    name: 'Max',
    subtitleKey: 'plans.card.max.subtitle',
    features: [
      // Premium ladder: the member rate is the out-of-visits / pass-holder
      // price for EVERY tier now; there is no Max-only premium discount to
      // promise here.
      line('plans.card.premium_member_price'),
      line('plans.card.inbundle'),
      line('plans.card.cancel_anytime'),
    ],
    isPopular: false,
    mode: 'subscription',
  },
];

// ---------------------------------------------------------------------------
// Visitor passes (prepaid visit packs, no subscription)

// Multi-visit packages first, then single-day passes: the same order as the
// web plans page. A visitor arriving from a partner link is here for a trip,
// not one swim, and the packages used to sit below three day passes.
export const VISITOR_PACKAGES: readonly Plan[] = [
  {
    id: 'pass-explorer',
    name: 'Explorer',
    subtitleKey: 'plans.card.explorer.subtitle',
    features: [visits(3), validDays(30), line('plans.card.pack_venues')],
    isPopular: false,
    mode: 'pass',
  },
  {
    id: 'pass-adventurer',
    name: 'Adventurer',
    subtitleKey: 'plans.card.adventurer.subtitle',
    features: [visits(6), validDays(60), line('plans.card.pack_venues')],
    isPopular: true,
    mode: 'pass',
  },
  {
    id: 'pass-local',
    name: 'Local',
    subtitleKey: 'plans.card.local.subtitle',
    features: [visits(12), validDays(90), line('plans.card.pack_venues')],
    isPopular: false,
    mode: 'pass',
  },
  {
    id: 'pass-day-gym',
    name: 'Gym Day Pass',
    nameKey: 'plans.card.day_gym',
    subtitleKey: 'plans.card.day.subtitle',
    features: [visits(1), line('plans.card.valid_same_day'), line('plans.card.day_gym.venues')],
    isPopular: false,
    mode: 'pass',
  },
  {
    id: 'pass-day-studio',
    name: 'Studio Day Pass',
    nameKey: 'plans.card.day_studio',
    subtitleKey: 'plans.card.day.subtitle',
    features: [visits(1), line('plans.card.valid_same_day'), line('plans.card.day_studio.venues')],
    isPopular: false,
    mode: 'pass',
  },
  // OFF SALE since 6 October 2026 (`OFF_SALE_SLUGS`): kept for its copy, so
  // the card comes back as soon as the catalogue lists it again.
  {
    id: 'pass-day-pool',
    name: 'Pool Day Pass',
    nameKey: 'plans.card.day_pool',
    subtitleKey: 'plans.card.day.subtitle',
    features: [visits(1), line('plans.card.valid_same_day'), line('plans.card.day_pool.venues')],
    isPopular: false,
    mode: 'pass',
  },
];

export const ALL_PLANS: readonly Plan[] = [...SUBSCRIPTION_PLANS, ...VISITOR_PACKAGES];

/**
 * Passes known to be off sale: the Pool Day Pass since 6 October 2026
 * (`metadata.onSale: false`, `is_public = false`; checkout refuses it with
 * `404 product_not_on_sale`). Without a catalogue (not answered yet, offline,
 * a failed read) they get no card; only the catalogue listing one again
 * brings its card back.
 */
export const OFF_SALE_SLUGS: ReadonlySet<string> = new Set(['pass-day-pool']);

/** The passes shown while there is no catalogue: the built-in list without the passes known to be off sale. */
export function fallbackVisitorPasses(): Plan[] {
  return VISITOR_PACKAGES.filter((plan) => !OFF_SALE_SLUGS.has(plan.id));
}

/** The pass slugs a catalogue sells, day passes and packs alike (the catalogue's shape, ./catalog.ts). */
type ListsPasses = {
  readonly dayPasses: readonly { readonly slug: string }[];
  readonly packs: readonly { readonly slug: string }[];
};

/**
 * The visitor passes the plans screen offers: once `GET /catalog/plans` has
 * answered, only the passes it lists (its `dayPasses` and `packs`), in the
 * order above; while there is no catalogue (not loaded yet, or the read
 * failed), the built-in list without the passes off sale.
 *
 * WHY. A pass taken off sale (the Pool Day Pass since 6 October 2026) leaves
 * the catalogue, and checkout refuses its slug with `404 product_not_on_sale`.
 * A card built from the static list alone would offer a pass whose Continue
 * can only fail, and the fallback used to do exactly that before the
 * catalogue answered and whenever it could not be read. A pass the catalogue
 * lists that this build has no copy for is not shown (there is nothing to say
 * about it); the website still sells it.
 */
export function visitorPasses(catalog: ListsPasses | null | undefined): Plan[] {
  if (!catalog) return fallbackVisitorPasses();
  const listed = new Set([...catalog.dayPasses, ...catalog.packs].map((pass) => pass.slug));
  return VISITOR_PACKAGES.filter((plan) => listed.has(plan.id));
}

/** A plan by its product slug, from the built-in list. */
export function planForSlug(slug: string): Plan | undefined {
  return ALL_PLANS.find((plan) => plan.id === slug);
}
