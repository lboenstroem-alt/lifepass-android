/**
 * The featured venue (iOS `HomeView.pickHero`, 2.5.2): never "coming soon"
 * while something bookable exists, a photo preferred, the nearest within
 * 20 km with a real fix, else the one already featured, else a random one.
 */
import { HERO_RADIUS_M, hasHeroImage, pickHero, resolveHero } from '../pickHero';
import { north, REYKJAVIK, testVenue, venueId } from './homeVenues';

const first = () => 0;
const last = () => 0.999;

describe('pickHero', () => {
  it('never features a coming-soon venue while a bookable one exists (the 2.5.2 device check)', () => {
    const soon = testVenue(1, 'Box800', { comingSoon: true, at: REYKJAVIK });
    const bookable = testVenue(2, 'Laugardalslaug', { at: north(15_000) });
    // Even with a fix right on top of the coming-soon venue.
    expect(pickHero([soon, bookable], { grantedFix: REYKJAVIK, currentId: null, random: first })).toBe(bookable.id);
    for (const random of [first, last]) {
      expect(pickHero([soon, bookable], { grantedFix: null, currentId: null, random })).toBe(bookable.id);
    }
  });

  it('features a coming-soon venue only when nothing else exists', () => {
    const soon = testVenue(1, 'Box800', { comingSoon: true });
    expect(pickHero([soon], { grantedFix: null, currentId: null, random: first })).toBe(soon.id);
  });

  it('prefers a venue with a photo, so the hero is never a grey slab', () => {
    const bare = testVenue(1, 'No photo', { image: null, at: REYKJAVIK });
    const pictured = testVenue(2, 'Photo', { at: north(10_000) });
    expect(pickHero([bare, pictured], { grantedFix: REYKJAVIK, currentId: null })).toBe(pictured.id);
    expect(pickHero([bare, pictured], { grantedFix: null, currentId: null, random: first })).toBe(pictured.id);
    expect(hasHeroImage(bare)).toBe(false);
    expect(hasHeroImage({ imageUrl: '' })).toBe(false);
  });

  it('falls back to a venue without a photo when none has one', () => {
    const a = testVenue(1, 'A', { image: null });
    const b = testVenue(2, 'B', { image: null });
    expect(pickHero([a, b], { grantedFix: null, currentId: null, random: last })).toBe(b.id);
  });

  it('with a fix, picks the nearest bookable venue with a photo within 20 km', () => {
    const far = testVenue(1, 'Far', { at: north(18_000) });
    const near = testVenue(2, 'Near', { at: north(3_000) });
    const nearer = testVenue(3, 'Nearer but no photo', { at: north(500), image: null });
    expect(pickHero([far, near, nearer], { grantedFix: REYKJAVIK, currentId: far.id })).toBe(near.id);
  });

  it('beyond 20 km keeps the venue already featured, or picks a random one', () => {
    const a = testVenue(1, 'Akureyri pool', { at: north(HERO_RADIUS_M + 500) });
    const b = testVenue(2, 'Egilsstaðir pool', { at: north(HERO_RADIUS_M * 10) });
    expect(pickHero([a, b], { grantedFix: REYKJAVIK, currentId: b.id })).toBe(b.id);
    expect(pickHero([a, b], { grantedFix: REYKJAVIK, currentId: null, random: first })).toBe(a.id);
    expect(pickHero([a, b], { grantedFix: REYKJAVIK, currentId: null, random: last })).toBe(b.id);
  });

  it('exactly 20 km away still counts', () => {
    const edge = testVenue(1, 'Edge', { at: north(HERO_RADIUS_M - 1) });
    const other = testVenue(2, 'Other', { at: north(HERO_RADIUS_M * 3) });
    expect(pickHero([other, edge], { grantedFix: REYKJAVIK, currentId: other.id })).toBe(edge.id);
  });

  it('a later fix moves the hero; a refresh with no fix keeps it', () => {
    const a = testVenue(1, 'A', { at: north(30_000) });
    const b = testVenue(2, 'B', { at: north(60_000) });
    let hero = pickHero([a, b], { grantedFix: null, currentId: null, random: last });
    expect(hero).toBe(b.id);
    // A reload with no fix: held still.
    hero = pickHero([a, b], { grantedFix: null, currentId: hero, random: first });
    expect(hero).toBe(b.id);
    // The fix lands near A.
    hero = pickHero([a, b], { grantedFix: north(29_000), currentId: hero });
    expect(hero).toBe(a.id);
  });

  it('a venue with no position is never the nearest, but may still be the random pick', () => {
    const nowhere = testVenue(1, 'Nowhere', { at: null });
    expect(pickHero([nowhere], { grantedFix: REYKJAVIK, currentId: null, random: first })).toBe(nowhere.id);
  });

  it('answers null with nothing to feature', () => {
    expect(pickHero([], { grantedFix: REYKJAVIK, currentId: null })).toBeNull();
  });
});

describe('resolveHero', () => {
  it('is the featured venue, else the first in the list (iOS `hero`)', () => {
    const a = testVenue(1, 'A');
    const b = testVenue(2, 'B');
    expect(resolveHero([a, b], b.id)).toBe(b);
    expect(resolveHero([a, b], null)).toBe(a);
    expect(resolveHero([a, b], venueId(99))).toBe(a);
    expect(resolveHero([], venueId(1))).toBeNull();
  });
});
