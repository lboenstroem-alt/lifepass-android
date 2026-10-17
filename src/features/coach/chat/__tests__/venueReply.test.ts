/**
 * The Coach's stray venue documents (iOS `CoachViewModel`, "Stray venue-JSON
 * guard"): a reply that is a `{"type":"venues", ...}` document is resolved
 * against the real catalogue, never trusted as sent.
 *
 * The first build took the first '{' to the last '}' anywhere in a reply and
 * drew the model's cards verbatim; "Book it" then opened the card's id, which
 * the model fills with a SLUG, as a venue id, and found nothing.
 */
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { decodeVenue, venueToApi } from '../../../../api/venues';
import { lookup } from '../../../../i18n';
import type { Venue } from '../../../../types/venue';
import {
  nameCorresponds,
  parseVenuePayload,
  resolveVenueCards,
  venuesReplyAsText,
  type CoachVenuePayload,
  type VenueLookup,
} from '../venueReply';

function venue(n: number, name: string, slug = `v${n}`): Venue {
  return decodeVenue({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    slug,
    name,
    inBundle: true,
  });
}

const BLUE_LAGOON = venue(1, 'Blue Lagoon Retreat', 'blue-lagoon-retreat');
const SKY_LAGOON = venue(2, 'Sky Lagoon', 'sky-lagoon');
const LAUGARDALSLAUG = venue(3, 'Laugardalslaug', 'laugardalslaug');
const VESTURBAEJARLAUG = venue(4, 'Vesturbæjarlaug', 'vesturbaejarlaug');

const t = (key: string) => lookup(key, 'en');

// ---------------------------------------------------------------------------

describe('parseVenuePayload', () => {
  const doc = '{"type":"venues","intro":"Two pools.","venues":[{"id":"laugardalslaug","name":"Laugardalslaug","location":"Reykjavík"}]}';

  it('reads a bare venues document', () => {
    expect(parseVenuePayload(doc)).toEqual({
      type: 'venues',
      intro: 'Two pools.',
      venues: [{ id: 'laugardalslaug', name: 'Laugardalslaug', location: 'Reykjavík' }],
    });
  });

  it('tolerates a markdown fence around it, and surrounding whitespace', () => {
    expect(parseVenuePayload(`\n\`\`\`json\n${doc}\n\`\`\`\n`)?.intro).toBe('Two pools.');
    expect(parseVenuePayload(`\`\`\`\n${doc}\n  \`\`\`  `)?.intro).toBe('Two pools.');
  });

  it('drops only the fence LINES: a string value with backticks or "json" survives', () => {
    const tricky = '```json\n{"type":"venues","intro":"Say ```json``` to me","venues":[]}\n```';
    expect(parseVenuePayload(tricky)?.intro).toBe('Say ```json``` to me');
  });

  it('leaves prose alone, even prose that contains braces', () => {
    expect(parseVenuePayload('Try Laugardalslaug {it is great} today.')).toBeNull();
    expect(parseVenuePayload('Here you go: {"type":"venues","venues":[]}')).toBeNull();
    expect(parseVenuePayload('')).toBeNull();
  });

  it('is prose when the JSON is broken, another type, or not an object', () => {
    expect(parseVenuePayload('{"type":"venues", "venues": [')).toBeNull();
    expect(parseVenuePayload('{"type":"plan","intro":"x"}')).toBeNull();
    expect(parseVenuePayload('{"intro":"no type"}')).toBeNull();
    expect(parseVenuePayload('[{"type":"venues"}]')).toBeNull();
  });

  it('is prose when a member has the wrong type (as a Swift decode fails)', () => {
    expect(parseVenuePayload('{"type":"venues","intro":7}')).toBeNull();
    expect(parseVenuePayload('{"type":"venues","venues":{"id":"x"}}')).toBeNull();
    expect(parseVenuePayload('{"type":"venues","venues":[{"id":1}]}')).toBeNull();
    expect(parseVenuePayload('{"type":"venues","venues":["Sky Lagoon"]}')).toBeNull();
  });

  it('reads missing and null members as absent', () => {
    expect(parseVenuePayload('{"type":"venues"}')).toEqual({ type: 'venues', intro: null, venues: null });
    expect(parseVenuePayload('{"type":"venues","intro":null,"venues":[{"name":"Sky Lagoon","id":null}]}')).toEqual({
      type: 'venues',
      intro: null,
      venues: [{ id: null, name: 'Sky Lagoon', location: null }],
    });
  });
});

// ---------------------------------------------------------------------------

describe('nameCorresponds', () => {
  it.each([
    // venue name, AI name, corresponds
    ['Blue Lagoon Retreat', 'The Retreat at Blue Lagoon', true],
    ['Sky Lagoon', 'The Retreat at Blue Lagoon', false],
    ['Sky Lagoon', 'sky lagoon', true],
    ['Laugardalslaug', 'Laugardalslaug swimming pool', true],
    ['Vesturbæjarlaug', 'Vesturbæjarlaug', true],
    ['Vesturbæjarlaug', 'Vesturbaejarlaug', false],
    ['World Class Laugar', 'World Class Kringlan', false],
    ['World Class Laugar', 'Laugar Spa by World Class', true],
    // Short words (under 3 characters) are ignored...
    ['Spa 7', 'The spa', true],
    // ...and a name with none never corresponds.
    ['K2', 'K2', false],
    ['', 'Anything', false],
    // Punctuation splits words, as Swift's alphanumerics do.
    ['Hress Líkamsrækt (Hafnarfjörður)', 'Hress líkamsrækt in Hafnarfjörður', true],
  ])('%s vs %s: %s', (venueName, aiName, expected) => {
    expect(nameCorresponds(venueName, aiName)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------

/** A lookup over a catalogue, recording what it was asked. */
function fakeLookup(catalogue: readonly Venue[], options: { searchFails?: boolean } = {}) {
  const asked: string[] = [];
  const lookupFn: VenueLookup = {
    async bySlug(slug) {
      asked.push(`slug:${slug}`);
      const found = catalogue.find((candidate) => candidate.slug === slug);
      if (!found) throw new Error('not found');
      return found;
    },
    async search(query) {
      asked.push(`q:${query}`);
      if (options.searchFails) throw new Error('offline');
      // The server's `q`: a plain substring match, in its own order.
      return catalogue.filter((candidate) => candidate.name.toLowerCase().includes(query.toLowerCase()));
    },
  };
  return { lookup: lookupFn, asked };
}

function payload(venues: { id?: string; name?: string; location?: string }[], intro: string | null = 'Ideas.'): CoachVenuePayload {
  return {
    type: 'venues',
    intro,
    venues: venues.map((card) => ({ id: card.id ?? null, name: card.name ?? null, location: card.location ?? null })),
  };
}

describe('resolveVenueCards', () => {
  const catalogue = [BLUE_LAGOON, SKY_LAGOON, LAUGARDALSLAUG, VESTURBAEJARLAUG];

  it('takes the slug first, an exact key, and searches no name for it', async () => {
    const { lookup: lookupFn, asked } = fakeLookup(catalogue);
    const cards = await resolveVenueCards(payload([{ id: 'sky-lagoon', name: 'Sky' }]), lookupFn);
    expect(cards).toEqual([SKY_LAGOON]);
    expect(asked).toEqual(['slug:sky-lagoon']);
  });

  it('a made-up slug falls through to the name, which is validated', async () => {
    const { lookup: lookupFn, asked } = fakeLookup(catalogue);
    const cards = await resolveVenueCards(
      payload([{ id: 'the-retreat', name: 'The Retreat at Blue Lagoon' }]),
      lookupFn,
    );
    // "The Retreat at Blue Lagoon" is no substring of any name: the first
    // pass finds nothing, the first-word retry ("The") is too short.
    expect(cards).toEqual([]);
    expect(asked).toEqual(['slug:the-retreat', 'q:The Retreat at Blue Lagoon']);
  });

  it('accepts an exact name (any case), else a corresponding one, never the first loose hit', async () => {
    const pools = [venue(10, 'Lagoon Bar'), BLUE_LAGOON, SKY_LAGOON];
    const { lookup: lookupFn } = fakeLookup(pools);
    expect(await resolveVenueCards(payload([{ name: 'sky lagoon' }]), lookupFn)).toEqual([SKY_LAGOON]);

    // "Lagoon" hits all three; only Blue Lagoon Retreat's every word is in the AI's name.
    const loose: VenueLookup = { bySlug: lookupFn.bySlug, search: async () => pools };
    expect(await resolveVenueCards(payload([{ name: 'Retreat at the Blue Lagoon' }]), loose)).toEqual([BLUE_LAGOON]);
  });

  it('retries once with each first word of 4+ characters when no name resolved, still validated', async () => {
    const { lookup: lookupFn, asked } = fakeLookup(catalogue);
    const cards = await resolveVenueCards(
      payload([{ name: 'Laugardalslaug swimming pool' }, { name: 'The spa' }, { name: 'Sky' }]),
      lookupFn,
    );
    expect(cards).toEqual([LAUGARDALSLAUG]);
    expect(asked).toEqual([
      'q:Laugardalslaug swimming pool',
      'q:The spa',
      'q:Sky',
      // "The" and "Sky" are too short to search on their own.
      'q:Laugardalslaug',
    ]);
  });

  it('does not retry when the first pass found something', async () => {
    const { lookup: lookupFn, asked } = fakeLookup(catalogue);
    const cards = await resolveVenueCards(payload([{ name: 'Sky Lagoon' }, { name: 'Laugardalslaug pool' }]), lookupFn);
    expect(cards).toEqual([SKY_LAGOON]);
    expect(asked).toEqual(['q:Sky Lagoon', 'q:Laugardalslaug pool']);
  });

  it('keeps the model order and drops duplicates', async () => {
    const { lookup: lookupFn } = fakeLookup(catalogue);
    const cards = await resolveVenueCards(
      payload([
        { id: 'laugardalslaug' },
        { id: 'sky-lagoon' },
        { id: 'laugardalslaug' },
        { name: 'Sky Lagoon' },
        { name: 'Vesturbæjarlaug' },
      ]),
      lookupFn,
    );
    expect(cards).toEqual([LAUGARDALSLAUG, SKY_LAGOON, VESTURBAEJARLAUG]);
  });

  it('never throws: a failed search just resolves nothing', async () => {
    const { lookup: lookupFn } = fakeLookup(catalogue, { searchFails: true });
    await expect(resolveVenueCards(payload([{ id: 'nope', name: 'Laugardalslaug' }]), lookupFn)).resolves.toEqual([]);
  });

  it('a card with neither slug nor name is skipped', async () => {
    const { lookup: lookupFn, asked } = fakeLookup(catalogue);
    expect(await resolveVenueCards(payload([{ location: 'Reykjavík' }]), lookupFn)).toEqual([]);
    expect(asked).toEqual([]);
  });

  describe('over the API', () => {
    stubApiClientPerTest();

    it('asks GET /venues/by-slug/{slug}, then GET /venues?q=<name>', async () => {
      api.on('GET', '/venues/by-slug/:slug', ({ params }) =>
        params.slug === 'sky-lagoon' ? Reply.ok(venueToApi(SKY_LAGOON)) : Reply.problem(404, 'not_found'),
      );
      api.on('GET', '/venues', () =>
        Reply.ok({ data: [venueToApi(LAUGARDALSLAUG)], pagination: { nextCursor: null, hasMore: false, limit: 50 } }),
      );
      const cards = await resolveVenueCards(
        payload([{ id: 'sky-lagoon', name: 'Sky Lagoon' }, { id: 'made-up', name: 'Laugardalslaug' }]),
      );
      expect(cards.map((card) => card.slug)).toEqual(['sky-lagoon', 'laugardalslaug']);
      expect(api.sentAll('/venues/by-slug/made-up')).toHaveLength(1);
      expect(api.sent('/venues', 'GET').query.q).toBe('Laugardalslaug');
    });
  });
});

// ---------------------------------------------------------------------------

describe('venuesReplyAsText', () => {
  it('lists the named cards under the intro, with the explore nudge', () => {
    const text = venuesReplyAsText(
      payload([{ name: 'Sky Lagoon', location: 'Kópavogur' }, { name: 'Laugardalslaug' }, { location: 'Nowhere' }], ' Try these. '),
      t,
    );
    expect(text).toBe(`Try these.\n\n• Sky Lagoon, Kópavogur\n• Laugardalslaug\n\n${t('coach.explore_nudge')}`);
  });

  it('never shows raw JSON: with no intro and no name, the explore fallback alone', () => {
    expect(venuesReplyAsText(payload([{ location: 'Reykjavík' }], null), t)).toBe(t('coach.explore_fallback'));
    expect(venuesReplyAsText({ type: 'venues', intro: '   ', venues: null }, t)).toBe(t('coach.explore_fallback'));
  });

  it('keeps an intro with no cards', () => {
    expect(venuesReplyAsText(payload([], 'Nothing matched.'), t)).toBe(`Nothing matched.\n\n${t('coach.explore_nudge')}`);
  });
});
