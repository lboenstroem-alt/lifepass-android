// `*italic*` runs and `[label](url)` links in a translated string. Ports
// LocalizationDashTests.testOnboardingMarkupSplitsRunsAndKeepsLineBreaks and
// renders the Terms line the way SignUpView's `Text(.init(...))` does.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, StyleSheet } from 'react-native';

import { translate } from '..';
import { MarkupText, markupPlain, markupRuns, parseMarkup } from '../markup';

describe('markupRuns (OnboardingMarkup.runs)', () => {
  it('splits runs and keeps line breaks', () => {
    expect(markupRuns('Pay for how\nyou *actually* show up.')).toEqual([
      { text: 'Pay for how\nyou ', italic: false },
      { text: 'actually', italic: true },
      { text: ' show up.', italic: false },
    ]);
    expect(markupRuns('Kyrrð Íslands,\n*á einu korti.*')).toEqual([
      { text: 'Kyrrð Íslands,\n', italic: false },
      { text: 'á einu korti.', italic: true },
    ]);
    expect(markupRuns('Scan in.')).toEqual([{ text: 'Scan in.', italic: false }]);
    expect(markupRuns('')).toEqual([]);
  });

  it('draws no mark (OnboardingMarkup.plain)', () => {
    expect(markupPlain('Scan in.\n*No queue at the desk.*')).toBe('Scan in.\nNo queue at the desk.');
  });
});

describe('parseMarkup', () => {
  const terms = translate('auth.terms_agree', 'en', {
    terms: 'https://lifepass.is/terms',
    privacy: 'https://lifepass.is/privacy',
  });

  it('turns the Terms line into text and two links', () => {
    expect(parseMarkup(terms)).toEqual([
      { text: 'I agree to the ', italic: false },
      { text: 'Terms', italic: false, href: 'https://lifepass.is/terms' },
      { text: ' and ', italic: false },
      { text: 'Privacy Policy', italic: false, href: 'https://lifepass.is/privacy' },
      { text: '.', italic: false },
    ]);
    expect(markupPlain(terms)).toBe('I agree to the Terms and Privacy Policy.');
  });

  it('links the Icelandic Terms line too', () => {
    const icelandic = translate('auth.terms_agree', 'is', { terms: 't', privacy: 'p' });
    expect(parseMarkup(icelandic).filter((s) => s.href).map((s) => [s.text, s.href])).toEqual([
      ['skilmálana', 't'],
      ['persónuverndarstefnuna', 'p'],
    ]);
  });

  it('keeps a bracket that opens no link as text, and italics across a link', () => {
    expect(parseMarkup('[not a link] *and [a](u) here*')).toEqual([
      { text: '[not a link] ', italic: false },
      { text: 'and ', italic: true },
      { text: 'a', italic: true, href: 'u' },
      { text: ' here', italic: true },
    ]);
  });

  it('keeps a link with no url as its label, plain', () => {
    expect(parseMarkup('Read [this]() first')).toEqual([
      { text: 'Read ', italic: false },
      { text: 'this', italic: false },
      { text: ' first', italic: false },
    ]);
  });
});

describe('MarkupText', () => {
  it('draws the italic run in italics and never shows a mark', async () => {
    await render(
      <MarkupText testID="headline" italicStyle={{ color: 'red' }}>
        {translate('onboard.splash_headline', 'en')}
      </MarkupText>,
    );
    // The default matcher folds the line breaks into spaces.
    expect(screen.getByTestId('headline')).toHaveTextContent('The stillness of Iceland, on one pass.');
    const italic = screen.getByText('on one pass.');
    expect(StyleSheet.flatten(italic.props.style)).toMatchObject({ fontStyle: 'italic', color: 'red' });
    expect(screen.queryByText(/\*/)).toBeNull();
  });

  it('presents each link to TalkBack as a link and opens it on a press', async () => {
    const opened: string[] = [];
    await render(
      <MarkupText onLinkPress={(url) => opened.push(url)}>
        {translate('auth.terms_agree', 'en', { terms: 'https://lifepass.is/terms', privacy: 'https://lifepass.is/privacy' })}
      </MarkupText>,
    );
    await fireEvent.press(screen.getByRole('link', { name: 'Privacy Policy' }));
    await fireEvent.press(screen.getByRole('link', { name: 'Terms' }));
    expect(opened).toEqual(['https://lifepass.is/privacy', 'https://lifepass.is/terms']);
  });

  it('lists a link with an italic word in its label as ONE link', async () => {
    const opened: string[] = [];
    await render(<MarkupText onLinkPress={(url) => opened.push(url)}>{'Read the [*Terms* of use](u).'}</MarkupText>);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    const link = screen.getByRole('link', { name: 'Terms of use' });
    expect(StyleSheet.flatten(screen.getByText('Terms').props.style)).toMatchObject({ fontStyle: 'italic' });
    await fireEvent.press(link);
    expect(opened).toEqual(['u']);
  });

  it('draws no link where there is no url', async () => {
    await render(<MarkupText testID="line">{'Read [this]() first'}</MarkupText>);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByTestId('line')).toHaveTextContent('Read this first');
  });

  it('colours a link with the tint and does not underline it, as SwiftUI draws the Terms line', async () => {
    await render(
      <MarkupText linkColor="#B5532E">
        {translate('auth.terms_agree', 'en', { terms: 'https://lifepass.is/terms', privacy: 'https://lifepass.is/privacy' })}
      </MarkupText>,
    );
    const style = StyleSheet.flatten(screen.getByRole('link', { name: 'Terms' }).props.style);
    expect(style).toMatchObject({ color: '#B5532E' });
    expect(style?.textDecorationLine).toBeUndefined();
  });

  it('opens a link with the system when no handler is given', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(<MarkupText>{'Read the [Terms](https://lifepass.is/terms).'}</MarkupText>);
    await fireEvent.press(screen.getByRole('link', { name: 'Terms' }));
    expect(openURL).toHaveBeenCalledWith('https://lifepass.is/terms');
    openURL.mockRestore();
  });
});
