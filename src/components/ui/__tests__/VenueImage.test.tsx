/**
 * Venue photos (iOS VenueImageView / CachedImage, home-venue-imagery):
 * three attempts with back-off, then the ink3 placeholder, and never a
 * substitute picture.
 */
import { act, fireEvent, isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';

import { normaliseImageUrl } from '../imageUrl';
import VenueImage, { IMAGE_ATTEMPTS, imageRetryDelayMs } from '../VenueImage';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const URL = 'https://abc.supabase.co/storage/v1/object/public/venues/laugar.jpg';

const image = () => screen.queryByTestId('photo.image', { includeHiddenElements: true });
const placeholder = () => screen.queryByTestId('photo.placeholder', { includeHiddenElements: true });

async function fail() {
  await fireEvent(image()!, 'error', { nativeEvent: { error: 'HTTP 502' } });
}

describe('retries', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('tries twice more after a failure, then shows the placeholder for good', async () => {
    await render(<VenueImage uri={URL} height={180} testID="photo" />);
    const sources: unknown[] = [];

    for (let attempt = 0; attempt < IMAGE_ATTEMPTS; attempt += 1) {
      expect(image()).not.toBeNull();
      sources.push(image()!.props.source);
      await fail();
      if (attempt < IMAGE_ATTEMPTS - 1) {
        // Waiting out the back-off: the placeholder shows, no image is loading.
        expect(image()).toBeNull();
        expect(placeholder()).not.toBeNull();
        await act(async () => {
          jest.advanceTimersByTime(imageRetryDelayMs(attempt));
        });
      }
    }

    expect(sources).toHaveLength(3);
    expect(image()).toBeNull();
    expect(placeholder()).not.toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(image()).toBeNull();
  });

  it('backs off 0.6 s, then 1.2 s, as iOS', () => {
    expect(imageRetryDelayMs(0)).toBe(600);
    expect(imageRetryDelayMs(1)).toBe(1200);
  });

  it('a loaded image drops the placeholder', async () => {
    await render(<VenueImage uri={URL} height={180} testID="photo" />);
    expect(placeholder()).not.toBeNull();
    await fireEvent(image()!, 'load', { nativeEvent: { source: { url: URL, width: 10, height: 10 } } });
    expect(placeholder()).toBeNull();
  });

  it('a new URL starts again from the first attempt', async () => {
    const view = await render(<VenueImage uri={URL} height={180} testID="photo" />);
    await fail();
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    await fail();
    await view.rerender(<VenueImage uri={`${URL}?v=2`} height={180} testID="photo" />);
    expect(image()).not.toBeNull();
    expect(image()!.props.source).toEqual([expect.objectContaining({ uri: `${URL}?v=2` })]);
  });
});

it('caches in memory and on disk', async () => {
  await render(<VenueImage uri={URL} height={180} testID="photo" />);
  expect(image()).toHaveProp('cachePolicy', 'memory-disk');
});

it('with no URL draws the placeholder, never a stand-in picture', async () => {
  await render(<VenueImage uri={null} height={180} testID="photo" />);
  expect(image()).toBeNull();
  expect(placeholder()).not.toBeNull();
  await render(<VenueImage uri="   " height={180} testID="photo" />);
  expect(image()).toBeNull();
});

it('is decoration to TalkBack unless it is given a name', async () => {
  await render(<VenueImage uri={URL} height={180} testID="photo" />);
  expect(isHiddenFromAccessibility(screen.getByTestId('photo', { includeHiddenElements: true }))).toBe(true);
  await render(<VenueImage uri={URL} height={180} testID="named" accessibilityLabel="Laugar" />);
  expect(screen.getByRole('image', { name: 'Laugar' })).toBeOnTheScreen();
});

describe('normaliseImageUrl (iOS VenueImageView.parseURL)', () => {
  it('keeps a good https URL as it is', () => {
    expect(normaliseImageUrl(URL)).toBe(URL);
    expect(normaliseImageUrl(`  ${URL}  `)).toBe(URL);
  });

  it('percent-encodes spaces and Icelandic letters, without double-encoding', () => {
    expect(normaliseImageUrl('https://x.supabase.co/venues/Sundhöll Reykjavíkur.jpg')).toBe(
      'https://x.supabase.co/venues/Sundh%C3%B6ll%20Reykjav%C3%ADkur.jpg',
    );
    expect(normaliseImageUrl('https://x.co/a%20b.jpg')).toBe('https://x.co/a%20b.jpg');
  });

  it('refuses anything that is not an http(s) URL with a host', () => {
    expect(normaliseImageUrl(undefined)).toBeNull();
    expect(normaliseImageUrl('')).toBeNull();
    expect(normaliseImageUrl('/storage/x.jpg')).toBeNull();
    expect(normaliseImageUrl('file:///data/x.jpg')).toBeNull();
    expect(normaliseImageUrl('data:image/png;base64,AAAA')).toBeNull();
    expect(normaliseImageUrl('https://')).toBeNull();
  });
});
