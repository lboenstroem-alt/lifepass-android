/**
 * The venue wizard's data (iOS Models/CoachQuestions.swift): the region
 * boxes, the location filter (straight line, owner decision D11), the
 * narrower-category override, which venue type words name (in iOS's order),
 * and the question tables in both languages.
 */
import { lookup, type Lang } from '../../i18n';
import {
  apiCategory,
  applyLocationFilter,
  coachCategoryOverride,
  coachLocationFilter,
  detectVenueCategory,
  displayCategoryName,
  DRIVE_RADIUS_METRES,
  icelandRegion,
  LocationValue,
  VENUE_CATEGORIES,
  venueQuestions,
} from '../coachQuestions';
import { REYKJAVIK_CENTRE } from '../../lib/geo';

type Place = { readonly id: string; readonly latitude: number | null; readonly longitude: number | null };

const place = (id: string, latitude: number | null, longitude: number | null): Place => ({ id, latitude, longitude });

// Real places, for the boxes and the distances.
const LAUGARDALSLAUG = place('laugardalslaug', 64.1468, -21.8796); // Reykjavík, about 3 km from the centre
const KOPAVOGUR = place('kopavogur', 64.1123, -21.9126);
const KEFLAVIK = place('keflavik', 64.0049, -22.5624); // about 33 km from the centre
const SELFOSS = place('selfoss', 63.9331, -20.9971);
const AKUREYRI = place('akureyri', 65.6835, -18.0878);
const NO_POSITION = place('nowhere', null, null);

const ids = (venues: readonly Place[]) => venues.map((venue) => venue.id);

describe('icelandRegion: the region boxes', () => {
  it.each([
    ['Reykjavík centre', 64.1466, -21.9426, 'capital'],
    ['Keflavík (Reykjanes)', 64.0049, -22.5624, 'capital'],
    ['Hafnarfjörður', 64.0671, -21.9377, 'capital'],
    ['Selfoss', 63.9331, -20.9971, 'south'],
    ['Hella', 63.8358, -20.3964, 'south'],
    // Just east of the capital box, below 64.25N: South, never West (the bug the latitude gate fixed).
    ['Hveragerði', 64.0, -21.1856, 'south'],
    ['Vík', 63.4194, -19.006, 'south'],
    ['Vestmannaeyjar', 63.4427, -20.2734, 'south'],
    ['Akranes', 64.3218, -22.0749, 'west'],
    ['Borgarnes', 64.5383, -21.9206, 'west'],
    ['Ísafjörður', 66.0749, -23.135, 'west'],
    ['Akureyri', 65.6835, -18.0878, 'north'],
    ['Húsavík', 66.0449, -17.3389, 'north'],
    ['Egilsstaðir', 65.2653, -14.3948, 'east'],
    ['Höfn', 64.2539, -15.2082, 'east'],
  ])('%s (%s, %s) is %s', (_name, lat, lon, region) => {
    expect(icelandRegion(lat, lon)).toBe(region);
  });
});

describe('coachLocationFilter: the location chip in the answers', () => {
  it('finds the chip at any step, and only a chip value counts', () => {
    expect(coachLocationFilter(['weightlifting', LocationValue.drive, 'with a sauna'])).toEqual({ kind: 'nearbyDrive' });
    expect(coachLocationFilter([LocationValue.capital])).toEqual({ kind: 'region', region: 'capital' });
    expect(coachLocationFilter(['geothermal pools', 'south'])).toEqual({ kind: 'region', region: 'south' });
    expect(coachLocationFilter(['', 'north'])).toEqual({ kind: 'region', region: 'north' });
    expect(coachLocationFilter(['east'])).toEqual({ kind: 'region', region: 'east' });
    expect(coachLocationFilter(['west'])).toEqual({ kind: 'region', region: 'west' });
    // Typed instead of tapped: no filter.
    expect(coachLocationFilter(['hot yoga', 'near Hlemmur'])).toEqual({ kind: 'none' });
    expect(coachLocationFilter([])).toEqual({ kind: 'none' });
  });
});

describe('coachCategoryOverride: a training type narrows the category', () => {
  it('MMA and Pilates map to their own tags; everything else keeps the broad category', () => {
    expect(coachCategoryOverride(['MMA and combat sports', LocationValue.capital])).toBe('MMA');
    expect(coachCategoryOverride(['pilates'])).toBe('Pilates');
    expect(coachCategoryOverride(['pilates reformer', 'south'])).toBe('Pilates');
    expect(coachCategoryOverride(['weightlifting', 'spinning classes', 'CrossFit', 'hot yoga'])).toBeNull();
    expect(coachCategoryOverride([])).toBeNull();
  });
});

describe('applyLocationFilter', () => {
  const all = [KEFLAVIK, SELFOSS, NO_POSITION, LAUGARDALSLAUG, AKUREYRI, KOPAVOGUR];

  it('no location answer leaves the list as the API sent it', () => {
    expect(applyLocationFilter(all, { kind: 'none' }, null)).toEqual({ venues: all, noteKey: null });
  });

  it('a region keeps the venues inside it, in the API order; a venue with no position drops out', () => {
    const result = applyLocationFilter(all, { kind: 'region', region: 'capital' }, null);
    expect(ids(result.venues)).toEqual(['keflavik', 'laugardalslaug', 'kopavogur']);
    expect(result.noteKey).toBeNull();
    expect(ids(applyLocationFilter(all, { kind: 'region', region: 'east' }, null).venues)).toEqual([]);
  });

  it('"15-min drive" with a fix: within 15 km in a straight line, nearest first', () => {
    const fix = { latitude: 64.1466, longitude: -21.8796 }; // at Laugardalslaug
    const result = applyLocationFilter(all, { kind: 'nearbyDrive' }, fix);
    expect(ids(result.venues)).toEqual(['laugardalslaug', 'kopavogur']);
    expect(result.noteKey).toBeNull();
  });

  it('"15-min drive" with nothing in range: the closest, with a note saying so', () => {
    const atAkureyri = { latitude: 65.6835, longitude: -18.0878 };
    const result = applyLocationFilter([KEFLAVIK, SELFOSS, LAUGARDALSLAUG], { kind: 'nearbyDrive' }, atAkureyri);
    expect(ids(result.venues)).toEqual(['selfoss', 'laugardalslaug', 'keflavik']);
    expect(result.noteKey).toBe('coach.note.nothing_nearby');
  });

  it('"15-min drive" without a fix: measured from Reykjavík centre, and the note says so', () => {
    const result = applyLocationFilter(all, { kind: 'nearbyDrive' }, null);
    expect(ids(result.venues)).toEqual(['laugardalslaug', 'kopavogur']);
    expect(result.noteKey).toBe('coach.note.no_location');
  });

  it('without a fix and nothing near Reykjavík: the closest to it, still with the no-location note', () => {
    const result = applyLocationFilter([AKUREYRI, SELFOSS], { kind: 'nearbyDrive' }, null);
    expect(ids(result.venues)).toEqual(['selfoss', 'akureyri']);
    expect(result.noteKey).toBe('coach.note.no_location');
  });

  it('nothing to place: no venues and no note', () => {
    expect(applyLocationFilter([NO_POSITION], { kind: 'nearbyDrive' }, null)).toEqual({ venues: [], noteKey: null });
    expect(applyLocationFilter([], { kind: 'nearbyDrive' }, REYKJAVIK_CENTRE)).toEqual({ venues: [], noteKey: null });
  });

  it('the radius is 15 km: just inside counts, just outside does not', () => {
    // 0.1349 degrees of latitude is about 15.0 km.
    const inside = place('inside', REYKJAVIK_CENTRE.latitude + 0.1345, REYKJAVIK_CENTRE.longitude);
    const outside = place('outside', REYKJAVIK_CENTRE.latitude + 0.1355, REYKJAVIK_CENTRE.longitude);
    expect(DRIVE_RADIUS_METRES).toBe(15_000);
    expect(ids(applyLocationFilter([outside, inside], { kind: 'nearbyDrive' }, REYKJAVIK_CENTRE).venues)).toEqual(['inside']);
  });
});

describe('detectVenueCategory: the order is iOS’s', () => {
  it('yoga and swimming come before spa, spa before lagoon', () => {
    expect(detectVenueCategory('sauna and swimming')).toBe('swimming');
    expect(detectVenueCategory('wellness day with yoga')).toBe('yoga');
    expect(detectVenueCategory('Spa & Lagoons')).toBe('spa');
    expect(detectVenueCategory('Plan a perfect spa or lagoon evening for me.')).toBe('spa');
    expect(detectVenueCategory('a lagoon with a view')).toBe('lagoon');
    expect(detectVenueCategory('a workout and a sauna')).toBe('gym');
  });

  it('whole words where iOS uses them', () => {
    expect(detectVenueCategory('a gym')).toBe('gym');
    expect(detectVenueCategory('gymnastics for kids')).toBeNull();
    expect(detectVenueCategory('spaghetti')).toBeNull();
    // "poolside" holds "pools", which iOS matches anywhere too.
    expect(detectVenueCategory('poolside bar')).toBe('swimming');
    expect(detectVenueCategory('golf')).toBe('golf');
    expect(detectVenueCategory('a driving range')).toBe('golf');
    expect(detectVenueCategory('hello')).toBeNull();
    expect(detectVenueCategory('')).toBeNull();
  });

  it('Home’s card prompts name their category', () => {
    expect(detectVenueCategory('Suggest gym classes I should try this week.')).toBe('gym');
    expect(detectVenueCategory('I want to try Icelandic swimming pools. Which ones are best to start with this week?')).toBe('swimming');
    expect(detectVenueCategory("I'm new to yoga. Where should I start in Reykjavík?")).toBe('yoga');
  });
});

describe('the question tables', () => {
  const t = (lang: Lang) => (key: string) => lookup(key, lang);

  it.each<Lang>(['en', 'is'])('every label and question is translated (%s), every value stays an internal key', (lang) => {
    const tables = venueQuestions(t(lang));
    const english = venueQuestions(t('en'));
    for (const category of VENUE_CATEGORIES) {
      const questions = tables[category];
      expect(questions.length).toBeGreaterThan(0);
      questions.forEach((question, index) => {
        expect(question.text).not.toMatch(/^coach\./);
        for (const option of question.options) expect(option.label).not.toMatch(/^coach\./);
        // The values are the same in both languages.
        expect(question.options.map((option) => option.value)).toEqual(english[category][index]!.options.map((o) => o.value));
      });
      // Every category asks where.
      expect(questions.some((question) => question.options.some((option) => option.value === LocationValue.drive))).toBe(true);
    }
  });

  it('the Icelandic member reads Icelandic', () => {
    const tables = venueQuestions(t('is'));
    expect(tables.gym[1]!.text).toBe(lookup('coach.q.location', 'is'));
    expect(tables.gym[1]!.text).not.toBe(lookup('coach.q.location', 'en'));
    expect(tables.gym[0]!.options.find((option) => option.value === 'MMA and combat sports')!.label).toBe(
      lookup('coach.opt.gym.mma', 'is'),
    );
  });

  it('the sets match iOS: three questions for gym, yoga and swimming, two for lagoon and spa, one for golf', () => {
    const tables = venueQuestions(t('en'));
    expect(tables.gym.map((q) => q.options.length)).toEqual([6, 6, 3]);
    expect(tables.lagoon.map((q) => q.options.length)).toEqual([3, 6]);
    expect(tables.yoga.map((q) => q.options.length)).toEqual([5, 6, 4]);
    expect(tables.swimming.map((q) => q.options.length)).toEqual([4, 6, 4]);
    expect(tables.spa.map((q) => q.options.length)).toEqual([5, 6]);
    expect(tables.golf.map((q) => q.options.length)).toEqual([6]);
    // "Other" opens a field, and only where iOS has one.
    const others = VENUE_CATEGORIES.filter((category) => tables[category][0]!.options.some((option) => option.isOther));
    expect(others).toEqual(['gym', 'yoga', 'spa']);
    expect(tables.gym[1]!.options.map((option) => option.value)).toEqual(['drive15', 'capital', 'south', 'north', 'east', 'west']);
  });

  it('the API category and the word a member reads differ ("Pool" vs "swimming")', () => {
    expect(apiCategory('swimming')).toBe('Pool');
    expect(apiCategory('gym')).toBe('Gym');
    expect(apiCategory('lagoon')).toBe('Lagoon');
    expect(apiCategory('yoga')).toBe('Yoga');
    expect(apiCategory('spa')).toBe('Spa');
    expect(apiCategory('golf')).toBe('Golf');
    expect(displayCategoryName('swimming', t('en'))).toBe(lookup('coach.cat_name.swimming', 'en'));
    expect(displayCategoryName('swimming', t('is'))).toBe(lookup('coach.cat_name.swimming', 'is'));
    expect(displayCategoryName('MMA', t('en'))).toBe('MMA');
  });
});
