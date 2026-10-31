/* eslint lifepass/no-literal-copy: "error" */
/**
 * What Profile's member card says: the port of iOS `LibraryView.memberCard`
 * (Views/Profile/LibraryView.swift). Pure, so the precedence rules are tested
 * on their own.
 *
 *   name     the profile's full name, else its email, else "Member"
 *   initial  the name's first character, upper case
 *   badge    the active plan's name, else the usage tier, else "VIEW PLANS",
 *            upper case; always there and always opens Plans, so a member
 *            with no plan has a way in as well
 *   caps     this period's lanes ("Gym 3/8 · Pool 2/4"), only with a tier
 *
 * "Active" is a plan held (`active` or `past_due`), as iOS `isActive` reads
 * it. The card has no credit balance: v1 has none.
 */
import { isSubscriptionActive, planDisplayName, type Subscription } from '../../api/subscriptions';
import type { Usage } from '../../api/profile';

/** `t`, or a `useT().t`. */
type Translate = (key: string, params?: Readonly<Record<string, string | number>>) => string;

/** The separator iOS joins the lanes with. */
const DOT = ' · ';

/** iOS `profile?.fullName ?? profile?.email ?? t("common.member")`. */
export function memberCardName(
  profile: { readonly fullName: string | null; readonly email: string | null } | null,
  translate: Translate,
): string {
  return profile?.fullName ?? profile?.email ?? translate('common.member');
}

/** Marks that belong to the character before them (combining diacritics, variation selectors). */
const COMBINING = /^[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︀-️︠-︯]$/;

/**
 * The avatar's letter: `String(name.prefix(1)).uppercased()`. Swift's
 * `prefix(1)` is the first grapheme, so a name stored decomposed ("A" and a
 * combining acute) is composed first and a mark with no composed form stays
 * with its letter: Android draws "Á" where iOS does, never a bare "A".
 */
export function memberCardInitial(name: string): string {
  const characters = Array.from(name.normalize('NFC'));
  let initial = characters[0] ?? '';
  for (let i = 1; i < characters.length && COMBINING.test(characters[i]); i += 1) initial += characters[i];
  return initial.toUpperCase();
}

/** The badge's words (see the file comment). */
export function memberCardBadge(subscription: Subscription | null, usage: Usage | null, translate: Translate): string {
  if (subscription && isSubscriptionActive(subscription)) return planDisplayName(subscription).toUpperCase();
  const tier = usage?.tier;
  if (tier !== null && tier !== undefined) return tier.toUpperCase();
  return translate('account.view_plans').toUpperCase();
}

/** "Gym 3/8 · Pool 2/4" (`library.caps_gym`, `library.caps_pool`); null with no tier or no lane. */
export function memberCardCaps(usage: Usage | null, translate: Translate): string | null {
  if (!usage || usage.tier === null) return null;
  const parts: string[] = [];
  if (usage.network) {
    parts.push(translate('library.caps_gym', { used: String(usage.network.used), cap: String(usage.network.cap) }));
  }
  if (usage.pools) {
    parts.push(translate('library.caps_pool', { used: String(usage.pools.used), cap: String(usage.pools.cap) }));
  }
  return parts.length > 0 ? parts.join(DOT) : null;
}
