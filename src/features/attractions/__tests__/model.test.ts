/**
 * What a sight's card may say (iOS `AttractionDetail` and friends): the
 * access sentence, the drive only for road access, the nearest-road note,
 * the soak pairings, the money line, credits, links and the maps links; and
 * the figures as the card prints them.
 */
import { decodeAttractionDetail, type AttractionDetail } from '../../../api/attractions';
import { translate } from '../../../i18n';
import {
  creditLine,
  driveKilometres,
  driveLine,
  homeDistanceLabel,
  lengthText,
  pairingDriveText,
  pairingPriceText,
  parkingFeeLine,
  sightDistance,
  sightDuration,
  trailFacts,
  walkTimeText,
} from '../format';
import {
  accessSentenceKey,
  afterPairings,
  creditedThumbUrl,
  drawableSightImageUrl,
  geoUrl,
  googleMapsUrl,
  imageAlt,
  imageLicenseLink,
  isBathingWarning,
  isPlate,
  isPlateImageUrl,
  locationPreviewRegion,
  nearestRoadNoteMetres,
  regionCorners,
  returnPairings,
  roadDriveFromReykjavik,
  roadKilometres,
  routeBounds,
  routeRegion,
  sightDisplayName,
  soakPairings,
  sourceDisplayName,
  sourceLink,
  wholeDistanceM,
} from '../model';
import { detailJson } from './fixtures';

const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);
const is = (key: string, params?: Record<string, string | number>) => translate(key, 'is', params);

function card(overrides: Record<string, unknown> = {}): AttractionDetail {
  return decodeAttractionDetail(detailJson(overrides));
}

describe('travel', () => {
  it('names the access sentence for each way a place is reached', () => {
    expect(accessSentenceKey(card({ roadAccess: 'ferry', ferryPort: 'Landeyjahöfn' }))).toBe('attraction.ferry_from_landeyjahofn');
    expect(accessSentenceKey(card({ roadAccess: 'ferry', ferryPort: null }))).toBe('attraction.ferry_no_port');
    expect(accessSentenceKey(card({ roadAccess: 'ferry', ferryPort: 'Dalvík' }))).toBe('attraction.ferry_no_port');
    expect(accessSentenceKey(card({ roadAccess: 'offshore' }))).toBe('attraction.offshore');
    expect(accessSentenceKey(card({ roadAccess: 'road' }))).toBeNull();
    expect(accessSentenceKey(card({ roadAccess: 'hovercraft' }))).toBeNull();
  });

  it('never prints a drive for ferry, offshore or unknown access, even when the payload has one', () => {
    const drive = { minutes: 118, km: 128 };
    expect(roadDriveFromReykjavik(card({ roadAccess: 'road', driveFromReykjavik: drive }))).toEqual(drive);
    for (const roadAccess of ['ferry', 'offshore', 'hovercraft']) {
      expect(roadDriveFromReykjavik(card({ roadAccess, driveFromReykjavik: drive }))).toBeNull();
    }
  });

  it('says how far the road is only past a kilometre, and only for road access', () => {
    expect(nearestRoadNoteMetres(card({ nearestRoadM: 1000 }))).toBeNull();
    expect(nearestRoadNoteMetres(card({ nearestRoadM: 1001 }))).toBe(1001);
    expect(nearestRoadNoteMetres(card({ nearestRoadM: 5000, roadAccess: 'offshore' }))).toBeNull();
    expect(nearestRoadNoteMetres(card({ nearestRoadM: null }))).toBeNull();
  });

  it('writes the road kilometres as the web does (roadKilometres)', () => {
    expect(roadKilometres(2440, 'is')).toBe('2,4');
    expect(roadKilometres(2440, 'en')).toBe('2.4');
    expect(roadKilometres(12500, 'en')).toBe('13');
    expect(roadKilometres(1000, 'en')).toBe('1');
    expect(roadKilometres(1001, 'is')).toBe('1');
    expect(roadKilometres(9960, 'en')).toBe('10');
    expect(roadKilometres(2450, 'en')).toBe('2.5');
    // ClassDistanceTests: the classes distance and this agree in Icelandic.
    expect(`${roadKilometres(2440, 'is')} km`).toBe('2,4 km');
  });

  it('prints the drive line with a point in both languages', () => {
    expect(driveLine({ minutes: 118, km: 128 }, en)).toBe('1 h 58 min drive from Reykjavík · 128 km');
    expect(driveLine({ minutes: 45, km: 8.25 }, is)).toBe('45 mín akstur frá Reykjavík · 8.2 km');
    expect(driveKilometres(9.96)).toBe('10.0');
    expect(driveKilometres(10.5)).toBe('10');
  });
});

describe('soak (soakPairings)', () => {
  it('lists every pairing for road access and for the Landeyjahöfn ferry', () => {
    expect(soakPairings(card({ roadAccess: 'road' }))).toHaveLength(2);
    expect(soakPairings(card({ roadAccess: 'ferry', ferryPort: 'Landeyjahöfn' }))).toHaveLength(2);
  });

  it('lists none for offshore, other ferries and unknown access, whatever the server sent', () => {
    expect(soakPairings(card({ roadAccess: 'offshore' }))).toEqual([]);
    expect(soakPairings(card({ roadAccess: 'ferry', ferryPort: null }))).toEqual([]);
    expect(soakPairings(card({ roadAccess: 'ferry', ferryPort: 'Grímsey' }))).toEqual([]);
    expect(soakPairings(card({ roadAccess: 'hovercraft' }))).toEqual([]);
  });

  it('splits after this from on the way back, in the server’s order', () => {
    const a = card();
    expect(afterPairings(a).map((p) => p.venueSlug)).toEqual(['laugaskard']);
    expect(returnPairings(a).map((p) => p.venueSlug)).toEqual(['sky-lagoon']);
  });

  it('says Included only when inBundle is true, and never computes a price', () => {
    const base = { inBundle: false, fromPriceIsk: null };
    expect(pairingPriceText({ inBundle: true, fromPriceIsk: 4800 }, en)).toBe('Included on any LifePass');
    expect(pairingPriceText({ ...base, fromPriceIsk: 4800 }, en)).toBe('ISK 4,800 per visit with LifePass');
    expect(pairingPriceText(base, en)).toBe('per visit with LifePass');
    expect(pairingPriceText({ ...base, fromPriceIsk: 10100 }, is)).toBe('ISK 10,100 á heimsókn með LifePass');
    for (const text of [pairingPriceText(base, en), pairingPriceText({ ...base, fromPriceIsk: 4800 }, en)]) {
      expect(text).not.toContain(en('attraction.included'));
    }
    expect(pairingDriveText({ driveMinutes: 65 }, en)).toBe('65 min drive');
    expect(pairingDriveText({ driveMinutes: 65 }, is)).toBe('65 mín akstur');
  });

  it('prints the parking fee with en-US grouping in both languages', () => {
    expect(parkingFeeLine(10100, en)).toBe('Parking fee: ISK 10,100');
    expect(parkingFeeLine(10100, is)).toBe('Bílastæðagjald: ISK 10,100');
  });
});

describe('pictures and credits', () => {
  it('labels a plate Map and a photograph Photo', () => {
    expect(isPlate({ isMapPlate: true })).toBe(true);
    expect(isPlate({ isMapPlate: null })).toBe(false);
    expect(creditLine(en('attraction.map_label'), 'LifePass', 'CC BY 4.0')).toBe('Map: LifePass · CC BY 4.0');
    expect(creditLine(is('attraction.photo'), 'Zoran', 'CC BY-SA 3.0')).toBe('Mynd: Zoran · CC BY-SA 3.0');
  });

  it('opens a licence only over https', () => {
    expect(imageLicenseLink({ licenseUrl: 'https://creativecommons.org/licenses/by/4.0' })).toBe(
      'https://creativecommons.org/licenses/by/4.0',
    );
    expect(imageLicenseLink({ licenseUrl: 'http://creativecommons.org/licenses/by/4.0' })).toBeNull();
    expect(imageLicenseLink({ licenseUrl: null })).toBeNull();
  });

  it('reads the Icelandic alt text in Icelandic when there is one', () => {
    expect(imageAlt({ altEn: 'A', altIs: 'Á' }, 'is')).toBe('Á');
    expect(imageAlt({ altEn: 'A', altIs: null }, 'is')).toBe('A');
    expect(imageAlt({ altEn: 'A', altIs: 'Á' }, 'en')).toBe('A');
  });

  it('draws a Coach plan sight’s photo only with its credit, a plate always (CoachPlanSight.drawableImageURL)', () => {
    const photo = 'https://upload.wikimedia.org/glymur.jpg';
    const plate = 'https://www.lifepass.is/api/v1/attractions/plate/glymur';
    expect(drawableSightImageUrl(photo, 'Zoran')).toBe(photo);
    expect(drawableSightImageUrl(photo, null)).toBeNull();
    expect(drawableSightImageUrl(photo, '  ')).toBeNull();
    expect(drawableSightImageUrl(plate, null)).toBe(plate);
    expect(drawableSightImageUrl(null, 'Zoran')).toBeNull();
  });

  it('knows a plate by its URL (the Coach’s plan sights)', () => {
    expect(isPlateImageUrl('https://www.lifepass.is/api/v1/attractions/plate/glymur')).toBe(true);
    expect(isPlateImageUrl('https://upload.wikimedia.org/glymur.jpg')).toBe(false);
    expect(isPlateImageUrl(null)).toBe(false);
  });
});

describe('nearby', () => {
  it('draws a thumbnail only with both credit and licence', () => {
    const thumb = 'https://www.lifepass.is/thumb/x.jpg';
    expect(creditedThumbUrl({ thumb, thumbCredit: 'A', thumbLicense: 'CC BY 4.0' })).toBe(thumb);
    expect(creditedThumbUrl({ thumb, thumbCredit: 'A', thumbLicense: null })).toBeNull();
    expect(creditedThumbUrl({ thumb, thumbCredit: null, thumbLicense: 'CC BY 4.0' })).toBeNull();
    expect(creditedThumbUrl({ thumb: null, thumbCredit: 'A', thumbLicense: 'CC BY 4.0' })).toBeNull();
  });

  it('shows a distance only when the figure is one', () => {
    expect(wholeDistanceM({ distanceM: 656.4 })).toBe(656);
    expect(wholeDistanceM({ distanceM: 0 })).toBe(0);
    expect(wholeDistanceM({ distanceM: -5 })).toBeNull();
    expect(wholeDistanceM({ distanceM: 1e30 })).toBeNull();
    expect(wholeDistanceM({ distanceM: Infinity })).toBeNull();
  });

  it('names a sight by language', () => {
    expect(sightDisplayName({ name: 'Gljúfrabúi', nameEn: 'Gljufrafoss' }, 'en')).toBe('Gljufrafoss');
    expect(sightDisplayName({ name: 'Gljúfrabúi', nameEn: 'Gljufrafoss' }, 'is')).toBe('Gljúfrabúi');
    expect(sightDisplayName({ name: 'Drífandi', nameEn: null }, 'en')).toBe('Drífandi');
  });
});

describe('bathing', () => {
  it('warns for anything but safe, unverified included', () => {
    expect(isBathingWarning({ level: 'unverified' })).toBe(true);
    expect(isBathingWarning({ level: 'unsafe' })).toBe(true);
    expect(isBathingWarning({ level: 'safe' })).toBe(false);
  });
});

describe('sources', () => {
  it('names the known sources, others by their raw name, and links only over https', () => {
    expect(sourceDisplayName({ source: 'osm' })).toBe('OpenStreetMap');
    expect(sourceDisplayName({ source: 'wikidata' })).toBe('Wikidata');
    expect(sourceDisplayName({ source: 'commons' })).toBe('Wikimedia Commons');
    expect(sourceDisplayName({ source: 'wikipedia' })).toBe('Wikipedia');
    expect(sourceDisplayName({ source: 'lmi' })).toBe('lmi');
    expect(sourceLink({ sourceUrl: 'http://www.openstreetmap.org/node/1' })).toBeNull();
    expect(sourceLink({ sourceUrl: 'https://www.wikidata.org/wiki/Q1' })).toBe('https://www.wikidata.org/wiki/Q1');
  });
});

describe('maps', () => {
  it('pads a route ×1.4 with a floor for short and straight walks', () => {
    const bounds = routeBounds(
      card({ routeGeojson: { type: 'LineString', coordinates: [[-21, 64], [-21, 64.1]] } }),
    );
    expect(bounds).toEqual({ south: 64, west: -21, north: 64.1, east: -21 });
    const region = routeRegion(bounds!);
    expect(region.center).toEqual({ latitude: 64.05, longitude: -21 });
    expect(region.latitudeDelta).toBeCloseTo(0.14);
    // A north-south line gets the minimum width.
    expect(region.longitudeDelta).toBe(0.02);
    expect(routeRegion({ south: 64, west: -21, north: 64.001, east: -20.999 }).latitudeDelta).toBe(0.01);
    expect(routeBounds(card())).toBeNull();
  });

  it('frames the spot 0.3° by 0.6° when there is no picture', () => {
    const region = locationPreviewRegion({ latitude: 64, longitude: -20 });
    expect(regionCorners(region)).toEqual({ ne: [-19.7, 64.15], sw: [-20.3, 63.85] });
  });

  it('opens Google Maps with the server’s https link, else coordinates with six decimals and a point', () => {
    expect(googleMapsUrl(card())).toBe('https://www.google.com/maps/dir/?api=1&destination=63.615452,-19.988276');
    const fallback = { latitude: 64.1, longitude: -21.95, mapsLinks: { google: 'http://maps.google.com/?q=x', apple: null } };
    expect(googleMapsUrl(fallback)).toBe('https://www.google.com/maps/dir/?api=1&destination=64.100000,-21.950000');
    expect(googleMapsUrl({ ...fallback, mapsLinks: null })).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=64.100000,-21.950000',
    );
  });

  it('pins another maps app at the coordinates with the name as its label', () => {
    expect(geoUrl({ name: 'Dyrhólaey (arch)', latitude: 63.4, longitude: -19.13 })).toBe(
      'geo:63.400000,-19.130000?q=63.400000,-19.130000(Dyrh%C3%B3laey%20%28arch%29)',
    );
  });
});

describe('figures', () => {
  it('prints a distance with one decimal from a kilometre, and metres below', () => {
    expect(sightDistance(850)).toBe('850 m');
    expect(sightDistance(1000)).toBe('1.0 km');
    expect(sightDistance(1250)).toBe('1.2 km');
    expect(sightDistance(12400)).toBe('12.4 km');
  });

  it('prints a duration in hours and minutes (mín, klst in Icelandic)', () => {
    expect(sightDuration(45, en)).toBe('45 min');
    expect(sightDuration(120, en)).toBe('2 h');
    expect(sightDuration(68, en)).toBe('1 h 8 min');
    expect(sightDuration(68, is)).toBe('1 klst 8 mín');
    expect(sightDuration(0, en)).toBe('0 min');
  });

  it('names one way and there and back only on an out-and-back walk', () => {
    expect(lengthText(7100, true, en)).toBe('7.1 km one way');
    expect(lengthText(7100, false, en)).toBe('7.1 km');
    expect(walkTimeText(180, true, is)).toBe('3 klst fram og til baka');
    expect(walkTimeText(180, false, en)).toBe('3 h');
  });

  it('writes a walk link’s facts, leaving out what is missing', () => {
    expect(trailFacts({ lengthM: 7100, durationMinutes: 180, outAndBack: true }, en)).toBe('7.1 km one way · 3 h there and back');
    expect(trailFacts({ lengthM: 7100, durationMinutes: null, outAndBack: false }, en)).toBe('7.1 km');
    expect(trailFacts({ lengthM: null, durationMinutes: 45, outAndBack: false }, en)).toBe('45 min');
    expect(trailFacts({ lengthM: null, durationMinutes: null, outAndBack: true }, en)).toBeNull();
  });

  it('prints Home’s straight-line distances with a point in both languages', () => {
    expect(homeDistanceLabel(350)).toBe('350 m');
    expect(homeDistanceLabel(999.4)).toBe('999 m');
    expect(homeDistanceLabel(4200)).toBe('4.2 km');
    expect(homeDistanceLabel(40000)).toBe('40 km');
    expect(homeDistanceLabel(42400)).toBe('42 km');
  });
});
