/**
 * The party section on screen (iOS BookingFlowView groupStepper and
 * guestAgePicker): the stepper and its bounds, the per-guest age menus with
 * the venue's ranges, the note, the in-flight lock, TalkBack, and both ways
 * of reporting (one seat's band, or guests by band).
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import type { AgeBandOffer } from '../../../../api/bookings';
import { lookup, setCurrentLanguage } from '../../../../i18n';
import { colors } from '../../../../theme';
import GroupPartySection, { type GuestCounts } from '../GroupPartySection';
import { countsFromBands } from '../partyModel';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const en = (key: string) => lookup(key, 'en');

const BANDS: AgeBandOffer[] = [
  { band: 'adult', rangeLabel: '16+', priceIsk: null },
  { band: 'child', rangeLabel: '6-15', priceIsk: 3_000 },
  { band: 'infant', rangeLabel: '0-5', priceIsk: 0 },
];

beforeEach(() => setCurrentLanguage('en'));

/**
 * The printed count and the "Person 2" words are hidden from TalkBack (the
 * adjustable element and each menu say them), so the queries opt in.
 */
const HIDDEN = { includeHiddenElements: true } as const;
const shownCount = () => screen.getByTestId('booking.party.count', HIDDEN);

/**
 * The section as BOOK-1 mounts it: the seats live in the "session" (here a
 * state), the counts report a resize, and one seat's band a re-price.
 */
function Party({
  ageBands = BANDS,
  initial = [] as string[],
  disabled = false,
  onGuests,
  onBand,
}: {
  ageBands?: AgeBandOffer[];
  initial?: string[];
  disabled?: boolean;
  onGuests?: (guests: GuestCounts) => void;
  onBand?: (index: number, band: string) => void;
}) {
  const [bands, setBands] = useState<string[]>(initial);
  return (
    <GroupPartySection
      venueId="v"
      activityId="a"
      guests={countsFromBands(bands)}
      onChangeGuests={(guests) => {
        onGuests?.(guests);
        // The session keeps the seats in place and adds or drops at the end.
        const total = Object.values(guests).reduce((sum, count) => sum + count, 0);
        setBands((current) =>
          total > current.length ? [...current, ...Array<string>(total - current.length).fill('adult')] : current.slice(0, total),
        );
      }}
      ageBands={ageBands}
      guestBands={bands}
      onChangeGuestBand={(index, band) => {
        onBand?.(index, band);
        setBands((current) => current.map((seat, i) => (i === index ? band : seat)));
      }}
      disabled={disabled}
    />
  );
}

describe('the stepper', () => {
  it('draws 32 dp circles in the card colour inside 48 dp touch targets, as iOS draws them', async () => {
    await render(<Party />);
    for (const id of ['booking.party.fewer', 'booking.party.more']) {
      const target = screen.getByTestId(id);
      // The target's own bounds, not a hit slop, so the Accessibility Scanner measures 48 dp.
      expect(target).toHaveStyle({ width: 48, height: 48 });
      expect(target.props.hitSlop).toBeUndefined();
      // iOS lpMuted, the card's own colour: only the glyph shows.
      expect(screen.getByTestId(`${id}.circle`)).toHaveStyle({ width: 32, height: 32, backgroundColor: colors.ink2 });
    }
  });

  it('starts with the member alone: minus off and faded, plus adds an adult guest', async () => {
    const onGuests = jest.fn();
    await render(<Party onGuests={onGuests} />);
    expect(screen.getByText(en('booking.group_label'))).toBeOnTheScreen();
    expect(shownCount()).toHaveTextContent('1');
    const fewer = screen.getByRole('button', { name: lookup('book2.party.fewer', 'en') });
    expect(fewer).toBeDisabled();
    expect(fewer).toHaveStyle({ opacity: 0.35 });
    await fireEvent.press(fewer);
    expect(onGuests).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: lookup('book2.party.more', 'en') }));
    expect(onGuests).toHaveBeenLastCalledWith({ adult: 1 });
    expect(shownCount()).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: lookup('book2.party.fewer', 'en') })).toBeEnabled();
  });

  it('stops at ten people: plus off and faded', async () => {
    const onGuests = jest.fn();
    await render(<Party initial={Array(8).fill('adult')} onGuests={onGuests} />);
    await fireEvent.press(screen.getByTestId('booking.party.more'));
    expect(shownCount()).toHaveTextContent('10');
    const more = screen.getByTestId('booking.party.more');
    expect(more).toBeDisabled();
    expect(more).toHaveStyle({ opacity: 0.35 });
    await fireEvent.press(more);
    expect(onGuests).toHaveBeenCalledTimes(1);
  });

  it('minus drops the last guest, so an age already picked stays with its person', async () => {
    const onGuests = jest.fn();
    await render(<Party initial={['child', 'adult']} onGuests={onGuests} />);
    await fireEvent.press(screen.getByTestId('booking.party.fewer'));
    expect(onGuests).toHaveBeenLastCalledWith({ child: 1 });
  });

  it('is one adjustable element for TalkBack: a swipe is one step, the same as the buttons', async () => {
    const onGuests = jest.fn();
    await render(<Party initial={['child']} onGuests={onGuests} />);
    const size = screen.getByRole('adjustable', { name: en('booking.group_label') });
    expect(size).toHaveAccessibilityValue({ min: 1, max: 10, now: 2, text: '2' });
    await fireEvent(size, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onGuests).toHaveBeenLastCalledWith({ child: 1, adult: 1 });
    await fireEvent(size, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    await fireEvent(size, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(onGuests).toHaveBeenLastCalledWith({});
  });

  it('nothing changes while a booking is in flight', async () => {
    const onGuests = jest.fn();
    const onBand = jest.fn();
    await render(<Party initial={['adult']} disabled onGuests={onGuests} onBand={onBand} />);
    expect(screen.getByTestId('booking.party.more')).toBeDisabled();
    expect(screen.getByTestId('booking.party.fewer')).toBeDisabled();
    // Not faded: only a bound fades a button, as iOS.
    expect(screen.getByTestId('booking.party.more')).not.toHaveStyle({ opacity: 0.35 });
    await fireEvent.press(screen.getByTestId('booking.party.more'));
    const size = screen.getByRole('adjustable', { name: en('booking.group_label') });
    await fireEvent(size, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(screen.getByRole('button', { name: 'Person 2' })).toBeDisabled();
    expect(onGuests).not.toHaveBeenCalled();
    expect(onBand).not.toHaveBeenCalled();
  });
});

describe('the guest ages', () => {
  it('hidden for the member alone, and for a venue that sells adults only', async () => {
    const { rerender } = await render(<Party />);
    expect(screen.queryByText(en('booking.guest_ages_label'))).toBeNull();
    await fireEvent.press(screen.getByTestId('booking.party.more'));
    expect(screen.getByText(en('booking.guest_ages_label'))).toBeOnTheScreen();

    await rerender(<Party ageBands={[BANDS[0]]} initial={['adult', 'adult']} key="adults" />);
    expect(screen.queryByText(en('booking.guest_ages_label'))).toBeNull();
    expect(shownCount()).toHaveTextContent('3');
  });

  it('one row per guest from Person 2, each an adult at first, with the note', async () => {
    await render(<Party initial={['adult', 'child']} />);
    expect(screen.getByText('Person 2', HIDDEN)).toBeOnTheScreen();
    expect(screen.getByText('Person 3', HIDDEN)).toBeOnTheScreen();
    expect(screen.queryByText('Person 1', HIDDEN)).toBeNull();
    expect(screen.getByRole('button', { name: 'Person 2' })).toHaveAccessibilityValue({ text: 'Adult (16+)' });
    expect(screen.getByRole('button', { name: 'Person 3' })).toHaveAccessibilityValue({ text: 'Child (6-15)' });
    expect(screen.getByText(en('booking.guest_ages_note'))).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('booking.party.more'));
    expect(screen.getByRole('button', { name: 'Person 4' })).toHaveAccessibilityValue({ text: 'Adult (16+)' });
  });

  it("the menu offers the venue's bands with its own ranges and changes exactly that guest", async () => {
    const onBand = jest.fn();
    const onGuests = jest.fn();
    await render(<Party initial={['adult', 'adult']} onBand={onBand} onGuests={onGuests} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Person 3' }));
    expect(screen.getByRole('menuitem', { name: 'Adult (16+)' })).toBeSelected();
    expect(screen.getByRole('menuitem', { name: 'Infant (0-5)' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('menuitem', { name: 'Child (6-15)' }));

    expect(onBand).toHaveBeenCalledWith(1, 'child');
    expect(onGuests).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Person 3' })).toHaveAccessibilityValue({ text: 'Child (6-15)' });
    expect(screen.getByRole('button', { name: 'Person 2' })).toHaveAccessibilityValue({ text: 'Adult (16+)' });
  });

  it('a seat whose band the venue does not list keeps its own name on the trigger; the menu lists only what the venue sells', async () => {
    // A guest starts as an adult; this venue sells child and infant tickets only.
    const onBand = jest.fn();
    await render(<Party ageBands={[BANDS[1], BANDS[2]]} initial={['adult']} onBand={onBand} />);
    // TalkBack hears the band in the label, since it is no option to say as the value.
    const trigger = screen.getByRole('button', { name: 'Person 2, Adult' });
    expect(screen.getByText('Adult')).toBeOnTheScreen();

    await fireEvent.press(trigger);
    // As iOS: the venue's bands and nothing else, none of them checked.
    expect(screen.getAllByRole('menuitem').map((item) => item.props.accessibilityLabel)).toEqual([
      'Child (6-15)',
      'Infant (0-5)',
    ]);
    expect(screen.getByRole('menuitem', { name: 'Child (6-15)' })).not.toBeSelected();
    await fireEvent.press(screen.getByRole('menuitem', { name: 'Child (6-15)' }));
    expect(onBand).toHaveBeenCalledWith(0, 'child');
    // A listed band again: the plain label, with the band as its value.
    expect(screen.getByRole('button', { name: 'Person 2' })).toHaveAccessibilityValue({ text: 'Child (6-15)' });
  });

  it('a seat whose band the venue no longer lists is never shown as another band', async () => {
    await render(<Party ageBands={[BANDS[0], BANDS[2]]} initial={['child']} />);
    expect(screen.getByRole('button', { name: 'Person 2, Child' })).toBeOnTheScreen();
    expect(screen.getByText('Child')).toBeOnTheScreen();
  });

  it('reads in Icelandic', async () => {
    setCurrentLanguage('is');
    await render(<Party initial={['child']} />);
    expect(screen.getByText(lookup('booking.group_label', 'is'))).toBeOnTheScreen();
    expect(screen.getByText(lookup('booking.guest_ages_label', 'is'))).toBeOnTheScreen();
    expect(screen.getByText('Gestur 2', HIDDEN)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Gestur 2' })).toHaveAccessibilityValue({ text: 'Barn (6-15)' });
    expect(screen.getByRole('button', { name: lookup('book2.party.more', 'is') })).toBeOnTheScreen();
  });
});

describe('a caller that reports guests by band only', () => {
  it('draws the counts in the venue band order and reports a changed age as counts', async () => {
    const onGuests = jest.fn();
    await render(
      <GroupPartySection venueId="v" activityId="a" guests={{ child: 1, adult: 1 }} onChangeGuests={onGuests} ageBands={BANDS} />,
    );
    expect(shownCount()).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: 'Person 2' })).toHaveAccessibilityValue({ text: 'Adult (16+)' });
    expect(screen.getByRole('button', { name: 'Person 3' })).toHaveAccessibilityValue({ text: 'Child (6-15)' });

    await fireEvent.press(screen.getByRole('button', { name: 'Person 2' }));
    await fireEvent.press(screen.getByRole('menuitem', { name: 'Infant (0-5)' }));
    expect(onGuests).toHaveBeenLastCalledWith({ infant: 1, child: 1 });

    await fireEvent.press(screen.getByTestId('booking.party.more'));
    expect(onGuests).toHaveBeenLastCalledWith({ adult: 2, child: 1 });
  });
});
