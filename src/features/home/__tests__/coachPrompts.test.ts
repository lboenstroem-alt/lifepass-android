/**
 * The prompts Home hands the Coach, and the ask field's Return rule
 * (iOS HomeCoachInputTests, 2.5.4).
 */
import { lookup } from '../../../i18n';
import { askFieldChange, HOME_ASK_CHIPS, HOME_COACH_CATEGORIES, returnPressed } from '../coachPrompts';

describe('HomeCoachInputTests (iOS)', () => {
  it('a new line at the end is Return, recognised and removed', () => {
    expect(returnPressed('yoga tonight\n')).toBe('yoga tonight');
    // Return on an empty field just closes the keyboard.
    expect(returnPressed('\n')).toBe('');
    expect(returnPressed('a\nb\n')).toBe('a b');
    expect(returnPressed('yoga tonight')).toBeNull();
    // A new line in the middle is not Return.
    expect(returnPressed('a\nb')).toBeNull();
  });
});

describe('askFieldChange', () => {
  it('typing keeps the text', () => {
    expect(askFieldChange('quiet swim')).toEqual({ kind: 'text', text: 'quiet swim' });
  });

  it('pasted lines become one line, as the Coach reads it', () => {
    expect(askFieldChange('a quiet\nswim')).toEqual({ kind: 'text', text: 'a quiet swim' });
  });

  it('Return with words sends them; Return on nothing (or spaces) closes the keyboard', () => {
    expect(askFieldChange('quiet swim\n')).toEqual({ kind: 'send', text: 'quiet swim' });
    expect(askFieldChange('\n')).toEqual({ kind: 'dismiss', text: '' });
    expect(askFieldChange('   \n')).toEqual({ kind: 'dismiss', text: '   ' });
  });
});

describe('the prompts are iOS’s, byte for byte', () => {
  it('the six category cards', () => {
    expect(HOME_COACH_CATEGORIES.map((c) => [c.id, c.labelKey, c.prompt])).toEqual([
      ['pools', 'coach.cat.pools', 'I want to try Icelandic swimming pools — which ones are best to start with this week?'],
      // Must stay exact: 2.5.3 keeps it opening the gym venue search.
      ['gyms', 'coach.cat.gyms', 'Suggest gym classes I should try this week.'],
      ['wellness', 'coach.cat.wellness', "I'd like a relaxing wellness day — what do you suggest?"],
      ['golf', 'coach.cat.golf', 'Tell me about golf options available through LifePass.'],
      ['spa', 'coach.cat.spa', 'Plan a perfect spa or lagoon evening for me.'],
      ['yoga', 'coach.cat.yoga', "I'm new to yoga — where should I start in Reykjavík?"],
    ]);
  });

  it('the three chips; the Lagoon chip asks about lagoons only (the spa wording routes to the spa wizard)', () => {
    expect(HOME_ASK_CHIPS.map((c) => [c.labelKey, c.prompt])).toEqual([
      ['coach.chip.lagoon', 'I love geothermal lagoons — which ones should I try next in Iceland?'],
      ['home.chip.sweat', 'I have 30 minutes — what is a quick high-intensity workout?'],
      ['coach.chip.after_work', "It's after 6pm. What's a good way to wind down nearby?"],
    ]);
    expect(HOME_ASK_CHIPS[0]!.prompt.toLowerCase()).not.toContain('spa');
  });

  it('every label is a generated key, in both languages', () => {
    for (const { labelKey } of [...HOME_COACH_CATEGORIES, ...HOME_ASK_CHIPS]) {
      expect(lookup(labelKey, 'en')).not.toBe(labelKey);
      expect(lookup(labelKey, 'is')).not.toBe(labelKey);
    }
    expect(lookup('coach.chip.lagoon', 'is')).toBe('Laugaáhugamaður');
  });
});
