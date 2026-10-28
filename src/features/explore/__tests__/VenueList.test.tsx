/**
 * Explore's list: the cards glide to a new order only when the visit changes
 * it, and only while the list is on screen. The glide is set up app-wide for
 * the next layout, so a list left mounted behind another tab must not set it
 * up for that tab's screen (iOS animates only this list's stack).
 */
import { act, render } from '@testing-library/react-native';
import { LayoutAnimation } from 'react-native';

import { decodeVenue } from '../../../api/venues';
import { createBrowseSession } from '../../../stores/browseSession';
import VenueList from '../VenueList';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-video', () => {
  const { View: MockView } = require('react-native');
  return {
    useVideoPlayer: () => ({ play: jest.fn(), pause: jest.fn(), loop: false, muted: false }),
    VideoView: (props: object) => <MockView {...props} />,
  };
});
/* eslint-enable @typescript-eslint/no-require-imports */

const venues = [
  decodeVenue({ id: '00000000-0000-4000-8000-000000000001', slug: 'v1', name: 'Laugar', inBundle: true, city: 'Reykjavík' }),
];

afterEach(() => jest.restoreAllMocks());

it('glides on a new visit order while on screen, and never while Explore is off screen', async () => {
  const configureNext = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => undefined);
  const session = createBrowseSession({ seed: 1 });
  const view = await render(
    <VenueList venues={venues} session={session} onOpenVenue={() => undefined} visible bottomInset={0} />,
  );

  await act(async () => session.setState({ revision: session.getState().revision + 1 }));
  expect(configureNext).toHaveBeenCalledTimes(1);

  // Another tab is showing: the next layout is that tab's, not this list's.
  await view.rerender(
    <VenueList venues={venues} session={session} onOpenVenue={() => undefined} visible={false} bottomInset={0} />,
  );
  await act(async () => session.setState({ revision: session.getState().revision + 1 }));
  expect(configureNext).toHaveBeenCalledTimes(1);

  // A filter or a search changes the venues, not the visit: no glide.
  await view.rerender(<VenueList venues={[]} session={session} onOpenVenue={() => undefined} visible bottomInset={0} />);
  expect(configureNext).toHaveBeenCalledTimes(1);
});
