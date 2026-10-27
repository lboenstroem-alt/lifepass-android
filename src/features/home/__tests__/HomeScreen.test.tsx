/**
 * The Home tab on screen (iOS HomeView): the hero and its header-only state,
 * the greeting, weather, pass chip and upcoming card, the avatar and the
 * one-time Profile pointer, the Coach hand-off and the ask field, the
 * referral card, both shelves, the error state with its retry (iOS
 * VenueLoadErrorTests on Home), the reads at every visit and the pull to
 * refresh.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import { DeviceEventEmitter, Keyboard, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { stubApiClientPerTest } from '../../../api/testing';
import { translate } from '../../../i18n';
import { restoreTestFontScale, setTestFontScale } from '../../../hooks/testing';
import { UPGRADED_FROM_PROFILE_TAB_KEY } from '../../../navigation/navPrefs';
import { profileOpenedKey } from '../../../navigation/profile';
import { useIntentStore } from '../../../stores/intentStore';
import { greetingKey } from '../greeting';
import * as heroRules from '../pickHero';
import TryNewSection, { type TryNewSectionHandle } from '../TryNewSection';
import { HOME_ASK_CHIPS, HOME_COACH_CATEGORIES } from '../coachPrompts';
import {
  analytics,
  bookingRow,
  freshHome,
  homeNavigation,
  leaveHome,
  MEMBER,
  profileJSON,
  renderHome,
  requestLocation,
  settle,
  usageWith,
  weather,
} from './homeHarness';
import { north, REYKJAVIK, testVenue, venuePage } from './homeVenues';

// expo-font (behind @expo/vector-icons) imports expo-asset, which npm left
// nested under expo/ (as the UI kit's tests do).
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

// A whole screen per test, over the stub network: more than Jest's default
// five seconds on a busy machine.
jest.setTimeout(30_000);

const bookingsPage = (rows: unknown[]) => Reply.ok({ data: rows, pagination: { nextCursor: null, hasMore: false, limit: 100 } });

const catalog = [
  testVenue(1, 'Sundhöllin', { at: north(400), reviews: 3 }),
  testVenue(2, 'Laugardalslaug', { at: north(2_000), reviews: 120 }),
  testVenue(3, 'Box800', { at: north(900), comingSoon: true, reviews: 900 }),
  testVenue(4, 'Sky Lagoon', { at: north(40_000), reviews: 300, extra: { inBundle: false, surchargePrice: 6990 } }),
  testVenue(5, 'Hressó', { at: north(30_000), reviews: 40, extra: { city: null, address: null, categories: ['hot yoga', 'pilates', 'barre'] } }),
  testVenue(6, 'Akureyrarlaug', { at: { latitude: 65.6835, longitude: -18.1105 }, reviews: 15, image: null }),
];

function serve(options: { venues?: unknown; bookings?: unknown[]; profile?: Record<string, unknown> } = {}) {
  api.on('GET', '/venues', options.venues === undefined ? Reply.ok(venuePage(catalog)) : (options.venues as never));
  api.on('GET', '/bookings', bookingsPage(options.bookings ?? []));
  api.on('GET', '/profile', Reply.ok(options.profile ?? profileJSON()));
}

let random: jest.SpyInstance;

/** Photos are decorative (hidden from TalkBack); their queries say so. */
const HIDDEN = { includeHiddenElements: true } as const;

/** Every host element on screen that `matches`. */
function hosts(matches: (props: Record<string, unknown>, type: unknown) => boolean) {
  const root = screen.root;
  if (!root) throw new Error('nothing rendered');
  return root.queryAll((node) => matches(node.props, node.type));
}

/** The URI a photo shows (expo-image takes a list of sources). */
function imageUri(node: { props: Record<string, unknown> }): string | undefined {
  const source = [node.props.source].flat()[0] as { uri?: string } | undefined;
  return source?.uri;
}

const heroUri = () => imageUri(screen.getByTestId('home.hero.image.image', HIDDEN));

beforeEach(() => {
  setTestFontScale(1);
  random = jest.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  random.mockRestore();
  restoreTestFontScale();
  leaveHome();
});

describe('the hero', () => {
  it('features a venue with its photo, the greeting with the first name, the weather and the upcoming card', async () => {
    freshHome({ fix: REYKJAVIK });
    serve();
    await renderHome();

    // The nearest bookable venue with a photo within 20 km of the fix.
    const hero = screen.getByTestId('home.hero');
    expect(imageUri(within(hero).getByTestId('home.hero.image.image', HIDDEN))).toBe('https://img.example/1.jpg');
    const greeting = translate(greetingKey(new Date().getHours()), 'en');
    expect(screen.getByTestId('home.greeting')).toHaveTextContent(`${greeting}, Anna.`);
    expect(within(screen.getByTestId('home.weather')).getByText('CLOUDY · 7° · SPA & HOT SPRING DAY')).toBeOnTheScreen();
    expect(screen.getByText('No upcoming bookings')).toBeOnTheScreen();
    expect(screen.getByText('Explore venues nearby')).toBeOnTheScreen();
    expect(screen.getByText('UPCOMING')).toBeOnTheScreen();
    // Home asked for location (the store only prompts while undecided).
    expect(requestLocation).toHaveBeenCalled();
  });

  it('never features a coming-soon venue, even the nearest one (the 2.5.2 device check)', async () => {
    freshHome({ fix: north(900) });
    serve();
    await renderHome();
    expect(heroUri()).toBe('https://img.example/1.jpg');
  });

  it('greets a member with no name as "there", never by their email', async () => {
    freshHome();
    serve({ profile: profileJSON({ fullName: null }) });
    await renderHome();
    const greeting = translate(greetingKey(new Date().getHours()), 'en');
    expect(screen.getByTestId('home.greeting')).toHaveTextContent(`${greeting}, there.`);
    expect(screen.queryByText(/member@example\.com/)).toBeNull();
  });

  it('hides the weather line when Open-Meteo fails', async () => {
    freshHome();
    weather(503);
    serve();
    await renderHome();
    expect(screen.getByTestId('home.hero')).toBeOnTheScreen();
    expect(screen.queryByTestId('home.weather')).toBeNull();
  });

  it('shows only the header while there are no venues: no greeting, weather or card', async () => {
    freshHome();
    serve({ venues: Reply.ok(venuePage([])) });
    await renderHome();
    expect(screen.getByTestId('home.headerOnly')).toBeOnTheScreen();
    expect(screen.queryByTestId('home.greeting')).toBeNull();
    expect(screen.queryByTestId('home.weather')).toBeNull();
    expect(screen.queryByTestId('home.upcoming')).toBeNull();
    // The Coach section needs no venues.
    expect(screen.getByTestId('home.coachInput')).toBeOnTheScreen();
  });

  it('shows the soonest pass with its visits left, and no chip without a pass', async () => {
    freshHome();
    serve({
      profile: profileJSON({
        usage: usageWith([
          { id: 'a1b2c3d4-0000-4000-8000-000000000001', visitsLeft: 5, expiresAt: '2026-12-01T00:00:00Z' },
          { id: 'a1b2c3d4-0000-4000-8000-000000000002', visitsLeft: 2, expiresAt: '2026-11-01T00:00:00Z' },
        ]),
      }),
    });
    await renderHome();
    expect(within(screen.getByTestId('home.passChip')).getByText('2 pass visits left')).toBeOnTheScreen();
  });

  it('a new tab visit rolls the hero again; coming back from a pushed page keeps it', async () => {
    freshHome();
    serve();
    random.mockReturnValue(0);
    await renderHome();
    const first = heroUri();

    random.mockReturnValue(0.99);
    // A page pushed on Home's stack, then back: the same visit.
    await fireEvent.press(screen.getByTestId('home.referral'));
    await settle();
    await act(async () => homeNavigation.goBack());
    await settle();
    expect(heroUri()).toBe(first);

    // Another tab, then Home again: a new visit. The next hero is rolled the
    // moment Home is left, so the tab opens on it (no swap after a frame).
    await act(async () => homeNavigation.navigate('Explore'));
    await settle();
    const rolled = heroUri();
    expect(rolled).not.toBe(first);
    await act(async () => homeNavigation.navigate('Home'));
    await settle();
    expect(heroUri()).toBe(rolled);
  });

  it('a modal over the tabs is not a new visit: closing it keeps the hero', async () => {
    // Real randomness here: React Navigation keys its navigators with
    // Math.random, and under one fixed value the root stack and Home's stack
    // would share a key (and navigation between them would fail). The rolls
    // are counted instead: a new visit is a pick with no current hero.
    random.mockRestore();
    const picks = jest.spyOn(heroRules, 'pickHero');
    const rolls = () => picks.mock.calls.filter(([, input]) => input.currentId === null).length;
    freshHome();
    serve();
    await renderHome({ underRoot: true });
    const first = heroUri();
    const rolledAtStart = rolls();

    // Plans, a shared sheet, the runner: a root modal blurs and refocuses the
    // Home tab, but the tab bar never leaves Home.
    await act(async () => homeNavigation.navigate('Sheet'));
    await settle();
    expect(screen.getByTestId('screen.Sheet')).toBeOnTheScreen();
    await act(async () => homeNavigation.goBack());
    await settle();
    expect(screen.queryByTestId('screen.Sheet')).toBeNull();
    expect(rolls()).toBe(rolledAtStart);
    expect(heroUri()).toBe(first);

    // Leaving the tab is still a new visit, rolled as Home is left.
    await act(async () => homeNavigation.navigate('Tabs', { screen: 'Explore' }));
    await settle();
    expect(rolls()).toBe(rolledAtStart + 1);
    await act(async () => homeNavigation.navigate('Tabs', { screen: 'Home' }));
    await settle();
    expect(rolls()).toBe(rolledAtStart + 1);
    picks.mockRestore();
  });
});

describe('the upcoming card', () => {
  it('shows the soonest booking with the hero photo, and View opens Profile on its bookings tab', async () => {
    freshHome({ fix: REYKJAVIK });
    const soon = new Date(Date.now() + 26 * 60 * 60 * 1000);
    serve({
      bookings: [
        bookingRow('b-later', new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toISOString(), 'Later Gym'),
        bookingRow('b-soon', soon.toISOString(), 'Vesturbæjarlaug'),
      ],
    });
    await renderHome();

    const card = screen.getByTestId('home.upcoming');
    expect(within(card).getByText('Vesturbæjarlaug')).toBeOnTheScreen();
    expect(imageUri(within(card).getByTestId('home.upcoming.thumbnail.image', HIDDEN))).toBe('https://img.example/1.jpg');
    expect(api.sent('/bookings').query).toEqual({ range: 'upcoming', limit: '100' });

    await fireEvent.press(screen.getByTestId('home.upcoming.view'));
    await settle();
    expect(screen.getByTestId('params.Profile')).toHaveTextContent(JSON.stringify({ initialTab: 'bookings' }));
    expect(analytics).toContainEqual(['profile_opened', { entry: 'home_upcoming' }]);
  });

  it('a class booking with a room shows it after the venue (API 0.44.0), on a second line if it needs one', async () => {
    freshHome();
    serve({
      bookings: [{ ...bookingRow('b-class', new Date(Date.now() + 26 * 3600 * 1000).toISOString(), 'Hress'), room: 'Salur 3' }],
    });
    await renderHome();
    const title = within(screen.getByTestId('home.upcoming')).getByTestId('home.upcoming.title');
    expect(title).toHaveTextContent('Hress · Salur 3', { exact: true });
    expect(title).toHaveProp('numberOfLines', 2);
  });

  it('with no booking, Explore asks for the Explore tab', async () => {
    freshHome();
    serve();
    await renderHome();
    await fireEvent.press(screen.getByTestId('home.upcoming.explore'));
    expect(useIntentStore.getState().pendingTab).toBe('Explore');
  });

  it('returning to Home shows a booking made meanwhile, without a restart', async () => {
    freshHome();
    serve();
    await renderHome();
    expect(screen.getByText('No upcoming bookings')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('home.referral'));
    await settle();
    api.on('GET', '/bookings', bookingsPage([bookingRow('b-new', new Date(Date.now() + 3 * 864e5).toISOString(), 'Sky Lagoon')]));
    await act(async () => homeNavigation.goBack());
    await settle();
    expect(within(screen.getByTestId('home.upcoming')).getByText('Sky Lagoon')).toBeOnTheScreen();
  });
});

describe('the avatar and the one-time Profile pointer', () => {
  it('the avatar says it opens Profile, and lands on its bookings tab (testTheHomeAvatarSaysItOpensProfile)', async () => {
    freshHome();
    serve();
    await renderHome();
    const avatar = screen.getByRole('button', { name: 'Open profile: bookings and saved' });
    expect(within(avatar).getByText('A')).toBeOnTheScreen();
    await fireEvent.press(avatar);
    await settle();
    expect(screen.getByTestId('params.Profile')).toHaveTextContent(JSON.stringify({ initialTab: 'bookings' }));
    expect(analytics).toContainEqual(['profile_opened', { entry: 'home_avatar' }]);
  });

  it('the header-only person button opens Profile too, with the same label', async () => {
    freshHome();
    serve({ venues: Reply.ok(venuePage([])) });
    await renderHome();
    await fireEvent.press(screen.getByRole('button', { name: 'Open profile: bookings and saved' }));
    await settle();
    expect(screen.getByTestId('screen.Profile')).toBeOnTheScreen();
  });

  it('a fresh install never sees the pointer', async () => {
    freshHome();
    serve();
    await renderHome();
    expect(screen.queryByTestId('home.profileMovedHint')).toBeNull();
  });

  it('an upgraded install sees it once per member; a tap retires it for good', async () => {
    await AsyncStorage.setItem(UPGRADED_FROM_PROFILE_TAB_KEY, 'true');
    freshHome();
    serve();
    await renderHome();
    const hint = screen.getByTestId('home.profileMovedHint');
    expect(hint).toHaveTextContent('Your bookings and saved places are here now.');

    await fireEvent.press(hint);
    await settle();
    expect(screen.queryByTestId('home.profileMovedHint')).toBeNull();
    expect(await AsyncStorage.getItem(profileOpenedKey(MEMBER))).toBe('true');
    expect(analytics).toContainEqual(['profile_hint_dismissed', { entry: 'home_callout' }]);
  });

  it('opening Profile from the avatar retires the pointer too', async () => {
    await AsyncStorage.setItem(UPGRADED_FROM_PROFILE_TAB_KEY, 'true');
    freshHome();
    serve();
    await renderHome();
    expect(screen.getByTestId('home.profileMovedHint')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('home.avatar'));
    await settle();
    await act(async () => homeNavigation.goBack());
    await settle();
    expect(screen.queryByTestId('home.profileMovedHint')).toBeNull();
    expect(await AsyncStorage.getItem(profileOpenedKey(MEMBER))).toBe('true');
  });
});

describe('the Coach hand-off', () => {
  it('every card and chip parks its iOS prompt and asks for the Coach tab; two taps are two sends', async () => {
    freshHome();
    serve();
    await renderHome();
    const parked: string[] = [];
    const take = () => {
      const intents = useIntentStore.getState();
      expect(intents.pendingTab).toBe('Coach');
      intents.clearPendingTab();
      parked.push(intents.takeCoachPrompt() ?? '<none>');
    };

    await fireEvent.press(screen.getByTestId('home.chip.coach.chip.lagoon'));
    take();
    await fireEvent.press(screen.getByTestId('home.chip.coach.chip.lagoon'));
    take();
    await fireEvent.press(screen.getByTestId('home.category.gyms'));
    take();
    expect(parked).toEqual([HOME_ASK_CHIPS[0]!.prompt, HOME_ASK_CHIPS[0]!.prompt, HOME_COACH_CATEGORIES[1]!.prompt]);
  });

  it('Return sends the trimmed question and puts the keyboard away first; Return on nothing only closes it', async () => {
    freshHome();
    serve();
    await renderHome();
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const input = screen.getByTestId('home.coachInput');

    await fireEvent(input, 'submitEditing');
    expect(useIntentStore.getState().pendingCoachPrompt).toBeNull();

    await fireEvent.changeText(input, '  quiet swim near work ');
    expect(screen.getByTestId('home.coachInput.send')).toBeOnTheScreen();
    await fireEvent(input, 'submitEditing');
    expect(useIntentStore.getState().pendingCoachPrompt).toBe('quiet swim near work');
    expect(useIntentStore.getState().pendingTab).toBe('Coach');
    expect(dismiss).toHaveBeenCalled();
    expect(screen.getByTestId('home.coachInput').props.value).toBe('');
    expect(screen.queryByTestId('home.coachInput.send')).toBeNull();
    dismiss.mockRestore();
  });

  it('a new line typed at the end sends; pasted lines become spaces', async () => {
    freshHome();
    serve();
    await renderHome();
    const input = screen.getByTestId('home.coachInput');
    await fireEvent.changeText(input, 'a quiet\nswim');
    expect(screen.getByTestId('home.coachInput').props.value).toBe('a quiet swim');
    await fireEvent.changeText(screen.getByTestId('home.coachInput'), 'yoga tonight\n');
    expect(useIntentStore.getState().pendingCoachPrompt).toBe('yoga tonight');
  });

  it('the field is set up so Return sends and never adds a line, and the page lets the keyboard go', async () => {
    freshHome();
    serve();
    await renderHome();
    const input = screen.getByTestId('home.coachInput');
    expect(input.props.submitBehavior).toBe('blurAndSubmit');
    expect(input.props.returnKeyType).toBe('send');
    expect(input.props.placeholder).toBe('Find me a quiet 45-minute swim near work…');
    const scroll = screen.getByTestId('home.scroll');
    expect(scroll.props.keyboardDismissMode).toBe('on-drag');
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
  });

  it('the field grows to three lines at every text size (iOS .lineLimit(1...3) follows Dynamic Type)', async () => {
    const maxHeight = () => (StyleSheet.flatten(screen.getByTestId('home.coachInput').props.style) as { maxHeight: number }).maxHeight;
    const view = await render(<TryNewSection onPrompt={() => undefined} />);
    expect(maxHeight()).toBe(60);
    await act(async () => setTestFontScale(2));
    view.rerender(<TryNewSection onPrompt={() => undefined} />);
    expect(maxHeight()).toBe(120);
  });
});

describe('the keyboard leaves on a tap outside the field', () => {
  it('a touch that starts in the field row (the field or its send button) is the member placing the cursor', async () => {
    const ref = { current: null as TryNewSectionHandle | null };
    await render(<TryNewSection ref={ref} onPrompt={() => undefined} />);
    await fireEvent(screen.getByTestId('home.coachInput.row'), 'touchStart', {});
    expect(ref.current!.touchStartedInInput()).toBe(true);
    // Read once: the next touch starts outside unless the row says otherwise.
    expect(ref.current!.touchStartedInInput()).toBe(false);
  });

  it('Home puts the keyboard away on a touch outside the field while it has focus, and only then', async () => {
    freshHome();
    serve();
    await renderHome();
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    // The mocked TextInput answers `isFocused` from its prototype.
    const focused = jest.spyOn(TextInput.prototype as unknown as { isFocused(): boolean }, 'isFocused').mockReturnValue(true);
    const page = screen.getByTestId('home.content');

    // A touch inside the field's row reaches the row first, then the page.
    await fireEvent(screen.getByTestId('home.coachInput.row'), 'touchStart', {});
    await fireEvent(page, 'touchStart', {});
    expect(dismiss).not.toHaveBeenCalled();

    // A touch anywhere else, with the field focused: the keyboard goes.
    await fireEvent(page, 'touchStart', {});
    expect(dismiss).toHaveBeenCalledTimes(1);

    // Without focus there is nothing to put away.
    focused.mockReturnValue(false);
    await fireEvent(page, 'touchStart', {});
    expect(dismiss).toHaveBeenCalledTimes(1);
    focused.mockRestore();
    dismiss.mockRestore();
  });
});

describe('the keyboard never covers the ask field (edge to edge: the window does not shrink)', () => {
  type Measure = (callback: (x: number, y: number, width: number, height: number) => void) => void;
  const keyboardUp = { endCoordinates: { screenX: 0, screenY: 500, width: 360, height: 300 } };
  let focused: jest.SpyInstance;
  let measure: jest.SpyInstance;
  let scrollTo: jest.SpyInstance;

  beforeEach(() => {
    focused = jest.spyOn(TextInput.prototype as unknown as { isFocused(): boolean }, 'isFocused').mockReturnValue(true);
    // The field's row, measured on screen: its top at 700 dp, 44 dp tall.
    measure = jest
      .spyOn(View.prototype as unknown as { measureInWindow: Measure }, 'measureInWindow')
      .mockImplementation((callback) => callback(24, 700, 312, 44));
    scrollTo = jest.spyOn(ScrollView.prototype as unknown as { scrollTo(options: object): void }, 'scrollTo');
  });

  afterEach(() => {
    focused.mockRestore();
    measure.mockRestore();
    scrollTo.mockRestore();
  });

  const room = () => StyleSheet.flatten(screen.getByTestId('home.keyboardRoom').props.style) as { height: number };

  it('with the field focused, the page makes room for the keyboard, then scrolls the field above it', async () => {
    freshHome();
    serve();
    await renderHome();
    const page = screen.getByTestId('home.scroll');
    expect(room().height).toBe(0);
    await fireEvent.scroll(page, { nativeEvent: { contentOffset: { x: 0, y: 120 } } });

    await act(async () => {
      DeviceEventEmitter.emit('keyboardDidShow', keyboardUp);
    });
    expect(room().height).toBe(300);
    // Not before the room is laid out: a scroll then would stop at the old end.
    expect(scrollTo).not.toHaveBeenCalled();

    await fireEvent(page, 'contentSizeChange', 360, 2400);
    // The row ends at 744; 16 dp above the keyboard's top (500) is 484: up 260.
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y: 120 + 260, animated: true });

    await act(async () => {
      DeviceEventEmitter.emit('keyboardDidHide', { endCoordinates: { screenX: 0, screenY: 800, width: 360, height: 0 } });
    });
    expect(room().height).toBe(0);
  });

  it('a field already clear of the keyboard stays where it is', async () => {
    measure.mockImplementation((callback: Parameters<Measure>[0]) => callback(24, 300, 312, 44));
    freshHome();
    serve();
    await renderHome();
    await act(async () => {
      DeviceEventEmitter.emit('keyboardDidShow', keyboardUp);
    });
    await fireEvent(screen.getByTestId('home.scroll'), 'contentSizeChange', 360, 2400);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("another screen's keyboard leaves Home alone", async () => {
    focused.mockReturnValue(false);
    freshHome();
    serve();
    await renderHome();
    await act(async () => {
      DeviceEventEmitter.emit('keyboardDidShow', keyboardUp);
    });
    expect(room().height).toBe(0);
    await fireEvent(screen.getByTestId('home.scroll'), 'contentSizeChange', 360, 2400);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe('the referral card and the shelves', () => {
  it('the referral card is on Home and opens Account (testTheReferralCardIsStillOnHome)', async () => {
    freshHome();
    serve();
    await renderHome();
    expect(screen.getByText('Refer a friend, get a free visit')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('home.referral'));
    await settle();
    expect(screen.getByTestId('screen.Account')).toBeOnTheScreen();
  });

  it('Nearby lists what is within 5 km (not the hero, coming soon last) and never prints a distance', async () => {
    freshHome({ fix: REYKJAVIK });
    serve();
    await renderHome();
    const nearby = screen.getByTestId('home.nearby');
    expect(within(nearby).getByText('A short walk from here')).toBeOnTheScreen();
    // Hero is venue 1 (nearest with a photo); Nearby: Laugardalslaug, then Box800 (coming soon) last.
    const names = within(nearby)
      .getAllByRole('button')
      .map((button) => button.props.testID as string)
      .filter((id) => id?.startsWith('home.nearby.venue'));
    expect(names).toEqual(['home.nearby.venue-2', 'home.nearby.venue-3']);
    expect(within(nearby).queryByText(/\d\s?(m|km)\b/)).toBeNull();
  });

  it('All opens Explore; a card opens the venue by its slug', async () => {
    freshHome({ fix: REYKJAVIK });
    serve();
    await renderHome();
    await fireEvent.press(screen.getByTestId('home.nearby.all'));
    expect(useIntentStore.getState().pendingTab).toBe('Explore');
    await fireEvent.press(screen.getByTestId('home.nearby.venue-2'));
    await settle();
    expect(screen.getByTestId('params.VenueDetail')).toHaveTextContent(JSON.stringify({ slug: 'venue-2' }));
  });

  it('Popular ranks the rest by reviews with the price where the heart was, and Home reads no favourites', async () => {
    freshHome({ fix: REYKJAVIK });
    serve();
    await renderHome();
    const popular = screen.getByTestId('home.popular');
    const rows = within(popular)
      .getAllByRole('button')
      .map((button) => button.props.testID as string);
    expect(rows).toEqual(['home.popular.venue-4', 'home.popular.venue-5', 'home.popular.venue-6']);
    expect(within(popular).getByText('from ISK 6,990')).toBeOnTheScreen();
    expect(within(popular).getAllByText('Included').length).toBe(2);
    // City, else address, else "Iceland"; categories capitalised, two at most.
    expect(within(popular).getAllByText('Iceland')).toHaveLength(3);
    expect(within(popular).getByText('Hot Yoga')).toBeOnTheScreen();
    expect(within(popular).queryByText('Barre')).toBeNull();
    expect(api.requests.some((request) => request.path.startsWith('/favourites'))).toBe(false);
  });

  it('no picsum anywhere: a venue without a photo draws the placeholder', async () => {
    freshHome({ fix: REYKJAVIK });
    serve();
    await renderHome();
    const uris = hosts((props) => props.source !== undefined).map(imageUri);
    expect(uris.length).toBeGreaterThan(0);
    expect(uris.filter((uri) => uri?.includes('picsum'))).toEqual([]);
    // Akureyrarlaug has no photo: its row draws the placeholder, not a picture.
    const row = screen.getByTestId('home.popular.venue-6');
    expect(within(row).getByTestId('venueImage.placeholder', HIDDEN)).toBeOnTheScreen();
    expect(within(row).queryByTestId('venueImage.image', HIDDEN)).toBeNull();
  });
});

describe('loading, errors and refresh (VenueLoadErrorTests on Home)', () => {
  it('a 502 shows the Icelandic error with Try again, and a retry that works clears it', async () => {
    freshHome();
    serve({ venues: Reply.raw(502, '<html>Bad gateway</html>'), profile: profileJSON({ locale: 'is' }) });
    await renderHome();
    const error = screen.getByTestId('home.venues.error');
    expect(within(error).getByText('Ekki tókst að sækja staðina. Athugaðu nettenginguna og reyndu aftur.')).toBeOnTheScreen();
    expect(screen.getByTestId('home.headerOnly')).toBeOnTheScreen();

    api.on('GET', '/venues', Reply.ok(venuePage(catalog)));
    await fireEvent.press(within(error).getByRole('button', { name: 'Reyna aftur' }));
    await settle();
    expect(screen.queryByTestId('home.venues.error')).toBeNull();
    expect(screen.getByTestId('home.hero')).toBeOnTheScreen();
  });

  it('shows the spinner, not the error, while the first load is on the way', async () => {
    freshHome();
    serve();
    let answer: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    api.on('GET', '/venues', async () => {
      await answered;
      return Reply.ok(venuePage(catalog));
    });
    await renderHome();
    expect(screen.getByTestId('home.venues.loading')).toBeOnTheScreen();
    expect(screen.queryByTestId('home.venues.error')).toBeNull();

    answer();
    await settle();
    expect(screen.queryByTestId('home.venues.loading')).toBeNull();
    expect(screen.getByTestId('home.hero')).toBeOnTheScreen();
  });

  it('pull to refresh reads the venues, the bookings and the profile again, and the hero holds still', async () => {
    freshHome();
    serve();
    await renderHome();
    const hero = heroUri();
    const count = (path: string) => api.sentAll(path).length;
    const before = { venues: count('/venues'), bookings: count('/bookings'), profile: count('/profile') };

    random.mockReturnValue(0.99);
    // The scroll view holds the RefreshControl element Home gave it.
    const refresh = screen.getByTestId('home.scroll').props.refreshControl as { props: { onRefresh: () => Promise<void> } };
    await act(async () => {
      await refresh.props.onRefresh();
    });
    await settle();
    expect(count('/venues')).toBe(before.venues + 1);
    expect(count('/bookings')).toBe(before.bookings + 1);
    expect(count('/profile')).toBe(before.profile + 1);
    expect(heroUri()).toBe(hero);
  });
});

describe('an Icelandic account', () => {
  it('reads Home in Icelandic, except the weather line (D7)', async () => {
    freshHome();
    serve({ profile: profileJSON({ locale: 'is' }) });
    await renderHome();
    expect(screen.getByText('Stutt ganga héðan')).toBeOnTheScreen();
    expect(screen.getByText('Vinsælast núna')).toBeOnTheScreen();
    expect(screen.getByText('Bjóddu vini, fáðu fría heimsókn')).toBeOnTheScreen();
    expect(screen.getByText('Engar bókanir fram undan')).toBeOnTheScreen();
    expect(screen.getByText('FRAM UNDAN')).toBeOnTheScreen();
    expect(screen.getByText('Laugaáhugamaður')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Opna prófíl: bókanir og vistað' })).toBeOnTheScreen();
    expect(screen.getByTestId('home.coachInput').props.placeholder).toBe('Finndu rólega 45 mínútna sundferð nálægt vinnunni…');
    expect(within(screen.getByTestId('home.weather')).getByText('CLOUDY · 7° · SPA & HOT SPRING DAY')).toBeOnTheScreen();
  });
});
