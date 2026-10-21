/**
 * The venue price words (iOS Venue.swift `priceLabel` / `priceSecondaryLabel`,
 * the web's rule) in both languages, and the model's small rules.
 */
import { setCurrentLanguage, translate, type Lang } from '../../i18n';
import {
  icelandicDescription,
  iskPrefix,
  isBoutique,
  isComingSoon,
  isPremium,
  localizedDescription,
  priceLabel,
  priceSecondaryLabel,
  resolvedPremiumPrice,
  venueImages,
  type VenuePricing,
} from '../venue';

type Row = {
  readonly name: string;
  readonly venue: VenuePricing;
  readonly en: [string, string | null];
  readonly is: [string, string | null];
};

/** The table: premium, boutique and in-bundle, with and without each price. */
const table: Row[] = [
  {
    name: 'premium with a price resolved for this member',
    venue: { inBundle: false, surchargePrice: 9990, resolvedSurchargePrice: 8490, topupPrice: 2650 },
    en: ['from ISK 8,490', null],
    is: ['frá ISK 8,490', null],
  },
  {
    name: 'premium with only the standard price',
    venue: { inBundle: false, surchargePrice: 1990 },
    en: ['from ISK 1,990', null],
    is: ['frá ISK 1,990', null],
  },
  {
    name: 'premium with no price at all (a data gap)',
    venue: { inBundle: false, daypassPrice: 2900 },
    en: ['See venue', null],
    is: ['Sjá stað', null],
  },
  {
    name: 'boutique with a top-up price',
    venue: { inBundle: true, primaryCategory: 'Boutique', topupPrice: 3500, daypassPrice: 4000 },
    en: ['Limited visits', 'Extra visits from ISK 3,500'],
    is: ['Takmarkaðar heimsóknir', 'Aukaheimsóknir frá ISK 3,500'],
  },
  {
    name: 'boutique without a top-up price (no day-pass line for a boutique)',
    venue: { inBundle: true, primaryCategory: 'boutique', daypassPrice: 4000 },
    en: ['Limited visits', null],
    is: ['Takmarkaðar heimsóknir', null],
  },
  {
    name: 'in-bundle with a top-up and a day pass',
    venue: { inBundle: true, primaryCategory: 'gym', topupPrice: 2650, daypassPrice: 2900 },
    en: ['Included', 'Top-up from ISK 2,650'],
    is: ['Innifalið', 'Viðbót frá ISK 2,650'],
  },
  {
    name: 'in-bundle with a day pass only',
    venue: { inBundle: true, primaryCategory: 'pool', daypassPrice: 1290 },
    en: ['Included', 'Day pass from ISK 1,290'],
    is: ['Innifalið', 'Dagspassi frá ISK 1,290'],
  },
  {
    name: 'in-bundle with neither',
    venue: { inBundle: true, topupPrice: null, daypassPrice: null },
    en: ['Included', null],
    is: ['Innifalið', null],
  },
  {
    name: 'a large price keeps en-US grouping in Icelandic too',
    venue: { inBundle: false, resolvedSurchargePrice: 1234567 },
    en: ['from ISK 1,234,567', null],
    is: ['frá ISK 1,234,567', null],
  },
];

describe.each(table)('$name', ({ venue, en, is }) => {
  it.each([
    ['en', en],
    ['is', is],
  ] as [Lang, [string, string | null]][])('in %s', (lang, [label, secondary]) => {
    const t = (key: string, params?: Readonly<Record<string, string | number>>) => translate(key, lang, params);
    expect(priceLabel(venue, t)).toBe(label);
    expect(priceSecondaryLabel(venue, t)).toBe(secondary);
  });
});

it('reads the language on screen when no translator is passed', () => {
  const venue: VenuePricing = { inBundle: true };
  expect(priceLabel(venue)).toBe('Included');
  setCurrentLanguage('is');
  expect(priceLabel(venue)).toBe('Innifalið');
  expect(priceSecondaryLabel({ inBundle: true, topupPrice: 2650 })).toBe('Viðbót frá ISK 2,650');
});

it('the ISK prefix groups the en-US way', () => {
  expect(iskPrefix(0)).toBe('ISK 0');
  expect(iskPrefix(990)).toBe('ISK 990');
  expect(iskPrefix(1990)).toBe('ISK 1,990');
  expect(iskPrefix(14900)).toBe('ISK 14,900');
});

it('premium, boutique and the resolved price', () => {
  expect(isPremium({ inBundle: false })).toBe(true);
  expect(isPremium({ inBundle: true })).toBe(false);
  expect(isBoutique({ inBundle: true, primaryCategory: 'BOUTIQUE' })).toBe(true);
  expect(isBoutique({ inBundle: true, primaryCategory: 'studio' })).toBe(false);
  expect(isBoutique({ inBundle: true, primaryCategory: null })).toBe(false);
  expect(resolvedPremiumPrice({ inBundle: false, surchargePrice: 9990, resolvedSurchargePrice: 0 })).toBe(0);
  expect(resolvedPremiumPrice({ inBundle: false, surchargePrice: 9990 })).toBe(9990);
  expect(resolvedPremiumPrice({ inBundle: false })).toBeNull();
});

it('coming soon is awaitingConnection, and only true', () => {
  expect(isComingSoon({ awaitingConnection: true })).toBe(true);
  expect(isComingSoon({ awaitingConnection: false })).toBe(false);
  expect(isComingSoon({ awaitingConnection: null })).toBe(false);
  expect(isComingSoon({})).toBe(false);
});

it('the description follows the account language, falling back to English', () => {
  const both = { description: 'A gym.', descriptionIs: 'Líkamsrækt.' };
  expect(localizedDescription(both, 'en')).toBe('A gym.');
  expect(localizedDescription(both, 'is')).toBe('Líkamsrækt.');
  expect(localizedDescription({ description: 'A gym.', descriptionIs: null }, 'is')).toBe('A gym.');
  expect(localizedDescription({ description: null, descriptionIs: 'Líkamsrækt.' }, 'en')).toBeNull();
  expect(localizedDescription({ description: null, descriptionIs: 'Líkamsrækt.' }, 'is')).toBe('Líkamsrækt.');
});

it('a blank Icelandic description is no Icelandic description: Icelandic shows the English', () => {
  for (const blank of ['', '   ', '\n\t ']) {
    expect(localizedDescription({ description: 'A gym.', descriptionIs: blank }, 'is')).toBe('A gym.');
    expect(icelandicDescription({ descriptionIs: blank })).toBeNull();
  }
  expect(icelandicDescription({ descriptionIs: null })).toBeNull();
  expect(icelandicDescription({ descriptionIs: '  Líkamsrækt.  ' })).toBe('Líkamsrækt.');
});

it('a venue without a photo has no images', () => {
  expect(venueImages({ imageUrl: null })).toEqual([]);
  expect(venueImages({ imageUrl: '' })).toEqual([]);
  expect(venueImages({ imageUrl: 'https://example.test/a.jpg' })).toEqual(['https://example.test/a.jpg']);
});
