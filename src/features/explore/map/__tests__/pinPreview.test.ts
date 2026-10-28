/**
 * The Explore map's two-tap rule (2.5.5) and the reveal of a pin pinned under
 * its own card: a port of iOS VenuePinPreviewTests, case for case. "Is this
 * the first tap or the second" is the part that breaks quietly, so it is the
 * part a test holds still.
 */
import {
  deliversMapTap,
  INITIAL_PIN_PREVIEW,
  MAP_TAP_HOLD_MS,
  MAP_TAP_WINDOW_MS,
  samePinPreview,
  sendPinPreview,
  type PinPreviewEvent,
  type PinPreviewState,
} from '../pinPreview';
import { revealMove, venueNameHeight, type RevealMove } from '../pinReveal';

const laugar = '85518840-c029-411c-aef2-53d2d18d9249';
const sky = '7079e498-fdbd-4888-b926-2a2c7ef796ca';

/** A mutable preview, as iOS's `var preview = VenuePinPreview()`. */
function preview() {
  let state: PinPreviewState = INITIAL_PIN_PREVIEW;
  return {
    send(event: PinPreviewEvent, at = 0) {
      const result = sendPinPreview(state, event, at);
      state = result.state;
      return result.effect;
    },
    get pinnedId() {
      return state.pinnedId;
    },
  };
}

const pinTap = (id: string): PinPreviewEvent => ({ kind: 'pinTap', id });
const visible = (...ids: string[]): PinPreviewEvent => ({ kind: 'visibleChanged', ids: new Set(ids) });

describe('the two-tap rule', () => {
  it('the first tap pins and the second opens', () => {
    const p = preview();
    expect(p.send(pinTap(laugar))).toBeNull(); // a first tap never opens
    expect(p.pinnedId).toBe(laugar);
    expect(p.send(pinTap(laugar))).toEqual({ open: laugar });
    expect(p.pinnedId).toBeNull(); // coming back from the venue finds a clear map
  });

  it('another pin moves the card and does not open', () => {
    const p = preview();
    p.send(pinTap(laugar));
    expect(p.send(pinTap(sky))).toBeNull();
    expect(p.pinnedId).toBe(sky);
    // And the moved card's own second tap opens its venue, not the first.
    expect(p.send(pinTap(sky))).toEqual({ open: sky });
  });

  it('a tap on the card opens', () => {
    const p = preview();
    expect(p.send({ kind: 'cardTap' })).toBeNull(); // no card, nothing to open
    p.send(pinTap(laugar));
    expect(p.send({ kind: 'cardTap' })).toEqual({ open: laugar });
    expect(p.pinnedId).toBeNull();
  });

  it.each<PinPreviewEvent>([{ kind: 'mapTap' }, { kind: 'close' }, { kind: 'sightOpened' }])(
    'the map, the close button and a sight close the card ($kind)',
    (event) => {
      const t0 = 1_000_000;
      const p = preview();
      p.send(pinTap(laugar), t0);
      expect(p.send(event, t0 + 2_000)).toBeNull();
      expect(p.pinnedId).toBeNull();
      // And the next tap on the same pin, a moment later, is a first tap again.
      expect(p.send(pinTap(laugar), t0 + 3_000)).toBeNull();
      expect(p.pinnedId).toBe(laugar);
    },
  );

  it('a filter that hides the pinned venue closes its card', () => {
    const p = preview();
    p.send(pinTap(laugar));
    p.send(visible(laugar, sky));
    expect(p.pinnedId).toBe(laugar); // still on the map: the card stays
    p.send(visible(sky));
    expect(p.pinnedId).toBeNull();
  });

  it('an assistive activation (TalkBack) opens at once', () => {
    const p = preview();
    expect(p.send({ kind: 'assistiveActivate', id: laugar })).toEqual({ open: laugar });
    expect(p.pinnedId).toBeNull();
  });
});

describe('one touch reaching the pin and the map', () => {
  it('a map tap on the pin’s touch is ignored; one on open map a moment later is not', () => {
    const pin = 1_000_000;
    expect(deliversMapTap(pin, pin)).toBe(false);
    expect(deliversMapTap(pin + 50, pin)).toBe(false);
    expect(deliversMapTap(pin - 50, pin)).toBe(false);
    expect(deliversMapTap(pin + 1_000, pin)).toBe(true);
    expect(deliversMapTap(pin, null)).toBe(true);
    expect(MAP_TAP_WINDOW_MS).toBe(350);
    expect(MAP_TAP_HOLD_MS).toBe(80);
  });

  it('a second tap whose map tap lands first still opens', () => {
    const t0 = 1_000_000;
    const p = preview();
    p.send(pinTap(laugar), t0);
    // The second touch: the map's handler first, the pin's 200 ms later.
    const touch = t0 + 3_000;
    expect(p.send({ kind: 'mapTap' }, touch)).toBeNull();
    expect(p.pinnedId).toBeNull(); // the map tap went through
    expect(p.send(pinTap(laugar), touch + 200)).toEqual({ open: laugar });
    expect(p.pinnedId).toBeNull();
  });

  it.each([
    [330, true],
    [370, false],
    [1_000, false],
  ])('a pin tap %i ms after the map tap opens: %s', (late, opens) => {
    const t0 = 1_000_000;
    const touch = t0 + 3_000;
    const p = preview();
    p.send(pinTap(laugar), t0);
    p.send({ kind: 'mapTap' }, touch);
    expect(p.send(pinTap(laugar), touch + late)).toEqual(opens ? { open: laugar } : null);
    expect(p.pinnedId).toBe(opens ? null : laugar);
  });

  it('only the pin the map tap closed counts as a second tap', () => {
    const t0 = 1_000_000;
    const touch = t0 + 3_000;
    const late = touch + 200;

    const other = preview();
    other.send(pinTap(laugar), t0);
    other.send({ kind: 'mapTap' }, touch);
    expect(other.send(pinTap(sky), late)).toBeNull();
    expect(other.pinnedId).toBe(sky);

    const nothingPinned = preview();
    nothingPinned.send({ kind: 'mapTap' }, touch);
    expect(nothingPinned.send(pinTap(laugar), late)).toBeNull(); // a first tap is a first tap
    expect(nothingPinned.pinnedId).toBe(laugar);

    const closeButton = preview();
    closeButton.send(pinTap(laugar), t0);
    closeButton.send({ kind: 'close' }, touch);
    expect(closeButton.send(pinTap(laugar), late)).toBeNull();
    expect(closeButton.pinnedId).toBe(laugar);

    const inBetween = preview();
    inBetween.send(pinTap(laugar), t0);
    inBetween.send({ kind: 'mapTap' }, touch);
    inBetween.send({ kind: 'sightOpened' }, touch + 100);
    expect(inBetween.send(pinTap(laugar), late)).toBeNull();

    // The pin's venue filtered off the map in between: nothing to open.
    const filtered = preview();
    filtered.send(pinTap(laugar), t0);
    filtered.send({ kind: 'mapTap' }, touch);
    filtered.send(visible(sky), touch + 100);
    expect(filtered.send(pinTap(laugar), late)).toBeNull();

    // A visible-set update that keeps the venue is not a tap, and leaves the touch whole.
    const kept = preview();
    kept.send(pinTap(laugar), t0);
    kept.send({ kind: 'mapTap' }, touch);
    kept.send(visible(laugar, sky), touch + 100);
    expect(kept.send(pinTap(laugar), late)).toEqual({ open: laugar });
  });

  it('tells a change apart from a repeat', () => {
    const a = sendPinPreview(INITIAL_PIN_PREVIEW, pinTap(laugar), 1).state;
    const b = sendPinPreview(INITIAL_PIN_PREVIEW, pinTap(laugar), 2).state;
    expect(samePinPreview(a, b)).toBe(true);
    expect(samePinPreview(a, INITIAL_PIN_PREVIEW)).toBe(false);
  });
});

describe('a pin under its own card', () => {
  // The pin is centred on its coordinate: 30 dp up to the top of the pinned
  // marker, 22 dp down to its name, then the name (14 dp a line). The card
  // here runs from 500 to 640 dp, under a legend that ends at 99.
  const move = (pinY: number, name = 14, cardTop = 500, cardBottom = 640, mapTop = 99): RevealMove =>
    revealMove({ pinY, nameHeight: name, cardTop, cardBottom, mapTop });

  it('a pin clear of the card does not move the map', () => {
    expect(move(400)).toEqual({ shift: 0, pinStillCovered: false });
    expect(move(452).shift).toBe(0); // just clear
    expect(move(453).shift).toBe(1);
  });

  it('a pin under the card rises until its name clears it', () => {
    expect(move(560)).toEqual({ shift: 108, pinStillCovered: false });
    expect(move(560, 28).shift).toBe(122); // a two-line name
    // In the strip under the card: up past it.
    expect(move(700)).toEqual({ shift: 248, pinStillCovered: false });
  });

  it('a map too short for the pin does not move', () => {
    // A small phone: between the legend (ends at 395) and the card (from 428)
    // there is no room for a pin. Only a pin left under the card loses "Tap again".
    expect(move(500, 14, 428, 547, 395)).toEqual({ shift: 0, pinStillCovered: true });
    // In the strip under the card: in view, left there.
    expect(move(580, 14, 428, 547, 395)).toEqual({ shift: 0, pinStillCovered: false });
    // Exactly enough room: 30 up, 36 down, 12 clear.
    expect(move(500, 14, 473, 547, 395).shift).toBe(75);
    expect(move(500, 14, 472, 547, 395).shift).toBe(0);
  });

  it('a long name takes two lines under its pin', () => {
    expect(venueNameHeight('Hress')).toBe(14);
    expect(venueNameHeight('World Class Seltjarnarnes - Gym & Pool')).toBe(28);
  });
});
