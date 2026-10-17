/**
 * The check-in proof on screen (iOS `CheckInProofDisplay`): the three big
 * lines as reception reads them, the one TalkBack summary, the small print,
 * the guest receipt and the balance, the account language, and what changes
 * at the accessibility text sizes.
 */
import { render, screen, within } from '@testing-library/react-native';
import { Text } from 'react-native';

import { FONT_SCALE_CAP } from '../../../../hooks/useA11ySize';
import { restoreTestFontScale, setTestFontScale } from '../../../../hooks/testing';
import { setCurrentLanguage } from '../../../../i18n';
import CheckInProofDisplay, { type CheckInProofDisplayProps } from '../CheckInProofDisplay';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

/** Thursday 23 April 2026, 14:32 in Reykjavík. */
const AT = new Date('2026-04-23T14:32:00Z');

function proof(overrides: Partial<CheckInProofDisplayProps> = {}): CheckInProofDisplayProps {
  return {
    checkedInAt: AT,
    venueName: 'World Class Laugar',
    memberShortName: 'Anna J.',
    activityName: null,
    confirmationCode: null,
    party: null,
    balance: null,
    hint: null,
    mark: <Text testID="mark">mark</Text>,
    ...overrides,
  };
}

beforeEach(() => {
  setCurrentLanguage('en');
  setTestFontScale(1);
});

afterEach(() => restoreTestFontScale());

describe('the three big lines', () => {
  it('shows the time, the day, the venue and the short name, and says it worked', async () => {
    await render(<CheckInProofDisplay {...proof()} />);
    expect(screen.getByText('CHECK-IN SUCCESSFUL!')).toBeOnTheScreen();
    expect(screen.getByText('14:32')).toBeOnTheScreen();
    expect(screen.getByText('Thu 23 Apr')).toBeOnTheScreen();
    expect(screen.getByText('World Class Laugar')).toBeOnTheScreen();
    expect(screen.getByText('Anna J.')).toBeOnTheScreen();
    expect(screen.getByTestId('mark')).toBeOnTheScreen();
  });

  it('reads as one TalkBack summary, time first, without repeating the eyebrow', async () => {
    await render(<CheckInProofDisplay {...proof()} />);
    const headline = screen.getByTestId('checkin.proof.headline');
    expect(headline.props.accessible).toBe(true);
    expect(headline.props.accessibilityLabel).toBe('14:32, Thu 23 Apr, World Class Laugar, Anna J.');
    // The eyebrow is its own element and is spoken as words, not letters.
    expect(screen.getByText('CHECK-IN SUCCESSFUL!').props.accessibilityLabel).toBe('Check-In Successful!');
  });

  it('shows no name line at all when the server sent no name, and says none', async () => {
    for (const memberShortName of [null, '']) {
      await render(<CheckInProofDisplay {...proof({ memberShortName })} />);
      expect(screen.queryByTestId('checkin.proof.name')).toBeNull();
      expect(screen.getByTestId('checkin.proof.headline').props.accessibilityLabel).toBe(
        '14:32, Thu 23 Apr, World Class Laugar',
      );
    }
  });

  it('draws the name exactly as the server shortened it, whatever its script', async () => {
    for (const name of ['Яна К.', '陳大文', 'أحمد م.', 'Þórunn B.']) {
      await render(<CheckInProofDisplay {...proof({ memberShortName: name })} />);
      expect(screen.getByTestId('checkin.proof.name')).toHaveTextContent(name);
    }
  });

  it('writes the day in the account language, not the phone', async () => {
    setCurrentLanguage('is');
    await render(<CheckInProofDisplay {...proof()} />);
    expect(screen.getByText('INNRITUN TÓKST!')).toBeOnTheScreen();
    const label: string = screen.getByTestId('checkin.proof.headline').props.accessibilityLabel;
    expect(label.startsWith('14:32, fim')).toBe(true);
    expect(screen.queryByText('Thu 23 Apr')).toBeNull();
  });
});

describe('the small print', () => {
  it('puts the activity and the confirmation code on one detail line, and the hint under it', async () => {
    await render(
      <CheckInProofDisplay
        {...proof({ activityName: 'Walk-in', confirmationCode: 'C93B77', hint: 'Show this screen to the staff at reception.' })}
      />,
    );
    expect(screen.getByText('Walk-in  ·  CONFIRMATION C93B77')).toBeOnTheScreen();
    expect(screen.getByText('Show this screen to the staff at reception.')).toBeOnTheScreen();
  });

  it('draws no empty rows: no detail, party, balance or hint when there is none', async () => {
    await render(<CheckInProofDisplay {...proof()} />);
    expect(screen.queryByTestId('checkin.proof.party')).toBeNull();
    expect(screen.queryByTestId('checkin.proof.balance')).toBeNull();
    expect(screen.queryByText(/CONFIRMATION/)).toBeNull();
  });

  it('reads the balance after as one line, under its label', async () => {
    await render(<CheckInProofDisplay {...proof({ balance: '5 of 6 visits left on your Adventurer pass' })} />);
    const balance = screen.getByTestId('checkin.proof.balance');
    expect(within(balance).getByText('BALANCE AFTER')).toBeOnTheScreen();
    expect(within(balance).getByText('5 of 6 visits left on your Adventurer pass')).toBeOnTheScreen();
    expect(balance.props.accessibilityLabel).toBe('Balance after: 5 of 6 visits left on your Adventurer pass');
  });
});

describe('the guest receipt', () => {
  const family = { adults: 1, children: 2, infants: 0, guestChargeIsk: 5400 };

  it('counts heads and says what the guests were charged', async () => {
    await render(<CheckInProofDisplay {...proof({ party: family })} />);
    const party = screen.getByTestId('checkin.proof.party');
    expect(within(party).getByText('4 checked in')).toBeOnTheScreen();
    expect(within(party).getByText('Guests: ISK 5,400 charged to your card')).toBeOnTheScreen();
  });

  it('is not drawn for a party with no guests', async () => {
    await render(<CheckInProofDisplay {...proof({ party: { adults: 0, children: 0, infants: 0, guestChargeIsk: 0 } })} />);
    expect(screen.queryByTestId('checkin.proof.party')).toBeNull();
  });
});

describe('at the accessibility text sizes', () => {
  beforeEach(() => setTestFontScale(2));

  it('folds the receipt into one line, so the charge stays above Done', async () => {
    await render(<CheckInProofDisplay {...proof({ party: { adults: 1, children: 0, infants: 0, guestChargeIsk: 5400 } })} />);
    const party = screen.getByTestId('checkin.proof.party');
    expect(within(party).queryByText('Guests: ISK 5,400 charged to your card')).toBeNull();
    expect(within(party).getByText(/· ISK 5,400 charged to your card$/)).toBeOnTheScreen();
  });

  it('stops the big lines growing at accessibility1, and the eyebrow at xxLarge', async () => {
    await render(<CheckInProofDisplay {...proof({ balance: '7 gym & studio visits left this period' })} />);
    for (const line of ['14:32', 'Thu 23 Apr', 'World Class Laugar', 'Anna J.', '7 gym & studio visits left this period']) {
      expect(screen.getByText(line).props.maxFontSizeMultiplier).toBe(FONT_SCALE_CAP.accessibility1);
    }
    expect(screen.getByText('CHECK-IN SUCCESSFUL!').props.maxFontSizeMultiplier).toBe(FONT_SCALE_CAP.xxLarge);
    expect(screen.getByText('BALANCE AFTER').props.maxFontSizeMultiplier).toBe(FONT_SCALE_CAP.xxLarge);
  });

  it('keeps the small print growing the whole way', async () => {
    await render(<CheckInProofDisplay {...proof({ activityName: 'Yoga', hint: 'Show this screen to the staff at reception.' })} />);
    expect(screen.getByText('Yoga').props.maxFontSizeMultiplier).toBeUndefined();
    expect(screen.getByText('Show this screen to the staff at reception.').props.maxFontSizeMultiplier).toBeUndefined();
  });
});
