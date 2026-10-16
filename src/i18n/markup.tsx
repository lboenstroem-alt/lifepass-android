// Inline markup inside a translated string: `*italic*` runs and
// `[label](url)` links.
//
// WHY THE STRING CARRIES IT. The onboarding headline and slide titles each
// turn on an italic phrase, and it does not sit in the same place in both
// languages ("you *actually* show up" turns on an adverb, "þú *mætir*" on the
// verb), so the localised string marks the run itself and this turns the
// marks into runs (iOS OnboardingMarkup). Line breaks travel in the string as
// "\n". The Terms lines ("I agree to the [Terms]({terms}) and [Privacy
// Policy]({privacy}).") name their links the same way; iOS renders them with
// SwiftUI's markdown, and the caller fills `{terms}` and `{privacy}` with the
// URLs before the text gets here.
//
// The copy-rule tests (__tests__/copyRules.test.ts) keep the marks paired, so
// a stray mark fails a test rather than drawing an asterisk.
import { useMemo } from 'react';
import { Linking, StyleSheet, Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';

/** A piece of text that is roman or italic (iOS `OnboardingMarkup.Run`). */
export type MarkupRun = { readonly text: string; readonly italic: boolean };

/** A run that may also be a link. */
export type MarkupSegment = MarkupRun & { readonly href?: string };

/**
 * Split on `*`: outside a pair the text is roman, inside it is italic. The
 * marks are never drawn. Empty runs are dropped.
 */
export function markupRuns(markup: string): MarkupRun[] {
  const runs: MarkupRun[] = [];
  let italic = false;
  let current = '';
  for (const character of markup) {
    if (character === '*') {
      if (current) runs.push({ text: current, italic });
      current = '';
      italic = !italic;
    } else {
      current += character;
    }
  }
  if (current) runs.push({ text: current, italic });
  return runs;
}

/** The text with every mark removed: what TalkBack reads and tests look for. */
export function markupPlain(markup: string): string {
  return parseMarkup(markup)
    .map((segment) => segment.text)
    .join('');
}

/** `[label](url)` at the start: a label without brackets, a url without spaces or parentheses. */
const LINK = /^\[([^\]]*)\]\(([^()\s]*)\)/;

/**
 * Split a string into runs and links. Italic marks toggle across the whole
 * string (a link's label can be italic); a `[` that does not open a whole
 * `[label](url)` is plain text.
 */
export function parseMarkup(markup: string): MarkupSegment[] {
  const segments: MarkupSegment[] = [];
  let italic = false;
  let current = '';
  const flush = () => {
    if (current) segments.push({ text: current, italic });
    current = '';
  };
  let index = 0;
  while (index < markup.length) {
    const character = markup[index]!;
    if (character === '*') {
      flush();
      italic = !italic;
      index += 1;
      continue;
    }
    if (character === '[') {
      const match = LINK.exec(markup.slice(index));
      if (match) {
        flush();
        const [whole, label = '', href = ''] = match;
        for (const run of markupRuns(label)) {
          segments.push({ text: run.text, italic: run.italic !== italic, href });
        }
        // An odd number of marks inside the label carries over, as it would
        // in the plain toggle.
        if ((label.split('*').length - 1) % 2 === 1) italic = !italic;
        index += whole.length;
        continue;
      }
    }
    current += character;
    index += 1;
  }
  flush();
  return segments;
}

export type MarkupTextProps = Omit<TextProps, 'children'> & {
  /** The translated string, marks and all. */
  readonly children: string;
  /** Added to italic runs (default: `fontStyle: 'italic'`; pass the italic face where the font has one). */
  readonly italicStyle?: StyleProp<TextStyle>;
  /** Added to link runs (default: underlined). */
  readonly linkStyle?: StyleProp<TextStyle>;
  /** What a link tap does (default: open the url with the system). */
  readonly onLinkPress?: (url: string) => void;
};

/**
 * A translated string with its italic runs and links drawn, the marks never
 * shown. One <Text>, so the style, font scaling and line breaks apply to every
 * run; each link is a nested pressable span TalkBack lists as a link.
 */
export function MarkupText({ children, italicStyle, linkStyle, onLinkPress, ...textProps }: MarkupTextProps) {
  const segments = useMemo(() => parseMarkup(children), [children]);
  const openLink = onLinkPress ?? ((url: string) => void Linking.openURL(url).catch(() => undefined));
  return (
    <Text {...textProps}>
      {segments.map((segment, index) => {
        const style = [segment.italic && [styles.italic, italicStyle], segment.href !== undefined && [styles.link, linkStyle]];
        if (segment.href === undefined) {
          return (
            <Text key={index} style={style}>
              {segment.text}
            </Text>
          );
        }
        const href = segment.href;
        return (
          <Text key={index} style={style} accessibilityRole="link" onPress={() => openLink(href)}>
            {segment.text}
          </Text>
        );
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  italic: { fontStyle: 'italic' },
  link: { textDecorationLine: 'underline' },
});
