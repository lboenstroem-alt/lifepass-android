// "Want to try something new?": the category rail and the ask card's chips,
// and the ask field's Return rule. The Android port of iOS
// `homeCoachCategories`, `askChips` and `HomeCoachInput` (Views/Home/HomeView.swift).
//
// THE PROMPTS ARE IOS'S, BYTE FOR BYTE, and stay English for every account:
// they are sent to the Coach, whose intent matching runs on English wording.
// Two of them carry a routing contract:
//   - "Suggest gym classes I should try this week." must stay exact: 2.5.3
//     keeps it opening the gym venue search.
//   - The Lagoon chip asks about lagoons ONLY. The shared "spa or lagoon
//     evening" wording routes to the SPA wizard (spa is matched before
//     lagoon), which would contradict the chip's label. The Spa card keeps
//     that wording on purpose.
// The labels are the generated iOS keys, in the account language.
import type { ImageSourcePropType } from 'react-native';

export interface HomeCoachCategory {
  /** The picture's name (iOS imageset; Android assets/categories/<id>.jpg). */
  readonly id: 'pools' | 'gyms' | 'wellness' | 'golf' | 'spa' | 'yoga';
  readonly labelKey: string;
  readonly prompt: string;
  readonly image: ImageSourcePropType;
}

export const HOME_COACH_CATEGORIES: readonly HomeCoachCategory[] = [
  {
    id: 'pools',
    labelKey: 'coach.cat.pools',
    prompt: 'I want to try Icelandic swimming pools — which ones are best to start with this week?',
    image: require('../../../assets/categories/pools.jpg'),
  },
  {
    id: 'gyms',
    labelKey: 'coach.cat.gyms',
    prompt: 'Suggest gym classes I should try this week.',
    image: require('../../../assets/categories/gyms.jpg'),
  },
  {
    id: 'wellness',
    labelKey: 'coach.cat.wellness',
    prompt: "I'd like a relaxing wellness day — what do you suggest?",
    image: require('../../../assets/categories/wellness.jpg'),
  },
  {
    id: 'golf',
    labelKey: 'coach.cat.golf',
    prompt: 'Tell me about golf options available through LifePass.',
    image: require('../../../assets/categories/golf.jpg'),
  },
  {
    id: 'spa',
    labelKey: 'coach.cat.spa',
    prompt: 'Plan a perfect spa or lagoon evening for me.',
    image: require('../../../assets/categories/spa.jpg'),
  },
  {
    id: 'yoga',
    labelKey: 'coach.cat.yoga',
    prompt: "I'm new to yoga — where should I start in Reykjavík?",
    image: require('../../../assets/categories/yoga.jpg'),
  },
];

export interface HomeAskChip {
  readonly labelKey: string;
  readonly prompt: string;
}

export const HOME_ASK_CHIPS: readonly HomeAskChip[] = [
  // Lagoon only (see the file comment).
  { labelKey: 'coach.chip.lagoon', prompt: 'I love geothermal lagoons — which ones should I try next in Iceland?' },
  { labelKey: 'home.chip.sweat', prompt: 'I have 30 minutes — what is a quick high-intensity workout?' },
  { labelKey: 'coach.chip.after_work', prompt: "It's after 6pm. What's a good way to wind down nearby?" },
];

/**
 * The ask field's Return key (iOS `HomeCoachInput.returnPressed`, 2.5.4): the
 * text without the new line(s) Return just added at the end, any other new
 * line read as a space; or null when the last change did not end in a new
 * line (typing, or a paste with lines in the middle).
 */
export function returnPressed(text: string): string | null {
  if (!text.endsWith('\n')) return null;
  let cleaned = text;
  while (cleaned.endsWith('\n')) cleaned = cleaned.slice(0, -1);
  return cleaned.split('\n').join(' ');
}

/** What a change to the ask field means. */
export type AskFieldChange =
  /** Keep this text in the field (new lines from a paste are spaces: the Coach reads one line). */
  | { readonly kind: 'text'; readonly text: string }
  /** Return on a field with nothing to send: the keyboard goes, the field keeps `text`. */
  | { readonly kind: 'dismiss'; readonly text: string }
  /** Return with something to send: send `text` (trimmed by the sender). */
  | { readonly kind: 'send'; readonly text: string };

/**
 * One change to the field, the way iOS's `onChange` reads it. Android's IME
 * action (`submitBehavior="blurAndSubmit"`) normally sends without a new line
 * reaching the field; this covers a keyboard that types one anyway (a
 * hardware keyboard, some IMEs) and pasted lines.
 */
export function askFieldChange(text: string): AskFieldChange {
  const cleaned = returnPressed(text);
  if (cleaned === null) return { kind: 'text', text: text.includes('\n') ? text.split('\n').join(' ') : text };
  return cleaned.trim().length === 0 ? { kind: 'dismiss', text: cleaned } : { kind: 'send', text: cleaned };
}
