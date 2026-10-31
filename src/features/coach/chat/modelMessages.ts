/**
 * The `messages` a free chat sends to the model (iOS
 * `CoachViewModel.modelMessages()`): the one place a chat turn can leave the
 * phone for the AI, so the one place the health filter has to hold.
 *
 * - Question bubbles, category strips and every `isHealth` turn are left
 *   out. A venue-card reply stays, as its intro (the AI's own words).
 * - The last 20 turns only: the server refuses more than 20 (a chat used to
 *   answer 400 for good once it passed 20 messages).
 * - Each turn cut to 3,900 UTF-16 units without splitting a character: the
 *   server allows 4,000 per turn, and a single over-long turn (a long
 *   dictation or paste) would refuse the WHOLE request.
 *
 * The server drops leading assistant turns (the greeting) itself.
 */
import { isConversationTurn, type CoachMessage } from '../store/messages';
import type { CoachApiMessage } from './coachApi';
import { truncatedToUTF16 } from './text';

/** The server's `messages.max(20)`. */
export const MODEL_TURN_LIMIT = 20;
/** Under the server's 4,000 units per turn, with headroom. */
export const MODEL_TURN_UTF16_LIMIT = 3_900;

export function modelMessages(messages: readonly CoachMessage[]): CoachApiMessage[] {
  return messages
    .filter(isConversationTurn)
    .slice(-MODEL_TURN_LIMIT)
    .map((message) => ({
      role: message.role === 'user' ? 'user' : 'assistant',
      content: truncatedToUTF16(message.text, MODEL_TURN_UTF16_LIMIT),
    }));
}
