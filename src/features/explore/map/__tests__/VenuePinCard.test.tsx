/**
 * The pinned venue's card coming and going (iOS SearchMapView: `.transition(
 * .move(edge: .bottom).combined(with: .opacity))` under `.easeOut(duration:
 * 0.18)`, none under Reduce Motion): it moves up its own height and fades in
 * once it has laid out, and leaves the same way, taking no touches and
 * hidden from TalkBack while it goes, then says it has gone.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Animated } from 'react-native';

import { decodeVenue } from '../../../../api/venues';
import { setCurrentLanguage } from '../../../../i18n';
import { classifyVenue } from '../../../../lib/venueMarkerType';
import VenuePinCard, { CARD_TRANSITION_MS, type VenuePinCardProps } from '../VenuePinCard';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const laugar = decodeVenue({
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'laugar',
  name: 'World Class Laugar',
  inBundle: true,
  city: 'Reykjavík',
  category: 'gym',
  offerings: ['gym-floor', 'pool'],
  coordinates: { latitude: 64.14, longitude: -21.88 },
});

let onHidden: jest.Mock;

function props(overrides: Partial<VenuePinCardProps> = {}): VenuePinCardProps {
  return {
    venue: laugar,
    ring: classifyVenue(laugar),
    visible: true,
    onHidden,
    showsTapAgain: true,
    onOpen: jest.fn(),
    onClose: jest.fn(),
    onHeight: jest.fn(),
    bottom: 144,
    reduceMotion: false,
    ...overrides,
  };
}

function card() {
  return screen.getByTestId('explore.venueCard', { includeHiddenElements: true });
}

/** The card's opacity and slide as drawn now. */
function motion() {
  const style = [card().props.style].flat(Infinity) as Record<string, unknown>[];
  const merged = Object.assign({}, ...style.filter(Boolean)) as { opacity?: number; transform?: { translateY: number }[] };
  return { opacity: merged.opacity, translateY: merged.transform?.[0]?.translateY };
}

async function layOut(height: number) {
  await fireEvent(card(), 'layout', { nativeEvent: { layout: { x: 20, y: 0, width: 350, height } } });
}

async function run(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  setCurrentLanguage('en');
  onHidden = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the card coming and going', () => {
  it('waits for its height, then moves up that far and fades in over 0.18 s', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    await render(<VenuePinCard {...props()} />);
    // Drawn clear until it knows how far to come.
    expect(motion().opacity).toBe(0);
    expect(timing).not.toHaveBeenCalled();
    await layOut(140);
    expect(motion()).toEqual({ opacity: 0, translateY: 140 });
    expect(timing).toHaveBeenCalledTimes(1);
    expect(timing.mock.calls[0][1]).toMatchObject({ toValue: 1, duration: CARD_TRANSITION_MS });
    await run(CARD_TRANSITION_MS + 50);
    expect(screen.getByTestId('explore.venueCard')).toBeTruthy();
    expect(card().props.pointerEvents).toBe('box-none');
    timing.mockRestore();
  });

  it('leaves the same way, untouchable and unread on the way, then says it has gone', async () => {
    const view = await render(<VenuePinCard {...props()} />);
    await layOut(140);
    await run(CARD_TRANSITION_MS + 50);

    await view.rerender(<VenuePinCard {...props({ visible: false })} />);
    // Still drawn while it goes, but no touch lands on it and TalkBack skips it.
    expect(card().props.pointerEvents).toBe('none');
    expect(screen.queryByTestId('explore.venueCard')).toBeNull();
    expect(onHidden).not.toHaveBeenCalled();

    await run(CARD_TRANSITION_MS + 50);
    expect(onHidden).toHaveBeenCalledTimes(1);
  });

  it('pinned again on its way out, it comes back and is not dropped', async () => {
    const view = await render(<VenuePinCard {...props()} />);
    await layOut(140);
    await run(CARD_TRANSITION_MS + 50);
    await view.rerender(<VenuePinCard {...props({ visible: false })} />);
    // Jest's stand-in for the native driver ends an animation after 16 ms:
    // pinned again before that, the exit is cut short.
    await run(8);
    await view.rerender(<VenuePinCard {...props({ visible: true })} />);
    await run(CARD_TRANSITION_MS + 50);
    expect(onHidden).not.toHaveBeenCalled();
    expect(card().props.pointerEvents).toBe('box-none');
    expect(screen.getByTestId('explore.venueCard')).toBeTruthy();
  });

  it('under Remove animations it simply appears and goes', async () => {
    const view = await render(<VenuePinCard {...props({ reduceMotion: true })} />);
    expect(motion().opacity).toBe(1);
    await view.rerender(<VenuePinCard {...props({ reduceMotion: true, visible: false })} />);
    expect(onHidden).toHaveBeenCalledTimes(1);
  });
});
