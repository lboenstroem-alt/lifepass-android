/**
 * Sights in Explore's search (../SightsSearchGroup.tsx, iOS SearchMapView
 * `sightSearchResults`): the 2-character floor, folding, up to 5 rows, the
 * row's words, the credit, the bounded height, the load a query starts, and
 * what a tap hands Explore.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import { Keyboard, View } from 'react-native';

import { stubApiClientPerTest } from '../../../api/testing';
import { setCurrentLanguage } from '../../../i18n';
import { attractionMarkersStore, resetAttractionMarkers } from '../markersStore';
import SightsSearchGroup, { MAX_SIGHT_MATCHES, sightRowsMaxHeight } from '../SightsSearchGroup';
import { markerJson, sight } from './fixtures';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest({ token: null });

const MARKERS = [
  sight('oxararfoss', { name: 'Öxarárfoss', kind: 'waterfall', region: 'capital', tier: 'notable', rankScore: 70, latitude: 64.2654, longitude: -21.1166 }),
  sight('thingvellir', { name: 'Þingvellir', kind: 'national_park', region: 'south', tier: 'top', rankScore: 99, latitude: 64.2559, longitude: -21.1299 }),
  sight('tjornin', { name: 'Tjörnin', nameEn: 'The Pond', kind: 'lake', region: 'capital', tier: 'standard', rankScore: 20 }),
  sight('somewhere', { name: 'Skrítinfoss', kind: 'brand_new_kind', region: 'atlantis', tier: 'notable', rankScore: 10 }),
  sight('skogafoss', { name: 'Skógafoss', kind: 'waterfall', region: 'south', tier: 'top', rankScore: 93 }),
  sight('gljufrabui', { name: 'Gljúfrabúi', kind: 'waterfall', region: 'south', tier: 'notable', rankScore: 80 }),
  sight('seljalandsfoss', { name: 'Seljalandsfoss', kind: 'waterfall', region: 'south', tier: 'top', rankScore: 94 }),
  sight('haifoss', { name: 'Háifoss', kind: 'waterfall', region: 'south', tier: 'top', rankScore: 85 }),
  sight('glymur', { name: 'Glymur', kind: 'hike', region: 'west', tier: 'top', rankScore: 80 }),
];

const onOpenSight = jest.fn();

function hold(markers = MARKERS) {
  attractionMarkersStore.setState({ page: { attractions: markers, attribution: 'ODbL' }, locale: 'en' });
}

async function renderGroup(query: string) {
  return render(<SightsSearchGroup query={query} onOpenSight={onOpenSight} />);
}

/** The rows' names, top to bottom. */
function names(): string[] {
  return screen.queryAllByTestId(/^explore\.sights\.row\./).map((row) => String(row.props.testID).replace('explore.sights.row.', ''));
}

beforeEach(() => {
  resetAttractionMarkers();
  setCurrentLanguage('en');
  onOpenSight.mockReset();
});

afterEach(async () => {
  await act(async () => setCurrentLanguage('en'));
});

describe('which sights it lists (iOS AttractionSearch.matches)', () => {
  it('needs two characters after folding', async () => {
    hold();
    await renderGroup('s');
    expect(screen.queryByTestId('explore.sights')).toBeNull();
    await renderGroup(' ö ');
    expect(screen.queryByTestId('explore.sights')).toBeNull();
  });

  it('folds Icelandic letters: “thingvellir” finds Þingvellir, “oxara” Öxarárfoss', async () => {
    hold();
    await renderGroup('thingvellir');
    expect(names()).toEqual(['thingvellir']);
    await renderGroup('OXARA');
    expect(names()).toEqual(['oxararfoss']);
  });

  it('matches the English name too, and shows it in English', async () => {
    hold();
    await renderGroup('pond');
    expect(names()).toEqual(['tjornin']);
    expect(screen.getByText('The Pond')).toBeTruthy();
  });

  it('lists at most 5, names that start with the query first, then the tier and the score', async () => {
    hold();
    await renderGroup('foss');
    expect(MAX_SIGHT_MATCHES).toBe(5);
    // Every one only contains "foss": top picks by score, then the notable ones.
    expect(names()).toEqual(['seljalandsfoss', 'skogafoss', 'haifoss', 'oxararfoss', 'somewhere']);
    await renderGroup('sk');
    expect(names()).toEqual(['skogafoss', 'somewhere']);
  });

  it('shows nothing when nothing matches', async () => {
    hold();
    await renderGroup('zzzz');
    expect(screen.queryByTestId('explore.sights')).toBeNull();
  });
});

describe('a row (iOS sightSearchRow)', () => {
  it('says the kind, the region and “Top pick”, under the heading and over the credit', async () => {
    hold();
    await renderGroup('skoga');
    expect(screen.getByText('SIGHTS')).toBeTruthy();
    expect(screen.getByText('Skógafoss')).toBeTruthy();
    expect(screen.getByText('Waterfall · South Iceland · Top pick')).toBeTruthy();
    expect(screen.getByText('Place data © OpenStreetMap contributors, ODbL')).toBeTruthy();
    const row = screen.getByTestId('explore.sights.row.skogafoss');
    expect(row).toHaveProp('accessibilityRole', 'button');
    expect(row).toHaveProp('accessibilityLabel', 'Skógafoss, Waterfall · South Iceland · Top pick');
  });

  it('leaves out a region it does not know, and calls a kind it does not know a “Sight”', async () => {
    hold();
    await renderGroup('skritin');
    expect(screen.getByText('Sight')).toBeTruthy();
  });

  it('speaks Icelandic in Icelandic, with the Icelandic name', async () => {
    hold();
    await act(async () => setCurrentLanguage('is'));
    await renderGroup('pond');
    expect(screen.getByText('Tjörnin')).toBeTruthy();
    expect(screen.getByText('Vatn · Höfuðborgarsvæðið')).toBeTruthy();
    expect(screen.getByText('ÁHUGAVERÐIR STAÐIR')).toBeTruthy();
    expect(screen.getByText('Staðagögn © OpenStreetMap contributors, ODbL')).toBeTruthy();
  });

  it('a tap closes the keyboard and opens the sight, handing over where it is', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    hold();
    await renderGroup('thing');
    await fireEvent.press(screen.getByTestId('explore.sights.row.thingvellir'));
    expect(dismiss).toHaveBeenCalled();
    expect(onOpenSight).toHaveBeenCalledWith('thingvellir', { latitude: 64.2559, longitude: -21.1299 });
  });
});

describe('the rows’ height', () => {
  it('takes 30 % of the space below the search row, between 72 and 180 points', () => {
    expect(sightRowsMaxHeight(0)).toBe(72);
    expect(sightRowsMaxHeight(200)).toBe(72);
    expect(sightRowsMaxHeight(400)).toBe(120);
    expect(sightRowsMaxHeight(900)).toBe(180);
  });

  it('holds the rows to the floor until the group has measured where it sits', async () => {
    hold();
    await renderGroup('foss');
    expect(screen.getByTestId('explore.sights.rows')).toHaveStyle({ maxHeight: 72 });
  });
});

describe('loading the sights', () => {
  it('a query starts the load (the list never loads them on its own)', async () => {
    api.on('GET', '/attractions', Reply.ok({ attractions: [markerJson('thingvellir', { name: 'Þingvellir' })], attribution: 'ODbL' }));
    await renderGroup('thing');
    await screen.findByTestId('explore.sights.row.thingvellir');
    expect(api.sentAll('/attractions')).toHaveLength(1);
    expect(api.sentAll('/attractions')[0].query).toMatchObject({ locale: 'en' });
  });

  it('asks nothing when the sights are already held', async () => {
    hold();
    await renderGroup('thing');
    await act(async () => undefined);
    expect(api.sentAll('/attractions')).toHaveLength(0);
  });
});

describe('the space below the search row', () => {
  type Measure = (callback: (x: number, y: number, width: number, height: number) => void) => void;

  it('ends at the keyboard while it is up, from the moment the group appears', async () => {
    jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true);
    jest.spyOn(Keyboard, 'metrics').mockReturnValue({ screenX: 0, screenY: 500, width: 400, height: 300 });
    // The group's top in the window: 100 points down, so 400 points to the keyboard.
    const measure = jest
      .spyOn(View.prototype as unknown as { measureInWindow: Measure }, 'measureInWindow')
      .mockImplementation((callback) => callback(20, 100, 350, 200));
    try {
      hold();
      await renderGroup('foss');
      await fireEvent(screen.getByTestId('explore.sights'), 'layout', { nativeEvent: { layout: { x: 20, y: 100, width: 350, height: 200 } } });
      expect(screen.getByTestId('explore.sights.rows')).toHaveStyle({ maxHeight: 120 });
    } finally {
      measure.mockRestore();
      jest.restoreAllMocks();
    }
  });

  it('ends at the foot of the screen with the keyboard down', async () => {
    jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
    const measure = jest
      .spyOn(View.prototype as unknown as { measureInWindow: Measure }, 'measureInWindow')
      .mockImplementation((callback) => callback(20, 100, 350, 200));
    try {
      hold();
      await renderGroup('foss');
      await fireEvent(screen.getByTestId('explore.sights'), 'layout', { nativeEvent: { layout: { x: 20, y: 100, width: 350, height: 200 } } });
      // The test screen is 1334 points tall: 30 % of 1234 is past the ceiling.
      expect(screen.getByTestId('explore.sights.rows')).toHaveStyle({ maxHeight: 180 });
    } finally {
      measure.mockRestore();
      jest.restoreAllMocks();
    }
  });
});
