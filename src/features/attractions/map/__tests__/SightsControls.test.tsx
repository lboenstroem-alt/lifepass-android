/**
 * The sights' controls over the map (../SightsControls.tsx, iOS
 * `sightsToggle`, the attribution plate and `sightsRetryNotice`).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { setCurrentLanguage } from '../../../../i18n';
import { SightsCreditPlate, SightsRetryNotice, SightsToggle } from '../SightsControls';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

afterEach(async () => {
  await act(async () => setCurrentLanguage('en'));
});

describe('the toggle', () => {
  it('says “Sights”, is heard as the legend’s word, and tells TalkBack it is on', async () => {
    const onToggle = jest.fn();
    const view = await render(<SightsToggle on onToggle={onToggle} />);
    const toggle = screen.getByTestId('explore.map.sightsToggle');
    expect(screen.getByText('Sights')).toBeTruthy();
    expect(toggle).toHaveProp('accessibilityLabel', 'Sights');
    expect(toggle).toHaveProp('accessibilityRole', 'button');
    expect(toggle).toBeSelected();
    await fireEvent.press(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    await view.rerender(<SightsToggle on={false} onToggle={onToggle} />);
    expect(screen.getByTestId('explore.map.sightsToggle')).not.toBeSelected();
  });

  it('reads “Staðir”, heard as “Áhugaverðir staðir”, in Icelandic', async () => {
    await act(async () => setCurrentLanguage('is'));
    await render(<SightsToggle on onToggle={jest.fn()} />);
    expect(screen.getByText('Staðir')).toBeTruthy();
    expect(screen.getByTestId('explore.map.sightsToggle')).toHaveProp('accessibilityLabel', 'Áhugaverðir staðir');
  });
});

describe('the credit plate', () => {
  it('shows the feed’s own notice, as sent', async () => {
    await render(<SightsCreditPlate text="© OpenStreetMap contributors, ODbL" />);
    expect(screen.getByText('© OpenStreetMap contributors, ODbL')).toBeTruthy();
  });
});

describe('the quiet notice', () => {
  it('offers “Try again”, underlined', async () => {
    const onRetry = jest.fn();
    await render(<SightsRetryNotice loading={false} onRetry={onRetry} />);
    expect(screen.getByText('Sights did not load.')).toBeTruthy();
    expect(screen.getByText('Try again')).toHaveStyle({ textDecorationLine: 'underline' });
    expect(screen.getByTestId('explore.map.sightsRetry')).toHaveProp('accessibilityLabel', 'Sights did not load. Try again');
    await fireEvent.press(screen.getByTestId('explore.map.sightsRetry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows progress while a request is out, and takes no second tap', async () => {
    const onRetry = jest.fn();
    await render(<SightsRetryNotice loading onRetry={onRetry} />);
    expect(screen.getByTestId('explore.map.sightsRetry.loading')).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
    expect(screen.getByTestId('explore.map.sightsRetry')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('explore.map.sightsRetry'));
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('speaks Icelandic in Icelandic', async () => {
    await act(async () => setCurrentLanguage('is'));
    await render(<SightsRetryNotice loading={false} onRetry={jest.fn()} />);
    expect(screen.getByText('Ekki tókst að sækja áhugaverða staði.')).toBeTruthy();
    expect(screen.getByText('Reyna aftur')).toBeTruthy();
  });
});
