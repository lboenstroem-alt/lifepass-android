/**
 * The Saved lists' suggestions (iOS LibraryView and FavouritesView): the
 * first three unsaved venues, and the line under each.
 */
import { translate, type Lang } from '../../../i18n';
import type { Venue } from '../../../types/venue';
import { capitalizedWords, suggestionCategory, suggestionReason, suggestionsFor } from '../saved/savedModel';

const tr = (lang: Lang) => (key: string, params?: Readonly<Record<string, string | number>>) => translate(key, lang, params);

function venue(id: string, extra: Partial<Venue> = {}): Venue {
  return {
    id,
    slug: `slug-${id}`,
    name: `Venue ${id}`,
    description: null,
    descriptionIs: null,
    address: null,
    city: null,
    latitude: null,
    longitude: null,
    imageUrl: null,
    categories: null,
    primaryCategory: null,
    walkInsAllowed: null,
    phone: null,
    amenities: null,
    averageRating: null,
    totalReviews: null,
    displayOrder: null,
    awaitingConnection: null,
    activitiesAwaitingConnection: null,
    openingHours: null,
    offerings: null,
    markerType: null,
    inBundle: true,
    surchargePrice: null,
    resolvedSurchargePrice: null,
    topupPrice: null,
    daypassPrice: null,
    ...extra,
  };
}

describe('suggestionsFor', () => {
  const all = ['a', 'b', 'c', 'd', 'e'].map((id) => venue(id));

  it('takes the first three not saved, in the server order', () => {
    expect(suggestionsFor(all, ['b']).map((v) => v.id)).toEqual(['a', 'c', 'd']);
  });

  it('caps at three and may be fewer', () => {
    expect(suggestionsFor(all, [])).toHaveLength(3);
    expect(suggestionsFor(all, ['a', 'b', 'c', 'd']).map((v) => v.id)).toEqual(['e']);
    expect(suggestionsFor(all, ['a', 'b', 'c', 'd', 'e'])).toEqual([]);
  });

  it('compares ids whatever their case, as UUIDs', () => {
    expect(suggestionsFor([venue('aa-bb')], ['AA-BB'])).toEqual([]);
  });
});

describe('the line under a suggestion', () => {
  it('Profile: the first category as spelled, else Wellness', () => {
    expect(suggestionCategory(venue('a', { categories: ['yoga', 'pilates'] }), tr('en'))).toBe('yoga');
    expect(suggestionCategory(venue('a', { categories: [] }), tr('en'))).toBe('Wellness');
    expect(suggestionCategory(venue('a'), tr('is'))).toBe('Vellíðan');
  });

  it('the Saved sheet: premium first, then the liked category, else near', () => {
    expect(suggestionReason(venue('a', { inBundle: false, categories: ['spa'] }), tr('en'))).toBe('Similar to your premium spots');
    expect(suggestionReason(venue('a', { categories: ['hot yoga'] }), tr('en'))).toBe('You liked Hot Yoga');
    expect(suggestionReason(venue('a', { categories: ['hot yoga'] }), tr('is'))).toBe('Þér líkaði Hot Yoga');
    expect(suggestionReason(venue('a', { categories: [] }), tr('en'))).toBe('Near your saved spots');
    expect(suggestionReason(venue('a'), tr('is'))).toBe('Nálægt vistuðu stöðunum þínum');
  });
});

describe('capitalizedWords (Foundation capitalized)', () => {
  it('upper-cases each word and lower-cases the rest', () => {
    expect(capitalizedWords('hot YOGA')).toBe('Hot Yoga');
    expect(capitalizedWords('spa-and-sauna')).toBe('Spa-And-Sauna');
    expect(capitalizedWords('ísbað')).toBe('Ísbað');
    expect(capitalizedWords('')).toBe('');
  });
});
