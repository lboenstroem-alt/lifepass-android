/**
 * The Account screen's WhatsApp link (iOS `WhatsAppSupport.chatURL`): the
 * server's `url` with the greeting in the app language as `?text=`, encoded
 * byte for byte as the website encodes it, and nothing for a value that is
 * not exactly https://wa.me/<number> for a full international number.
 */
import { whatsAppChatUrl, whatsAppGreeting } from '../links';

const CHAT = { number: '3545550000', url: 'https://wa.me/3545550000' };

describe('whatsAppChatUrl', () => {
  it('opens the chat with the greeting in the app language', () => {
    expect(whatsAppChatUrl(CHAT, 'en')).toBe(
      'https://wa.me/3545550000?text=Hi%20LifePass%2C%20I%20have%20a%20question%20about%20',
    );
    expect(whatsAppChatUrl(CHAT, 'is')).toBe(
      'https://wa.me/3545550000?text=H%C3%A6%20LifePass%2C%20%C3%A9g%20er%20me%C3%B0%20spurningu%20um%20',
    );
    expect(whatsAppGreeting('is')).toBe('Hæ LifePass, ég er með spurningu um ');
  });

  it('is null with no chat', () => {
    expect(whatsAppChatUrl(null, 'en')).toBeNull();
    expect(whatsAppChatUrl(undefined, 'is')).toBeNull();
  });

  it.each([
    ['5550000', 'https://wa.me/5550000'], // no country code
    ['+3545550000', 'https://wa.me/3545550000'], // not digits only
    ['0354555000', 'https://wa.me/0354555000'], // leading zero
    ['3545550000', 'http://wa.me/3545550000'], // not https
    ['3545550000', 'https://wa.me/3545550000?text=hi'], // its own query
    ['3545550000', 'wa.me/3545550000'], // no scheme
    ['3545550000', 'https://example.com/3545550000'], // not wa.me
    ['3545550000', 'https://wa.me.example.com/3545550000'], // not wa.me
    ['3545550000', 'https://wa.me/3545559999'], // another number
    ['3545550000', 'https://wa.me/3545550000/'], // not the bare link
  ])('hides the row for %s %s', (number, url) => {
    expect(whatsAppChatUrl({ number, url }, 'en')).toBeNull();
  });
});
