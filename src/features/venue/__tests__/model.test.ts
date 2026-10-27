/**
 * The venue page's rules (iOS VenueDetailView): the hero kicker, the share
 * link, `hasDirections`, the hours rows, the content-state and floating-bar
 * matrix, the walk-in price lines and the status-bar band.
 */
import { translate, type Lang } from '../../../i18n';
import {
  activityFromPrice,
  hasDirections,
  heroKicker,
  hourText,
  ratingCount,
  ratingLine,
  ratingText,
  showsGettingThere,
  statusBarBandOpacity,
  venueBar,
  venueContent,
  venuePhoneUrl,
  venueShareMessage,
  venueShareUrl,
  walkInBarPrice,
  walkInCardPrice,
} from '../model';
import { CLASSES, HOT_YOGA, venue, VENUE_ID } from './fixtures';

const tr = (lang: Lang) => (key: string, params?: Record<string, string | number>) => translate(key, lang, params);
const en = tr('en');
const is = tr('is');

const premium = (extra: Record<string, unknown> = {}) => venue({ inBundle: false, surchargePrice: 1990, ...extra });
const boutique = (extra: Record<string, unknown> = {}) => venue({ category: 'boutique', ...extra });

describe('the hero kicker', () => {
  it('premium with a price: "Premium · from ISK X"', () => {
    expect(heroKicker(premium(), en)).toEqual({ text: 'Premium · from ISK 1,990', premium: true });
    expect(heroKicker(premium(), is)).toEqual({ text: 'Premium · frá ISK 1,990', premium: true });
  });

  it('premium reads the price resolved for the member first', () => {
    expect(heroKicker(premium({ resolvedSurchargePrice: 1490 }), en).text).toBe('Premium · from ISK 1,490');
  });

  it('premium without a price is just "Premium", never "Premium · See venue"', () => {
    expect(heroKicker(venue({ inBundle: false }), en)).toEqual({ text: 'Premium', premium: true });
  });

  it('boutique: "Limited visits"', () => {
    expect(heroKicker(boutique({ topupPrice: 2500 }), en)).toEqual({ text: 'Limited visits', premium: false });
    expect(heroKicker(boutique(), is).text).toBe('Takmarkaðar heimsóknir');
  });

  it('in the bundle: "In your plan"', () => {
    expect(heroKicker(venue(), en)).toEqual({ text: 'In your plan', premium: false });
    expect(heroKicker(venue(), is).text).toBe('Í áskriftinni þinni');
  });
});

describe('sharing', () => {
  it('links to the web page by SLUG, never the id', () => {
    const v = venue();
    expect(venueShareUrl(v)).toBe('https://www.lifepass.is/venues/hress-reykjavik');
    expect(venueShareUrl(v)).not.toContain(VENUE_ID);
  });

  it('says "Check out {name} on LifePass" with the link after it', () => {
    expect(venueShareMessage(venue(), en)).toBe(
      'Check out Hress Reykjavík on LifePass https://www.lifepass.is/venues/hress-reykjavik',
    );
    expect(venueShareMessage(venue(), is)).toBe(
      'Kíktu á Hress Reykjavík á LifePass https://www.lifepass.is/venues/hress-reykjavik',
    );
  });
});

describe('hasDirections (iOS 2.5.4)', () => {
  it('an address alone is enough', () => {
    expect(hasDirections(venue({ coordinates: null }))).toBe(true);
  });

  it('coordinates alone are enough', () => {
    expect(hasDirections(venue({ address: null }))).toBe(true);
  });

  it('neither hides both buttons', () => {
    expect(hasDirections(venue({ address: null, coordinates: null }))).toBe(false);
  });

  it('an empty address is no address', () => {
    expect(hasDirections(venue({ address: '', coordinates: null }))).toBe(false);
  });

  it('half a position is no position', () => {
    expect(hasDirections(venue({ address: null, coordinates: { latitude: 64.1 } }))).toBe(false);
  });
});

describe('"Getting there"', () => {
  it('shows with an address, a phone or a position', () => {
    expect(showsGettingThere(venue())).toBe(true);
    expect(showsGettingThere(venue({ address: null, coordinates: null }))).toBe(true);
    expect(showsGettingThere(venue({ phone: null, coordinates: null }))).toBe(true);
    expect(showsGettingThere(venue({ address: null, phone: null }))).toBe(true);
  });

  it('is hidden with none of them', () => {
    expect(showsGettingThere(venue({ address: null, phone: null, coordinates: null }))).toBe(false);
  });
});

describe('the hours rows', () => {
  it('reads "06:00 – 22:00"', () => {
    expect(hourText({ open: '06:00', close: '22:00', closed: null }, en)).toEqual({ kind: 'open', text: '06:00 – 22:00' });
  });

  it('a closed day says so, in the account language', () => {
    expect(hourText({ open: null, close: null, closed: true }, en)).toEqual({ kind: 'closed', text: 'Closed' });
    expect(hourText({ open: '06:00', close: '22:00', closed: true }, is)).toEqual({ kind: 'closed', text: 'Lokað' });
  });

  it('an unknown day is a dash', () => {
    expect(hourText(null, en)).toEqual({ kind: 'unknown', text: '—' });
    expect(hourText({ open: '06:00', close: null, closed: false }, en)).toEqual({ kind: 'unknown', text: '—' });
  });
});

describe('the rating line (API 0.46.0: every rating counts)', () => {
  it('rated: "4.6 · 23 ratings", "4,6 · 23 einkunnir" in Icelandic', () => {
    const rated = venue({ averageRating: 4.6, totalRatings: 23, totalReviews: 5 });
    expect(ratingLine(rated, 'en')).toEqual({ rating: '4.6', count: '· 23 ratings' });
    expect(ratingLine(rated, 'is')).toEqual({ rating: '4,6', count: '· 23 einkunnir' });
  });

  it('counts with the plural rule: one rating, and the Icelandic singular for 21', () => {
    expect(ratingLine(venue({ totalRatings: 1 }), 'en')).toEqual({ rating: '4.6', count: '· 1 rating' });
    expect(ratingLine(venue({ totalRatings: 1 }), 'is')).toEqual({ rating: '4,6', count: '· 1 einkunn' });
    expect(ratingLine(venue({ totalRatings: 21 }), 'is')).toEqual({ rating: '4,6', count: '· 21 einkunn' });
    expect(ratingLine(venue({ totalRatings: 11 }), 'is')).toEqual({ rating: '4,6', count: '· 11 einkunnir' });
  });

  it('only quick ratings (no text, so no reviews): the ratings count, never "0 reviews"', () => {
    const quickOnly = venue({ averageRating: 4.5, totalReviews: null, totalRatings: 3 });
    expect(ratingLine(quickOnly, 'en')).toEqual({ rating: '4.5', count: '· 3 ratings' });
    expect(ratingCount(quickOnly)).toBe(3);
  });

  it('an older server: totalReviews is the count', () => {
    expect(ratingLine(venue({ totalRatings: null, totalReviews: 12 }), 'en')).toEqual({ rating: '4.6', count: '· 12 ratings' });
  });

  it('a rating with no count, or a count of 0, shows no count', () => {
    expect(ratingLine(venue({ totalRatings: null, totalReviews: 0 }), 'en')).toEqual({ rating: '4.6', count: null });
    expect(ratingLine(venue({ totalRatings: null, totalReviews: null }), 'en')).toEqual({ rating: '4.6', count: null });
    expect(ratingLine(venue({ totalRatings: 0, totalReviews: 0 }), 'is')).toEqual({ rating: '4,6', count: null });
  });

  it('writes the average as printf rounds it, with the Icelandic comma', () => {
    expect(ratingText(4.25, 'en')).toBe('4.2');
    expect(ratingText(4.75, 'is')).toBe('4,8');
    expect(ratingText(5, 'is')).toBe('5,0');
  });

  it('unrated: "No reviews yet"', () => {
    expect(ratingLine(venue({ averageRating: null }), 'en')).toEqual({ empty: 'No reviews yet' });
    expect(ratingLine(venue({ averageRating: 0 }), 'is')).toEqual({ empty: 'Engar umsagnir enn' });
  });
});

/**
 * The six input combinations of plan VENUE-1 (and the coming-soon variants):
 * what the middle of the page shows and which bar floats over the tab bar.
 */
describe('the content states and the floating bar', () => {
  const cases: [string, Record<string, unknown>, boolean, ReturnType<typeof venueContent>, ReturnType<typeof venueBar>['kind']][] = [
    [
      'awaiting connection (even with walk-ins and classes)',
      { awaitingConnection: true },
      true,
      { kind: 'comingSoon' },
      'none',
    ],
    [
      'activities awaiting connection, no walk-ins, no classes',
      { activitiesAwaitingConnection: true, walkInsAllowed: false },
      false,
      { kind: 'comingSoon' },
      'none',
    ],
    [
      'activities awaiting connection, but walk-ins',
      { activitiesAwaitingConnection: true, walkInsAllowed: true },
      false,
      { kind: 'offers', walkIn: true, classes: false },
      'scan',
    ],
    [
      'activities awaiting connection, but bookable classes',
      { activitiesAwaitingConnection: true, walkInsAllowed: false },
      true,
      { kind: 'offers', walkIn: false, classes: true },
      'book',
    ],
    ['walk-ins only', { walkInsAllowed: true }, false, { kind: 'offers', walkIn: true, classes: false }, 'scan'],
    [
      'walk-ins and classes (2.5.4)',
      { walkInsAllowed: true },
      true,
      { kind: 'offers', walkIn: true, classes: true },
      'scanAndClasses',
    ],
    ['classes only', { walkInsAllowed: false }, true, { kind: 'offers', walkIn: false, classes: true }, 'book'],
    ['neither', { walkInsAllowed: false }, false, { kind: 'unavailable' }, 'none'],
    ['neither, walk-ins unknown', { walkInsAllowed: null }, false, { kind: 'unavailable' }, 'none'],
  ];

  it.each(cases)('%s', (_name, fields, withClasses, content, bar) => {
    const v = venue(fields);
    const classes = withClasses ? CLASSES : [];
    expect(venueContent(v, classes)).toEqual(content);
    expect(venueBar(v, classes).kind).toBe(bar);
  });

  it('the classes-only bar books the FIRST class', () => {
    expect(venueBar(venue({ walkInsAllowed: false }), CLASSES)).toEqual({ kind: 'book', activity: HOT_YOGA });
  });
});

describe('the walk-in price lines', () => {
  it('in the bundle: "Included in your plan" on the card, "Included" on the pill, the top-up beneath', () => {
    const v = venue({ topupPrice: 990, daypassPrice: 2990 });
    expect(walkInCardPrice(v, en)).toEqual({ primary: 'Included in your plan', secondary: 'Top-up from ISK 990' });
    expect(walkInBarPrice(v, en)).toBe('Included');
    expect(walkInCardPrice(v, is)).toEqual({ primary: 'Innifalið í áskriftinni þinni', secondary: 'Viðbót frá ISK 990' });
    expect(walkInBarPrice(v, is)).toBe('Innifalið');
  });

  it('in the bundle without a top-up: the day pass, else nothing', () => {
    expect(walkInCardPrice(venue({ daypassPrice: 2990 }), en).secondary).toBe('Day pass from ISK 2,990');
    expect(walkInCardPrice(venue(), en).secondary).toBeNull();
  });

  it('premium: "from ISK X" on both, no second line', () => {
    expect(walkInCardPrice(premium({ topupPrice: 990 }), en)).toEqual({ primary: 'from ISK 1,990', secondary: null });
    expect(walkInBarPrice(premium(), en)).toBe('from ISK 1,990');
  });

  it('premium without a figure points to the venue rather than inventing one', () => {
    expect(walkInBarPrice(venue({ inBundle: false }), en)).toBe('See venue');
  });

  it('boutique: "Limited visits" and "Extra visits from …"', () => {
    const v = boutique({ topupPrice: 2500 });
    expect(walkInCardPrice(v, en)).toEqual({ primary: 'Limited visits', secondary: 'Extra visits from ISK 2,500' });
    expect(walkInBarPrice(v, en)).toBe('Limited visits');
  });
});

describe("a class row's from-price", () => {
  it('premium with a price: "from ISK X · exact price at confirm"', () => {
    expect(activityFromPrice(premium(), en)).toBe('from ISK 1,990 · exact price at confirm');
    expect(activityFromPrice(premium(), is)).toBe('frá ISK 1,990 · nákvæmt verð við staðfestingu');
  });

  it('none in the bundle, or without a figure', () => {
    expect(activityFromPrice(venue(), en)).toBeNull();
    expect(activityFromPrice(boutique({ topupPrice: 2500 }), en)).toBeNull();
    expect(activityFromPrice(venue({ inBundle: false }), en)).toBeNull();
  });
});

describe('"Call the venue"', () => {
  it('dials the digits and the plus only', () => {
    expect(venuePhoneUrl('+354 555 1234')).toBe('tel:+3545551234');
    expect(venuePhoneUrl('(+354) 555-1234')).toBe('tel:+3545551234');
  });

  it('nothing to dial is no link', () => {
    expect(venuePhoneUrl(null)).toBeNull();
    expect(venuePhoneUrl('')).toBeNull();
    expect(venuePhoneUrl('ask at the desk')).toBeNull();
  });
});

describe('the status-bar band', () => {
  // Fully in when the hero's title block (its bottom third, 280 of 420)
  // reaches the covered strip, with an 80 pt fade before that.
  it('is invisible while the hero is at the top', () => {
    expect(statusBarBandOpacity(0, 24)).toBe(0);
    expect(statusBarBandOpacity(176, 24)).toBe(0);
  });

  it('fades in over 80 pt and stays in', () => {
    expect(statusBarBandOpacity(216, 24)).toBeCloseTo(0.5);
    expect(statusBarBandOpacity(256, 24)).toBe(1);
    expect(statusBarBandOpacity(900, 24)).toBe(1);
  });

  it('follows a hero that large text made taller', () => {
    // 2/3 of 540 is 360: fully in at 336 with a 24 pt strip.
    expect(statusBarBandOpacity(256, 24, 540)).toBe(0);
    expect(statusBarBandOpacity(336, 24, 540)).toBe(1);
  });
});
