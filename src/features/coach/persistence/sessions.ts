/**
 * The Coach's saved chats (the drawer's RECENTS): the Android port of iOS
 * `CoachViewModel`'s session persistence (ViewModels/CoachViewModel.swift).
 *
 * WHAT IS KEPT. Up to three chats, newest first, each `{ id, title, date,
 * messages: [{ id, role, text }] }`. TEXT ONLY: no question bubbles, no
 * category strips, no venue cards (a card reply keeps its intro), and no
 * health turn ever (privacy policy 2.A, ruling 2). A chat made only of
 * health turns is not saved at all, and a health turn never titles one. The
 * first build kept four chats with their venue cards and every Q&A answer;
 * what it saved is read back the new way (text only, three at most).
 *
 * WHOSE THEY ARE. The chats are one member's typed words, so they never
 * outlive that member's session on this phone and are never shown to, or
 * sent to the Coach under, another account. `coach.sessions.owner` holds the
 * member id: at a sign-in, chats owned by anyone else are deleted; chats
 * saved before chats had an owner go only to a RESTORED session (the member
 * who was signed in when the update arrived), never to a fresh sign-in.
 * Sign-out and an account deletion remove both keys, and any Coach screen
 * still holding them drops its recents (`onSessionsForgotten`).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

import { isConversationTurn, type CoachMessage, type CoachRole } from '../store/messages';
import { characterCount, prefixCharacters } from '../chat/text';

/** Where the Coach keeps its saved chats (iOS uses the same key). */
export const COACH_SESSIONS_KEY = 'coach.sessions.v1';
/** Whose chats they are: the member id, lower case. */
export const COACH_SESSIONS_OWNER_KEY = 'coach.sessions.owner';
/** How many chats the drawer keeps (iOS keeps 3). */
export const MAX_SESSIONS = 3;
/** A title longer than this is cut to `TITLE_CUT` characters and an ellipsis. */
export const TITLE_LIMIT = 40;
const TITLE_CUT = 37;

export interface PersistedMessage {
  readonly id: string;
  readonly role: CoachRole;
  readonly text: string;
}

export interface ChatSession {
  readonly id: string;
  /** The first thing the member said (not a health turn), cut to 40 characters. */
  readonly title: string;
  /** ISO time of the last save. */
  readonly date: string;
  readonly messages: readonly PersistedMessage[];
}

/** A drawer row. */
export interface RecentChat {
  readonly id: string;
  readonly title: string;
}

// ---------------------------------------------------------------------------
// Reading and writing

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One stored message as text, or null when it is not a conversation turn:
 * the first build also saved its "explore something else?" strip prompts
 * (`categoryPicker`), which iOS never saves.
 */
function readMessage(value: unknown): PersistedMessage | null {
  if (!isObject(value)) return null;
  const { id, role, text } = value;
  if (typeof id !== 'string' || typeof text !== 'string') return null;
  if (role !== 'user' && role !== 'assistant') return null;
  if (value.categoryPicker === true || value.isHealth === true) return null;
  return { id, role, text };
}

function readSession(value: unknown): ChatSession | null {
  if (!isObject(value)) return null;
  const { id, title, date, messages } = value;
  if (typeof id !== 'string' || typeof title !== 'string' || !Array.isArray(messages)) return null;
  return {
    id,
    title,
    date: typeof date === 'string' ? date : new Date(0).toISOString(),
    messages: messages.map(readMessage).filter((message): message is PersistedMessage => message !== null),
  };
}

/** The saved chats, newest first; an unreadable store reads as none. */
export async function loadSavedSessions(): Promise<ChatSession[]> {
  try {
    const raw = await AsyncStorage.getItem(COACH_SESSIONS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(readSession)
      .filter((session): session is ChatSession => session !== null)
      .slice(0, MAX_SESSIONS);
  } catch {
    return [];
  }
}

/** Writes the list (best effort: a failed write only costs the recents). */
export async function writeSavedSessions(sessions: readonly ChatSession[]): Promise<void> {
  try {
    await AsyncStorage.setItem(COACH_SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // Nothing to tell the member: the chat on screen is untouched.
  }
}

// ---------------------------------------------------------------------------
// Building a session

/**
 * A new session's id: a v4 UUID, as iOS `UUID().uuidString`. expo-crypto
 * always answers on a phone; Jest's generated native mock answers
 * `undefined`, and two sessions with no id would replace each other in the
 * upsert, so a UUID is built from Math.random there (it only has to be
 * unique, it is not a secret).
 */
function newSessionId(): string {
  const id = Crypto.randomUUID();
  if (typeof id === 'string' && id.length > 0) return id;
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** The drawer title: the first non-health thing the member said, cut at 40 characters. */
export function sessionTitle(messages: readonly CoachMessage[]): string | null {
  const first = messages.find((message) => message.role === 'user' && !message.isHealth);
  if (!first) return null;
  const raw = first.text.trim();
  return characterCount(raw) > TITLE_LIMIT ? `${prefixCharacters(raw, TITLE_CUT)}…` : raw;
}

/**
 * The chat on screen as a saved session, or null when it holds nothing worth
 * keeping (no non-health user turn). `id` is the session it was saved or
 * restored as, so saving again replaces that entry; a fresh chat gets a new
 * one.
 */
export function buildSession(
  messages: readonly CoachMessage[],
  id: string | null,
  now: Date = new Date(),
): ChatSession | null {
  const title = sessionTitle(messages);
  if (title === null) return null;
  return {
    id: id ?? newSessionId(),
    title,
    date: now.toISOString(),
    messages: messages
      .filter(isConversationTurn)
      .map((message) => ({ id: message.id, role: message.role, text: message.text })),
  };
}

/** Upserted by id, newest first, three at most: saving the same chat again moves it to the top. */
export function upsertSession(sessions: readonly ChatSession[], session: ChatSession): ChatSession[] {
  return [session, ...sessions.filter((existing) => existing.id !== session.id)].slice(0, MAX_SESSIONS);
}

/** A saved session back as chat messages (text only). */
export function messagesFromSession(session: ChatSession): CoachMessage[] {
  return session.messages.map((message) => ({ id: message.id, role: message.role, text: message.text }));
}

// ---------------------------------------------------------------------------
// Whose chats they are

const forgottenListeners = new Set<() => void>();

/** Called when the saved chats are forgotten (sign-out, an account deletion). Returns an unsubscribe. */
export function onSessionsForgotten(listener: () => void): () => void {
  forgottenListeners.add(listener);
  return () => {
    forgottenListeners.delete(listener);
  };
}

/**
 * At sign-in and session restore (iOS `claimSavedSessions`): the saved chats
 * stay only when they are this member's. Someone else's are deleted; chats
 * with no owner go only to a restored session.
 */
export async function claimSavedCoachSessions(userId: string, restoredSession: boolean): Promise<void> {
  const id = userId.toLowerCase();
  const owner = await AsyncStorage.getItem(COACH_SESSIONS_OWNER_KEY);
  if (owner === id) return;
  if (owner !== null || !restoredSession) {
    await AsyncStorage.removeItem(COACH_SESSIONS_KEY);
  }
  await AsyncStorage.setItem(COACH_SESSIONS_OWNER_KEY, id);
}

/** Sign-out and an account deletion (iOS `forgetSavedSessions`): the chats and their owner go, on disk and on screen. */
export async function forgetSavedCoachSessions(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([COACH_SESSIONS_KEY, COACH_SESSIONS_OWNER_KEY]);
  } finally {
    for (const listener of [...forgottenListeners]) {
      try {
        listener();
      } catch {
        // One screen's listener must not keep the others holding the chats.
      }
    }
  }
}
