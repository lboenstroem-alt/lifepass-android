/**
 * The launch screen: the wordmark and a spinner TalkBack names, in the
 * language the app speaks.
 */
import { render, screen } from '@testing-library/react-native';

import { setCurrentLanguage } from '../../i18n';
import LaunchScreen from '../LaunchScreen';

it('shows the wordmark and a named spinner', async () => {
  await render(<LaunchScreen />);
  expect(screen.getByLabelText('LifePass')).toBeTruthy();
  expect(screen.getByLabelText('Loading')).toBeTruthy();
});

it('names the spinner in Icelandic on an Icelandic phone', async () => {
  setCurrentLanguage('is');
  await render(<LaunchScreen />);
  expect(screen.getByLabelText('Hleð')).toBeTruthy();
});
