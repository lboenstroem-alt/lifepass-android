/**
 * The Coach's saved chats on disk (iOS `CoachViewModel` session persistence):
 * three at most, text and a class answer's cards, no health turn ever, owned
 * by one member.
 *
 * The store-level cases of CoachPersistenceTests (a chat saved by New chat)
 * are in ../../store/__tests__/coachStore.test.ts; the sign-in and sign-out
 * hooks through the app's registry are F3's, in
 * src/stores/__tests__/signOutPrivacy.test.ts. These are the rules
 * themselves, and what the first build left on phones.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { CARDS_EN, dataOf } from '../../chat/__tests__/classCardFixtures';
import { decodeCoachChatReply } from '../../chat/coachApi';
import type { CoachMessage } from '../../store/messages';
import {
  buildSession,
  claimSavedCoachSessions,
  COACH_SESSIONS_KEY,
  COACH_SESSIONS_OWNER_KEY,
  forgetSavedCoachSessions,
  loadSavedSessions,
  MAX_SESSIONS,
  messagesFromSession,
  onSessionsForgotten,
  sessionTitle,
  upsertSession,
  writeSavedSessions,
  type ChatSession,
} from '../sessions';

const MEMBER_A = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const MEMBER_B = '3c4c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c22';

function message(id: string, role: 'user' | 'assistant', text: string, extra: Partial<CoachMessage> = {}): CoachMessage {
  return { id, role, text, ...extra };
}

function session(id: string, title = id): ChatSession {
  return { id, title, date: '2026-10-01T10:00:00.000Z', messages: [{ id: '101', role: 'user', text: title }] };
}

async function stored(): Promise<unknown> {
  const raw = await AsyncStorage.getItem(COACH_SESSIONS_KEY);
  return raw === null ? null : JSON.parse(raw);
}

// ---------------------------------------------------------------------------

describe('building a session', () => {
  it('keeps text only: no question bubbles, category strips, venue cards or health turns', () => {
    const built = buildSession(
      [
        message('m0', 'assistant', 'Hi!'),
        message('101', 'user', 'where can I swim?'),
        message('102', 'assistant', 'Where?', { flow: 'venueWizard', options: [{ label: 'Near me', value: 'near' }] }),
        message('103', 'assistant', 'Here are three pools.', {
          venues: [{ id: 'v1' } as never],
        }),
        message('104', 'assistant', 'What would you like to find nearby?', { showCategoryStrip: true }),
        message('105', 'user', 'Build muscle', { isHealth: true }),
        message('106', 'assistant', 'Where is the injury?', { isHealth: true }),
      ],
      null,
      new Date('2026-10-17T12:00:00Z'),
    );
    expect(built).not.toBeNull();
    expect(built!.messages).toEqual([
      { id: 'm0', role: 'assistant', text: 'Hi!' },
      { id: '101', role: 'user', text: 'where can I swim?' },
      { id: '103', role: 'assistant', text: 'Here are three pools.' },
    ]);
    expect(built!.date).toBe('2026-10-17T12:00:00.000Z');
    // A new chat gets a UUID, as iOS does.
    expect(built!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('a chat of only health turns is not saved at all (testAChatOfOnlyHealthTurnsIsNotSavedAtAll)', () => {
    expect(
      buildSession(
        [
          message('m0', 'assistant', 'Hi!'),
          message('101', 'user', 'Get a 4-week plan', { isHealth: true }),
          message('102', 'assistant', 'What is your main goal?', { isHealth: true }),
        ],
        null,
      ),
    ).toBeNull();
    expect(buildSession([message('m0', 'assistant', 'Hi!')], null)).toBeNull();
  });

  it('a health turn never titles a session (testAHealthTurnNeverTitlesASavedSession)', () => {
    const messages = [
      message('101', 'user', 'Lose weight', { isHealth: true }),
      message('102', 'user', '  any pools nearby?  '),
    ];
    expect(sessionTitle(messages)).toBe('any pools nearby?');
    expect(buildSession(messages, null)!.title).toBe('any pools nearby?');
  });

  it('a title over 40 characters is cut to 37 and an ellipsis, never through a character', () => {
    expect(sessionTitle([message('1', 'user', 'a'.repeat(40))])).toBe('a'.repeat(40));
    expect(sessionTitle([message('1', 'user', 'a'.repeat(41))])).toBe(`${'a'.repeat(37)}…`);
    const flags = '🇮🇸'.repeat(41);
    expect(sessionTitle([message('1', 'user', flags)])).toBe(`${'🇮🇸'.repeat(37)}…`);
  });

  it('keeps the id it was saved or restored under, so saving again replaces it', () => {
    expect(buildSession([message('1', 'user', 'pools?')], 'session-1')!.id).toBe('session-1');
  });
});

describe('the list', () => {
  it('upserts by id, newest first, three at most', () => {
    expect(MAX_SESSIONS).toBe(3);
    let list: ChatSession[] = [];
    for (const id of ['a', 'b', 'c']) list = upsertSession(list, session(id));
    expect(list.map((entry) => entry.id)).toEqual(['c', 'b', 'a']);

    // Saving "a" again moves it to the top, without a duplicate.
    list = upsertSession(list, session('a', 'a again'));
    expect(list.map((entry) => entry.id)).toEqual(['a', 'c', 'b']);
    expect(list[0]!.title).toBe('a again');

    // A fourth pushes the oldest out.
    list = upsertSession(list, session('d'));
    expect(list.map((entry) => entry.id)).toEqual(['d', 'a', 'c']);
  });

  it('a restored session comes back as text messages with their ids', () => {
    expect(messagesFromSession(session('a', 'pools?'))).toEqual([{ id: '101', role: 'user', text: 'pools?' }]);
  });
});

// ---------------------------------------------------------------------------

describe('on disk', () => {
  it('writes and reads back what it wrote', async () => {
    await writeSavedSessions([session('a'), session('b')]);
    expect(await loadSavedSessions()).toEqual([session('a'), session('b')]);
  });

  it("reads the first build's chats the new way: three at most, text only", async () => {
    // What the first Android build stored: four sessions, 's-<time>' ids,
    // venue cards, search queries and the strip's "explore more" prompts.
    await AsyncStorage.setItem(
      COACH_SESSIONS_KEY,
      JSON.stringify(
        [1, 2, 3, 4].map((n) => ({
          id: `s-${n}`,
          title: `Chat ${n}`,
          date: '2026-09-01T10:00:00.000Z',
          messages: [
            { id: '1', role: 'user', text: 'Gyms near me' },
            {
              id: '2',
              role: 'assistant',
              text: 'Here are some gyms.',
              venueCards: [{ id: 'x', name: 'Gym' }],
              searchQuery: 'gym',
            },
            { id: '3', role: 'assistant', text: 'Want to explore something else?', categoryPicker: true },
            { id: '4', role: 'system', text: 'not a turn' },
            'garbage',
          ],
        })),
      ),
    );
    const sessions = await loadSavedSessions();
    expect(sessions.map((entry) => entry.id)).toEqual(['s-1', 's-2', 's-3']);
    expect(sessions[0]!.messages).toEqual([
      { id: '1', role: 'user', text: 'Gyms near me' },
      { id: '2', role: 'assistant', text: 'Here are some gyms.' },
    ]);
  });

  it("keeps a reply's class cards in the server's shape, and reads them back card for card", async () => {
    const cards = decodeCoachChatReply(dataOf(CARDS_EN)).classes;
    const built = buildSession(
      [
        message('1', 'user', 'Are there any classes in Akureyri today?'),
        message('2', 'assistant', 'Here are classes in Akureyri today. Tap one to book.', {
          classCards: cards,
          classCardsHidden: true,
          anchorTop: true,
        }),
      ],
      'saved-1',
    )!;
    // The member's own turn never carries cards; the closed state is not kept.
    expect(built.messages[0]).toEqual({ id: '1', role: 'user', text: 'Are there any classes in Akureyri today?' });
    expect(built.messages[1]!.classCards).toEqual(cards);
    expect(built.messages[1]).not.toHaveProperty('classCardsHidden');

    await writeSavedSessions([built]);
    const raw = JSON.parse((await AsyncStorage.getItem(COACH_SESSIONS_KEY))!) as {
      messages: { classCards?: Record<string, unknown>[] }[];
    }[];
    const stored = raw[0]!.messages[1]!.classCards!;
    expect(stored[0]!.startsAt).toBe('2026-10-13T12:10:00.000Z');
    expect(stored[3]!.booking).toEqual({
      kind: 'slot',
      activityId: 'd9b7a1c3-6e2f-4a8d-b5c4-3e1f7a9d0c88',
      startsAt: '2026-10-13T19:30:00.000Z',
      endsAt: '2026-10-13T20:00:00.000Z',
    });

    const [loaded] = await loadSavedSessions();
    expect(loaded!.messages[1]!.classCards).toEqual(cards);
    const restored = messagesFromSession(loaded!);
    expect(restored[1]!.classCards).toEqual(cards);
    expect(restored[1]!.classCards![3]!.booking?.slotEndsAt).toEqual(new Date('2026-10-13T20:00:00Z'));
    expect(restored[0]!.classCards).toBeUndefined();
  });

  it('chats without cards, or with cards this build cannot read, still load (testSavedChatsWithoutOrWithUnreadableCardsStillLoad)', async () => {
    const card = {
      id: 'cls_1',
      title: 'HOT FIT',
      startsAt: '2026-10-13T12:10:00.000Z',
      endsAt: '2026-10-13T13:10:00.000Z',
      venueSlug: 'nordur-akureyri',
      venueName: 'Nordur Akureyri',
      booking: { kind: 'class', activityId: '6b1f0c52-3a7e-4d19-8f2a-0c9d4e5b7a11', eventId: 7 },
    };
    await AsyncStorage.setItem(
      COACH_SESSIONS_KEY,
      JSON.stringify([
        {
          id: 's1',
          title: 'classes',
          date: '1970-01-01T00:00:00.000Z',
          messages: [
            { id: '1', role: 'user', text: 'classes?' },
            { id: '2', role: 'assistant', text: 'Old reply' },
            { id: '3', role: 'assistant', text: 'New reply', classCards: [{ id: 'x' }, 42, card] },
            { id: '4', role: 'assistant', text: 'Garbled', classCards: 'nope' },
          ],
        },
      ]),
    );
    const [loaded] = await loadSavedSessions();
    expect(loaded!.messages.map((entry) => entry.text)).toEqual(['classes?', 'Old reply', 'New reply', 'Garbled']);
    expect(loaded!.messages[1]!.classCards).toBeUndefined();
    // The bad cards dropped, the good one kept.
    expect(loaded!.messages[2]!.classCards?.map((entry) => entry.id)).toEqual(['cls_1']);
    expect(loaded!.messages[3]!.classCards).toBeUndefined();
  });

  it('an unreadable store reads as no chats', async () => {
    await AsyncStorage.setItem(COACH_SESSIONS_KEY, '{not json');
    expect(await loadSavedSessions()).toEqual([]);
    await AsyncStorage.setItem(COACH_SESSIONS_KEY, JSON.stringify({ sessions: [] }));
    expect(await loadSavedSessions()).toEqual([]);
    await AsyncStorage.setItem(COACH_SESSIONS_KEY, JSON.stringify([{ id: 7 }, session('ok')]));
    expect((await loadSavedSessions()).map((entry) => entry.id)).toEqual(['ok']);
  });
});

// ---------------------------------------------------------------------------

describe('whose chats they are (SignOutPrivacyTests)', () => {
  async function saveAChat(): Promise<void> {
    await writeSavedSessions([session('s-1', 'Pools near Laugardalur?')]);
  }

  it("the next account never sees the first account's chats", async () => {
    await claimSavedCoachSessions(MEMBER_A, false);
    await saveAChat();
    await claimSavedCoachSessions(MEMBER_B, false);
    expect(await stored()).toBeNull();
    expect(await AsyncStorage.getItem(COACH_SESSIONS_OWNER_KEY)).toBe(MEMBER_B);
  });

  it('the same member keeps theirs, whatever the case of the id', async () => {
    await claimSavedCoachSessions(MEMBER_A, false);
    await saveAChat();
    await claimSavedCoachSessions(MEMBER_A.toUpperCase(), true);
    expect(await loadSavedSessions()).toHaveLength(1);
    expect(await AsyncStorage.getItem(COACH_SESSIONS_OWNER_KEY)).toBe(MEMBER_A);
  });

  it('chats with no owner go to a restored session only', async () => {
    await saveAChat();
    await claimSavedCoachSessions(MEMBER_A, true);
    expect(await loadSavedSessions()).toHaveLength(1);

    await AsyncStorage.multiRemove([COACH_SESSIONS_KEY, COACH_SESSIONS_OWNER_KEY]);
    await saveAChat();
    await claimSavedCoachSessions(MEMBER_B, false);
    expect(await loadSavedSessions()).toHaveLength(0);
  });

  it('forgetting removes both keys and tells every Coach screen still holding them', async () => {
    await claimSavedCoachSessions(MEMBER_A, false);
    await saveAChat();
    const heard: string[] = [];
    const unsubscribe = onSessionsForgotten(() => heard.push('forgotten'));
    // One listener that throws must not keep the next from hearing.
    const unsubscribeBroken = onSessionsForgotten(() => {
      throw new Error('a broken screen');
    });
    const later: string[] = [];
    const unsubscribeLater = onSessionsForgotten(() => later.push('forgotten'));
    try {
      await forgetSavedCoachSessions();
    } finally {
      unsubscribe();
      unsubscribeBroken();
      unsubscribeLater();
    }
    expect(await AsyncStorage.getItem(COACH_SESSIONS_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(COACH_SESSIONS_OWNER_KEY)).toBeNull();
    expect(heard).toEqual(['forgotten']);
    expect(later).toEqual(['forgotten']);
  });
});
