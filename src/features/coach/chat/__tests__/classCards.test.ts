/**
 * The Coach chat's class cards (API 0.36.0), the decode and the words: iOS
 * CoachClassCardsTests, "The server's own bytes", "Fail soft" and "What a
 * card offers". The decode half reads the server's own bytes
 * (./classCardFixtures.ts) through the app's real decoder, so a field
 * renamed on either side turns this red.
 */
import { lookup, translate, type Lang, type Params } from '../../../../i18n';
import { decodeClassCards, decodePlanClass, encodePlanClass, MAX_CLASS_CARDS } from '../../dayPlan/decode';
import {
  classCardMetaLine,
  classCardOffersBook,
  classCardState,
  classCardStateLabel,
  classCardWhenLine,
} from '../classCards';
import { decodeCoachChatReply } from '../coachApi';
import { CARDS_EN, CARDS_IS, dataOf, PLAIN_EN, SERVER_NOW } from './classCardFixtures';

const date = (iso: string) => new Date(iso);
const tr =
  (lang: Lang) =>
  (key: string, params?: Params): string =>
    translate(key, lang, params);
const en = tr('en');

/** One card from a hand-written `data`, for the fail-soft cases. */
const card = {
  id: 'cls_1',
  title: 'HOT FIT',
  startsAt: '2026-10-13T12:10:00.000Z',
  endsAt: '2026-10-13T13:10:00.000Z',
  venueSlug: 'nordur-akureyri',
  venueName: 'Nordur Akureyri',
  booking: { kind: 'class', activityId: '6b1f0c52-3a7e-4d19-8f2a-0c9d4e5b7a11', eventId: 7 },
};

const fixture = () => decodeCoachChatReply(dataOf(CARDS_EN));

describe("the server's own bytes", () => {
  it('decode field for field (testTheServersResponseDecodesFieldForField)', () => {
    const response = fixture();
    expect(response.reply).toBe('Here are classes in Akureyri today. Tap one to book.');
    const classes = response.classes;
    expect(classes.map((c) => c.id)).toEqual(['cls_292c2799eb', 'cls_be41a59600', 'cls_094a45a28b', 'cls_3d7ee04649']);
    expect(classes.map((c) => c.title)).toEqual(['HOT FIT', 'Spinning', 'Yoga Flow', 'Sauna ritual']);
    expect(classes.map((c) => c.venueSlug)).toEqual([
      'nordur-akureyri',
      'world-class-skolastigur-akureyri-and-pool',
      'sjalfsraekt-heilsumidstod',
      'forest-lagoon',
    ]);
    expect(classes[1]!.venueName).toBe('World Class Skólastígur Akureyri & Pool');
    expect(classes[0]!.startsAt).toEqual(date('2026-10-13T12:10:00Z'));
    expect(classes[0]!.endsAt).toEqual(date('2026-10-13T13:10:00Z'));
    expect(classes.map((c) => c.status)).toEqual(['open', 'full', 'opens_later', 'open']);
    expect(classes.map((c) => c.spotsLeft)).toEqual([18, 0, 18, 9]);
    expect(classes.map((c) => c.priceLabel)).toEqual([
      'Included in your plan',
      'Included in your plan',
      'Included in your plan',
      'From 4,500 ISK',
    ]);
    expect(classes.map((c) => c.surchargeFromIsk)).toEqual([null, null, null, 4500]);

    expect(classes[0]!.booking).toEqual({
      kind: 'class',
      activityId: '6b1f0c52-3a7e-4d19-8f2a-0c9d4e5b7a11',
      eventId: 2_102_243_144,
      slotStartsAt: null,
      slotEndsAt: null,
    });
    expect(classes[3]!.booking).toEqual({
      kind: 'slot',
      activityId: 'd9b7a1c3-6e2f-4a8d-b5c4-3e1f7a9d0c88',
      eventId: null,
      slotStartsAt: date('2026-10-13T19:30:00Z'),
      slotEndsAt: date('2026-10-13T20:00:00Z'),
    });
  });

  it('the Icelandic answer carries Icelandic price lines (testTheIcelandicResponseCarriesIcelandicPriceLines)', () => {
    const response = decodeCoachChatReply(dataOf(CARDS_IS));
    expect(response.reply).toBe('Hér eru tímar á Akureyri í dag. Ýttu á tíma til að bóka.');
    expect(response.classes.map((c) => c.priceLabel)).toEqual([
      'Innifalið í áskriftinni',
      'Innifalið í áskriftinni',
      'Innifalið í áskriftinni',
      'Frá 4.500 kr.',
    ]);
  });

  it('an answer without classes is just the reply (testAnAnswerWithoutClassesIsJustTheReply)', () => {
    const response = decodeCoachChatReply(dataOf(PLAIN_EN));
    expect(response.reply).toBe('Today in Akureyri:\n• 12:10-13:10 HOT FIT, Nordur Akureyri');
    expect(response.classes).toEqual([]);
  });
});

describe('fail soft', () => {
  it('a bad card is dropped and the rest kept (testABadCardIsDroppedAndTheRestKept)', () => {
    const response = decodeCoachChatReply({
      reply: 'Hi.',
      classes: [
        card,
        { id: 'cls_2', title: 'No start', venueSlug: 'x', venueName: 'X' },
        'not a card',
        null,
        42,
        {
          id: 'cls_3',
          title: 'Odd handle',
          startsAt: '2026-10-13T15:00:00Z',
          venueSlug: 'x',
          venueName: 'X',
          booking: { kind: 'teleport', activityId: '6b1f0c52-3a7e-4d19-8f2a-0c9d4e5b7a11' },
        },
      ],
    });
    expect(response.reply).toBe('Hi.');
    expect(response.classes.map((c) => c.id)).toEqual(['cls_1', 'cls_3']);
    // A handle this build cannot read is no handle: the card stays and Book
    // looks the class up in GET /classes instead.
    expect(response.classes[1]!.booking).toBeNull();
  });

  it('classes that are not a list are no classes (testClassesThatAreNotAListAreNoClasses)', () => {
    expect(decodeCoachChatReply({ reply: 'Hi.', classes: { a: 1 } }).classes).toEqual([]);
    expect(decodeCoachChatReply({ reply: 'Hi.', classes: null }).classes).toEqual([]);
    expect(decodeCoachChatReply({ reply: 'Hi.', classes: 'HOT FIT' }).reply).toBe('Hi.');
  });

  it('repeats are shown once, and six at most (testRepeatsAreShownOnceAndAtMostSix)', () => {
    const many = Array.from({ length: 9 }, (_, index) => ({ ...card, id: `cls_${(index + 1) % 8}` }));
    const classes = decodeClassCards(many);
    expect(MAX_CLASS_CARDS).toBe(6);
    expect(classes).toHaveLength(MAX_CLASS_CARDS);
    expect(new Set(classes.map((c) => c.id)).size).toBe(classes.length);
  });

  it('extras this build cannot read are no value, not a lost card (testExtrasThisBuildCannotReadAreNoValueNotALostCard)', () => {
    const [session] = decodeClassCards([
      { ...card, status: 'booking_closed', spotsLeft: 'many', priceLabel: 4, surchargeFromIsk: -5 },
    ]);
    expect(session!.status).toBe('booking_closed');
    expect(session!.spotsLeft).toBeNull();
    expect(session!.priceLabel).toBeNull();
    expect(session!.surchargeFromIsk).toBeNull();
    // A state this build does not know is never offered as bookable.
    expect(classCardOffersBook(session!)).toBe(false);
    // Spots below 0 read as none left.
    expect(decodePlanClass({ ...card, spotsLeft: -3 }).spotsLeft).toBe(0);
  });

  it('a card without extras offers Book, as a day plan class does (testACardWithoutExtrasOffersBook)', () => {
    const [session] = decodeClassCards([card]);
    expect(session!.status).toBeNull();
    expect(session!.spotsLeft).toBeNull();
    expect(session!.priceLabel).toBeNull();
    expect(classCardOffersBook(session!)).toBe(true);
  });

  it("a saved card is the server's shape, and reads back as the same card (testASavedCardIsTheServersShape)", () => {
    const classes = fixture().classes;
    const written = JSON.parse(JSON.stringify(classes.map(encodePlanClass))) as Record<string, unknown>[];
    expect(decodeClassCards(written)).toEqual(classes);
    const first = written[0]!;
    expect(first.startsAt).toBe('2026-10-13T12:10:00.000Z');
    expect(first.status).toBe('open');
    expect((first.booking as Record<string, unknown>).activityId).toBe('6b1f0c52-3a7e-4d19-8f2a-0c9d4e5b7a11');
    // What a card does not carry is left out, as iOS `encodeIfPresent`.
    expect(written[0]).not.toHaveProperty('surchargeFromIsk');
    expect(written[3]!.booking).toEqual({
      kind: 'slot',
      activityId: 'd9b7a1c3-6e2f-4a8d-b5c4-3e1f7a9d0c88',
      startsAt: '2026-10-13T19:30:00.000Z',
      endsAt: '2026-10-13T20:00:00.000Z',
    });
  });
});

describe('what a card offers', () => {
  it('Book only for an open class that has not started (testBookOnlyForAnOpenClassThatHasNotStarted)', () => {
    const classes = fixture().classes;
    expect(classes.map(classCardOffersBook)).toEqual([true, false, false, true]);
    expect(classes.map((c) => classCardState(c, SERVER_NOW))).toEqual(['bookable', 'full', 'opensLater', 'bookable']);
    // An answer read later: a class that has begun is not offered.
    const at1230 = date('2026-10-13T12:30:00Z');
    expect(classes.map((c) => classCardState(c, at1230))).toEqual(['started', 'full', 'opensLater', 'bookable']);
    expect(classCardState({ ...classes[0]!, status: 'waitlist' }, SERVER_NOW)).toBe('unavailable');
  });

  it('the words on a card (testTheWordsOnACard)', () => {
    const classes = fixture().classes;
    const first = classes[0]!;
    expect(classCardWhenLine(first, SERVER_NOW, 'en', en)).toBe('12:10–13:10');
    const dayBefore = date('2026-10-12T20:00:00Z');
    expect(classCardWhenLine(first, dayBefore, 'en', en)).toBe('Tomorrow · 12:10–13:10');
    expect(classCardWhenLine(first, dayBefore, 'is', tr('is'))).toBe('Á morgun · 12:10–13:10');
    const weekBefore = date('2026-10-06T09:00:00Z');
    expect(classCardWhenLine(first, weekBefore, 'en', en)).toBe('Tue 13 Oct · 12:10–13:10');
    expect(classCardWhenLine({ ...first, endsAt: null }, SERVER_NOW, 'en', en)).toBe('12:10');

    const states = classes.map((c) => classCardState(c, SERVER_NOW));
    expect(classCardMetaLine(classes[0]!, states[0]!, en)).toBe('Included in your plan · 18 left');
    expect(classCardMetaLine(classes[1]!, states[1]!, en)).toBe('Included in your plan');
    expect(classCardMetaLine(classes[2]!, states[2]!, en)).toBe('Included in your plan');
    expect(classCardMetaLine(classes[3]!, states[3]!, en)).toBe('From 4,500 ISK · 9 left');
    expect(classCardMetaLine({ priceLabel: null, spotsLeft: null }, 'bookable', en)).toBeNull();

    expect(classCardStateLabel('bookable', en)).toBeNull();
    expect(classCardStateLabel('full', en)).toBe('Full');
    expect(classCardStateLabel('opensLater', en)).toBe('Opens later');
    expect(classCardStateLabel('started', en)).toBe('Started');
    expect(classCardStateLabel('unavailable', en)).toBe('Unavailable');
  });

  it('the new words exist in both languages (testTheNewWordsExistInBothLanguages)', () => {
    for (const key of [
      'coach.classes.title',
      'coach.classes.intro',
      'coach.classes.show',
      'coach.classes.close',
      'coach.classes.opens_later',
      'coach.classes.started',
    ]) {
      const english = lookup(key, 'en');
      const icelandic = lookup(key, 'is');
      expect([key, english]).not.toEqual([key, key]);
      expect([key, icelandic]).not.toEqual([key, key]);
      expect([key, english]).not.toEqual([key, icelandic]);
    }
  });
});
