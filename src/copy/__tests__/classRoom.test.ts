/**
 * The class room's words (API 0.44.0, docs/05 "The class room"): after the
 * venue on a row, and the labelled row of the booking sheet and the confirm
 * card, where Icelandic never reads "Salur: Salur 4".
 */
import { roomRowText, roomRowValue, venueWithRoom } from '../classRoom';

describe('after the venue name (class rows, Coach cards, My bookings)', () => {
  it('joins the room with " · ", exactly as sent', () => {
    expect(venueWithRoom('World Class Laugar & Pool', 'Salur 4')).toBe('World Class Laugar & Pool · Salur 4');
    expect(venueWithRoom('Nordur Akureyri', 'Salur 1 - 1. hæð')).toBe('Nordur Akureyri · Salur 1 - 1. hæð');
    expect(venueWithRoom('World Class Egilshöll', 'Salur 1 & 2')).toBe('World Class Egilshöll · Salur 1 & 2');
  });

  it('is the venue alone without a room: no empty label, no dangling dot', () => {
    expect(venueWithRoom('Grandi 101', null)).toBe('Grandi 101');
    expect(venueWithRoom('Grandi 101', undefined)).toBe('Grandi 101');
    expect(venueWithRoom('Grandi 101', '')).toBe('Grandi 101');
  });
});

describe('the labelled row (booking sheet, confirm card)', () => {
  it.each([
    ['Salur 4', '4'],
    ['Salur 3', '3'],
    ['Salur 2 Heitur', '2 Heitur'],
    ['Salur 1 - 1. hæð', '1 - 1. hæð'],
    ['Salur 1 & 2', '1 & 2'],
    // The website's email rule: the word in any case, then any space.
    ['salur 5', '5'],
    ['SALUR  6', '6'],
  ])('Icelandic drops the repeated word: "%s" reads "Salur: %s"', (room, value) => {
    expect(roomRowValue(room, 'is')).toBe(value);
    expect(roomRowText(room, 'is')).toBe(`Salur: ${value}`);
  });

  it('Icelandic keeps a room that does not start with the word, and a bare "Salur"', () => {
    expect(roomRowValue('Heitur salur', 'is')).toBe('Heitur salur');
    expect(roomRowValue('Salurinn', 'is')).toBe('Salurinn');
    expect(roomRowValue('Salur', 'is')).toBe('Salur');
    expect(roomRowText('Spinningsalur', 'is')).toBe('Salur: Spinningsalur');
  });

  it('never reads "Salur: Salur 4" in Icelandic', () => {
    expect(roomRowText('Salur 4', 'is')).not.toContain('Salur: Salur');
  });

  it('English shows the room as sent, under "Room"', () => {
    expect(roomRowValue('Salur 4', 'en')).toBe('Salur 4');
    expect(roomRowText('Salur 4', 'en')).toBe('Room: Salur 4');
    expect(roomRowText('Salur 2 Heitur', 'en')).toBe('Room: Salur 2 Heitur');
  });
});
