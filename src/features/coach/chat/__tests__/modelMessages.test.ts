/**
 * The history a free chat sends to the model (iOS
 * `CoachViewModel.modelMessages()`): the one place a chat turn can leave the
 * phone for the AI.
 *
 * Ports the model-side half of CoachPersistenceTests and
 * CoachAdjustPrivacyTests.testNoneOfItReachesTheModel (health turns never
 * sent), and the two fixes of the first Android build: a chat past 20 turns
 * returned 400 for good (no cap), and one long dictation refused the whole
 * request (no per-turn cut).
 */
import { lookup } from '../../../../i18n';
import { greetingMessage, type CoachMessage } from '../../store/messages';
import { MODEL_TURN_LIMIT, MODEL_TURN_UTF16_LIMIT, modelMessages } from '../modelMessages';

const greeting = greetingMessage(lookup('coach.greeting', 'en'));

function turn(id: number, role: 'user' | 'assistant', text: string, extra: Partial<CoachMessage> = {}): CoachMessage {
  return { id: String(id), role, text, ...extra };
}

describe('modelMessages', () => {
  it('sends the greeting and the real conversation, and no health turn (testNoneOfItReachesTheModel)', () => {
    const messages: CoachMessage[] = [
      greeting,
      turn(101, 'user', 'where can I swim tonight?'),
      turn(102, 'assistant', 'Laugardalslaug is open until 22.'),
      turn(103, 'user', 'Adjust my plan', { isHealth: true }),
      turn(104, 'assistant', 'What would you like to change?', {
        isHealth: true,
        flow: 'adjust',
        options: [{ label: 'My goal', value: 'goal' }],
      }),
      turn(105, 'user', 'I want to lose 10 kg', { isHealth: true }),
      turn(106, 'assistant', 'Your plan is updated.', { isHealth: true }),
    ];
    expect(modelMessages(messages)).toEqual([
      { role: 'assistant', content: lookup('coach.greeting', 'en') },
      { role: 'user', content: 'where can I swim tonight?' },
      { role: 'assistant', content: 'Laugardalslaug is open until 22.' },
    ]);
  });

  it('drops question bubbles (answered or not) and category strips', () => {
    const messages: CoachMessage[] = [
      greeting,
      turn(101, 'user', "What's nearby?"),
      turn(102, 'assistant', 'What would you like to find nearby?', { showCategoryStrip: true }),
      turn(103, 'user', 'Gyms'),
      turn(104, 'assistant', 'Where?', {
        flow: 'venueWizard',
        options: [{ label: 'Near me', value: 'near' }],
        answered: true,
        selectedAnswer: 'Near me',
      }),
      turn(105, 'assistant', 'What time?', { flow: 'venueWizard', options: [{ label: 'Now', value: 'now' }] }),
      turn(106, 'user', 'is the pool open late?'),
    ];
    expect(modelMessages(messages).map((message) => message.content)).toEqual([
      lookup('coach.greeting', 'en'),
      "What's nearby?",
      'Gyms',
      'is the pool open late?',
    ]);
  });

  it("keeps a venue-card reply as its intro (the AI's own words)", () => {
    const messages: CoachMessage[] = [
      turn(101, 'user', 'somewhere quiet to relax?'),
      turn(102, 'assistant', 'Here are two calm spas.', { venues: [] }),
      turn(103, 'user', 'which is closer?'),
    ];
    expect(modelMessages(messages)).toEqual([
      { role: 'user', content: 'somewhere quiet to relax?' },
      { role: 'assistant', content: 'Here are two calm spas.' },
      { role: 'user', content: 'which is closer?' },
    ]);
  });

  it('sends the last 20 turns only, so a chat past 20 turns still answers', () => {
    const messages: CoachMessage[] = [greeting];
    for (let index = 0; index < 30; index += 1) {
      messages.push(turn(200 + index, index % 2 === 0 ? 'user' : 'assistant', `turn ${index}`));
    }
    const sent = modelMessages(messages);
    expect(MODEL_TURN_LIMIT).toBe(20);
    expect(sent).toHaveLength(20);
    expect(sent[0]!.content).toBe('turn 10');
    expect(sent[19]!.content).toBe('turn 29');
  });

  it('counts the 20 after the filter: hidden turns never push a real one out', () => {
    const messages: CoachMessage[] = [];
    for (let index = 0; index < 20; index += 1) messages.push(turn(300 + index, 'user', `real ${index}`));
    for (let index = 0; index < 10; index += 1) {
      messages.push(turn(400 + index, 'assistant', `secret ${index}`, { isHealth: true }));
    }
    const sent = modelMessages(messages).map((message) => message.content);
    expect(sent).toHaveLength(20);
    expect(sent[0]).toBe('real 0');
    expect(sent.some((content) => content.startsWith('secret'))).toBe(false);
  });

  it('cuts each turn to 3,900 UTF-16 units without splitting a character', () => {
    expect(MODEL_TURN_UTF16_LIMIT).toBe(3_900);
    // A long dictation whose 3,900th unit falls inside an emoji.
    const dictation = `${'word '.repeat(779)}abcd😀 tail`;
    const sent = modelMessages([turn(101, 'user', dictation), turn(102, 'user', '😀'.repeat(2_500))]);
    for (const message of sent) {
      expect(message.content.length).toBeLessThanOrEqual(3_900);
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(message.content)).toBe(false);
    }
    expect(sent[0]!.content).toBe(`${'word '.repeat(779)}abcd`);
    expect(sent[1]!.content).toBe('😀'.repeat(1_950));
  });

  it('maps roles to the wire words', () => {
    expect(modelMessages([turn(1, 'user', 'a'), turn(2, 'assistant', 'b')]).map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
  });
});
