/**
 * The pool picker's order and second line (iOS PlanVenuePickerSheet):
 * nearest first with the distance in the account language when the phone
 * has a granted fix; the catalogue's order and the city otherwise.
 */
import { poolDistanceLabel, sortPools } from '../poolOrder';

const harpa = { latitude: 64.1502, longitude: -21.9327 };
const pools = [
  { slug: 'lagardalslaug', city: 'Reykjavík', latitude: 64.1414, longitude: -21.8771 },
  { slug: 'no-position', city: 'Kópavogur', latitude: null, longitude: null },
  { slug: 'sundholl', city: 'Reykjavík', latitude: 64.1449, longitude: -21.9238 },
  { slug: 'vesturbaejarlaug', city: 'Reykjavík', latitude: 64.1461, longitude: -21.9613 },
];

describe('the pool order', () => {
  it('is nearest first when a fix exists, a pool with no position last', () => {
    expect(sortPools(pools, harpa).map((pool) => pool.slug)).toEqual([
      'sundholl',
      'vesturbaejarlaug',
      'lagardalslaug',
      'no-position',
    ]);
  });

  it("keeps the catalogue's order without one", () => {
    expect(sortPools(pools, null).map((pool) => pool.slug)).toEqual(pools.map((pool) => pool.slug));
  });

  it('does not touch the list it was given', () => {
    const copy = [...pools];
    sortPools(pools, harpa);
    expect(pools).toEqual(copy);
  });
});

describe('the second line', () => {
  it('is the distance in kilometres, in the account language', () => {
    expect(poolDistanceLabel(pools[0]!, harpa, 'en')).toBe('2.9 km');
    expect(poolDistanceLabel(pools[0]!, harpa, 'is')).toBe('2,9 km');
    // Always kilometres with one decimal, as iOS prints it.
    expect(poolDistanceLabel(pools[2]!, harpa, 'en')).toBe('0.7 km');
  });

  it('is the city without a fix or a position, and nothing without a city', () => {
    expect(poolDistanceLabel(pools[0]!, null, 'en')).toBe('Reykjavík');
    expect(poolDistanceLabel(pools[1]!, harpa, 'en')).toBe('Kópavogur');
    expect(poolDistanceLabel({ city: null, latitude: null, longitude: null }, null, 'en')).toBeNull();
  });
});
