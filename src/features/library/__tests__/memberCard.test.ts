/**
 * Profile's member card words (iOS LibraryView.memberCard): the badge's
 * precedence (plan, then tier, then VIEW PLANS) and the caps line, which is
 * there only with a tier.
 */
import { decodeProfile, type Usage } from '../../../api/profile';
import { decodeSubscription } from '../../../api/subscriptions';
import { translate, type Lang } from '../../../i18n';
import { memberCardBadge, memberCardCaps, memberCardInitial, memberCardName } from '../memberCard';
import { LANES, profileJSON, subscriptionJSON, usageJSON } from './fixtures';

const tr = (lang: Lang) => (key: string, params?: Readonly<Record<string, string | number>>) => translate(key, lang, params);
const en = tr('en');
const is = tr('is');

const usageOf = (extra: Record<string, unknown>): Usage => decodeProfile(profileJSON({ usage: usageJSON(extra) })).usage!;

describe('the badge', () => {
  it('names the active plan, upper case', () => {
    expect(memberCardBadge(decodeSubscription(subscriptionJSON()), usageOf(LANES), en)).toBe('PLUS');
  });

  it('a plan in dunning still names the plan (iOS isActive)', () => {
    expect(memberCardBadge(decodeSubscription(subscriptionJSON({ status: 'past_due' })), usageOf({}), en)).toBe('PLUS');
  });

  it('falls back to the plan name from the slug when the API has none', () => {
    const sub = decodeSubscription(subscriptionJSON({ productName: '', productSlug: 'plan-max' }));
    expect(memberCardBadge(sub, null, en)).toBe('LIFEPASS MAX');
  });

  it('with no active plan, names the usage tier', () => {
    expect(memberCardBadge(decodeSubscription(subscriptionJSON({ status: 'cancelled' })), usageOf(LANES), en)).toBe('PLUS');
    expect(memberCardBadge(null, usageOf({ tier: 'base' }), en)).toBe('BASE');
  });

  it('with neither, says View plans, upper case, in the account language', () => {
    expect(memberCardBadge(null, usageOf({}), en)).toBe('VIEW PLANS');
    expect(memberCardBadge(null, null, is)).toBe('SKOÐA ÁSKRIFTIR');
  });
});

describe('the caps line', () => {
  it('reads this period, gym then pool', () => {
    expect(memberCardCaps(usageOf(LANES), en)).toBe('Gym 3/8 · Pool 2/4');
    expect(memberCardCaps(usageOf(LANES), is)).toBe('Rækt 3/8 · Sund 2/4');
  });

  it('shows only the lanes there are', () => {
    expect(memberCardCaps(usageOf({ tier: 'base', network: LANES.network }), en)).toBe('Gym 3/8');
  });

  it('is absent with no tier, even when lanes are there', () => {
    expect(memberCardCaps(usageOf({ network: LANES.network }), en)).toBeNull();
    expect(memberCardCaps(null, en)).toBeNull();
  });

  it('is absent with a tier and no lanes', () => {
    expect(memberCardCaps(usageOf({ tier: 'plus' }), en)).toBeNull();
  });
});

describe('the name and the letter', () => {
  it('reads the name, else the email, else Member', () => {
    expect(memberCardName({ fullName: 'Anna Jónsdóttir', email: 'a@x.is' }, en)).toBe('Anna Jónsdóttir');
    expect(memberCardName({ fullName: null, email: 'a@x.is' }, en)).toBe('a@x.is');
    expect(memberCardName({ fullName: null, email: null }, is)).toBe('Félagi');
    expect(memberCardName(null, en)).toBe('Member');
  });

  it('takes the first character, upper case, keeping a letter whole', () => {
    expect(memberCardInitial('anna')).toBe('A');
    expect(memberCardInitial('ðóra')).toBe('Ð');
    expect(memberCardInitial('Ásta')).toBe('Á');
    expect(memberCardInitial('a@x.is')).toBe('A');
    expect(memberCardInitial('')).toBe('');
  });
});
