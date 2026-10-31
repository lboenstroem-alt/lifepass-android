/**
 * The words on the check-in proof (iOS CheckInScanTests: CheckInProofNameTests'
 * "What the screen is built from", and the receipt lines of
 * `CheckInProofDisplay`). The vectors are iOS's.
 */
import type { CheckInParty } from '../../../../api/profile';
import { translate } from '../../../../i18n';
import {
  fillPrintf,
  partyBreakdownLine,
  partyChargedLine,
  partyCompactLine,
  partyGuestCount,
  partyHeadline,
  proofDay,
  proofDetailLine,
  proofSummary,
  proofTime,
} from '../proofFormat';

const en = (key: string) => translate(key, 'en');
const is = (key: string) => translate(key, 'is');

/** Thursday 23 April 2026, 14:32 in Reykjavík (which is UTC). */
const MOMENT = new Date(1_776_954_720 * 1000);
/** Friday 24 April 2026, 00:30 in Reykjavík; still Thursday 20:30 in New York. */
const LATE_SWIM = new Date(1_776_990_600 * 1000);

/** Runs `body` with Date's local getters answering as a phone in New York (UTC-4) would. */
function asIfThePhoneWereInNewYork(body: () => void): void {
  const proto = Date.prototype;
  const names = ['getFullYear', 'getMonth', 'getDate', 'getDay', 'getHours', 'getMinutes', 'getTimezoneOffset'] as const;
  const saved = names.map((name) => [name, proto[name]] as const);
  const shifted = (date: Date) => new Date(date.getTime() - 4 * 3_600_000);
  proto.getFullYear = function (this: Date) {
    return shifted(this).getUTCFullYear();
  };
  proto.getMonth = function (this: Date) {
    return shifted(this).getUTCMonth();
  };
  proto.getDate = function (this: Date) {
    return shifted(this).getUTCDate();
  };
  proto.getDay = function (this: Date) {
    return shifted(this).getUTCDay();
  };
  proto.getHours = function (this: Date) {
    return shifted(this).getUTCHours();
  };
  proto.getMinutes = function (this: Date) {
    return shifted(this).getUTCMinutes();
  };
  proto.getTimezoneOffset = function () {
    return 240;
  };
  try {
    body();
  } finally {
    for (const [name, original] of saved) (proto as unknown as Record<string, unknown>)[name] = original;
  }
}

function party(adults: number, children: number, infants: number, guestChargeIsk: number): CheckInParty {
  return { adults, children, infants, guestChargeIsk };
}

describe('the time and the day', () => {
  it('formats the time in 24-hour and the day in the account language (testTheProofFormatsTheTimeIn24HourAndTheDayInTheAccountsLanguage)', () => {
    expect(proofTime(MOMENT)).toBe('14:32');

    const english = proofDay(MOMENT, 'en');
    expect(english).toBe('Thu 23 Apr');

    const icelandic = proofDay(MOMENT, 'is');
    expect(icelandic.toLowerCase().startsWith('fim')).toBe(true);
    expect(icelandic).toContain('23');
    expect(icelandic).not.toBe(english);
  });

  // Jest runs in UTC, and scripts/ci.sh runs the suites again under
  // America/New_York and Asia/Tokyo; within one run, Date's local getters are
  // made to answer as a phone in New York would (as src/i18n's format tests do).
  it("is the venue's clock, not the phone's (testTheProofClockIsTheVenuesTimeNotThePhones)", () => {
    asIfThePhoneWereInNewYork(() => {
      // The phone really is elsewhere: its own clock reads 10:32.
      expect(MOMENT.getHours()).toBe(10);
      expect(proofTime(MOMENT)).toBe('14:32');
      expect(proofDay(MOMENT, 'en')).toContain('Thu');

      // Where the zones disagree about the DATE: a late swim at 00:30 on
      // Friday the 24th at the venue is Thursday the 23rd in New York.
      expect(LATE_SWIM.getDate()).toBe(23);
      expect(proofTime(LATE_SWIM)).toBe('00:30');
      const day = proofDay(LATE_SWIM, 'en');
      expect(day).toContain('Fri');
      expect(day).toContain('24');
    });
  });

  it('never puts AM or PM on the clock', () => {
    const afternoon = new Date('2026-04-23T23:05:00Z');
    expect(proofTime(afternoon)).toBe('23:05');
    expect(proofTime(new Date('2026-04-23T00:00:00Z'))).toBe('00:00');
  });
});

describe('the spoken summary', () => {
  it('reads the big lines in the order they are read, and leaves out what is not there', () => {
    expect(proofSummary('14:32', 'Thu 23 Apr', 'World Class Laugar', 'Lucas B.')).toBe(
      '14:32, Thu 23 Apr, World Class Laugar, Lucas B.',
    );
    expect(proofSummary('14:32', 'Thu 23 Apr', 'World Class Laugar', null)).toBe('14:32, Thu 23 Apr, World Class Laugar');
    expect(proofSummary('14:32', 'Thu 23 Apr', null, '')).toBe('14:32, Thu 23 Apr');
  });
});

describe('the detail line', () => {
  it('is the activity and the confirmation code, spaced as iOS spaces them', () => {
    expect(proofDetailLine('Yoga', '4F21A0', en)).toBe('Yoga  ·  CONFIRMATION 4F21A0');
    expect(proofDetailLine('Walk-in', 'C93B77', is)).toBe('Walk-in  ·  STAÐFESTINGARNÚMER C93B77');
  });

  it('says what there is, and is no line at all when there is nothing', () => {
    expect(proofDetailLine(null, '4F21A0', en)).toBe('CONFIRMATION 4F21A0');
    expect(proofDetailLine('Yoga', null, en)).toBe('Yoga');
    expect(proofDetailLine(null, null, en)).toBeNull();
    expect(proofDetailLine('', '', en)).toBeNull();
  });
});

describe('the party receipt', () => {
  it('counts the member and every guest', () => {
    const family = party(1, 2, 0, 5400);
    expect(partyGuestCount(family)).toBe(3);
    expect(partyHeadline(family, en)).toBe('4 checked in');
    expect(partyHeadline(family, is)).toBe('4 innrituð');
  });

  it('breaks the party down from the server counts, singular and plural', () => {
    expect(partyBreakdownLine(party(1, 2, 0, 0), en)).toBe(
      `${en('checkin.party.member')} · 1 ${en('checkin.party.adult')} · 2 ${en('checkin.party.children')}`,
    );
    expect(partyBreakdownLine(party(2, 1, 1, 0), en)).toBe(
      `${en('checkin.party.member')} · 2 ${en('checkin.party.adults')} · 1 ${en('checkin.party.child')} · 1 ${en('checkin.party.infant')}`,
    );
    expect(partyBreakdownLine(party(0, 0, 3, 0), en)).toBe(`${en('checkin.party.member')} · 3 ${en('checkin.party.infants')}`);
  });

  it('says what the guests were charged, in the words that make it a payment', () => {
    expect(partyChargedLine(party(1, 0, 0, 5400), en)).toBe('Guests: ISK 5,400 charged to your card');
    expect(partyChargedLine(party(1, 0, 0, 5400), is)).toBe('Gestir: ISK 5,400 gjaldfært á kortið þitt');
    expect(partyChargedLine(party(0, 0, 1, 0), en)).toBeNull();
  });

  it('is one receipt line at the accessibility sizes, the charge keeping its words', () => {
    expect(partyCompactLine(party(1, 2, 0, 5400), en)).toBe(
      `${partyBreakdownLine(party(1, 2, 0, 5400), en)} · ISK 5,400 charged to your card`,
    );
    // No charge: it ends after the people, as the two-line receipt does.
    expect(partyCompactLine(party(0, 0, 1, 0), en)).toBe(partyBreakdownLine(party(0, 0, 1, 0), en));
  });
});

describe('the printf placeholders the iOS tables keep', () => {
  it('fills %d, %ld and %@', () => {
    expect(fillPrintf('%d checked in', 3)).toBe('3 checked in');
    expect(fillPrintf('%ld left', 7)).toBe('7 left');
    expect(fillPrintf('Guests: %@ charged', 'ISK 5,400')).toBe('Guests: ISK 5,400 charged');
    expect(fillPrintf('no placeholder', 1)).toBe('no placeholder');
  });
});
