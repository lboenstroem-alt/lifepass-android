/**
 * Home's "You're checked in" bar and the staff proof it re-offers (iOS
 * `HomeView.checkInProofBanner` / `checkInProofScreen`, CheckInScanTests'
 * CheckInProofNameTests profile cases, and the plan's acceptance: the proof
 * never shows `memberName`).
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import { decodeProfile, type Profile } from '../../api/profile';
import { restoreTestFontScale, setTestFontScale } from '../../hooks/testing';
import { setCurrentLanguage } from '../../i18n';
import { useAppStore } from '../../stores/appStore';
import { freshStorePerTest, MEMBER_A, profileJSON } from '../../stores/__tests__/storeHarness';
import { toLegacyRecentCheckIn } from '../../supabase/types/profile';
import CheckInProofBanner from '../CheckInProofBanner';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

freshStorePerTest();

/** iOS CheckInProofNameTests.recentCheckInJSON, with the short name as given. */
function recentCheckInJSON(shortName?: unknown): Record<string, unknown> {
  const json: Record<string, unknown> = {
    checkInId: '7c1f2ab3-9d54-4e88-9a01-4f21a0c93b77',
    checkedInAt: '2026-04-23T14:32:00Z',
    memberName: 'Anna Jonsdottir',
    venue: { id: '1b9c6d2e-3f40-4a51-8b62-7c83d94e05f1', name: 'World Class Laugar' },
    activity: null,
  };
  if (shortName !== undefined) json.memberShortName = shortName;
  return json;
}

/** A profile carrying `recentCheckIn`, decoded as the app store decodes `GET /profile`. */
function profileWith(recentCheckIn: unknown, locale = 'en'): Profile {
  return decodeProfile(profileJSON({ id: MEMBER_A, fullName: 'Anna Jonsdottir', locale, recentCheckIn }));
}

function signedInWith(profile: Profile): void {
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER_A, profile });
}

async function openProof() {
  await fireEvent.press(screen.getByRole('button', { name: 'Show to staff' }));
}

beforeEach(() => {
  setCurrentLanguage('en');
  setTestFontScale(1);
});

afterEach(() => restoreTestFontScale());

describe('the bar', () => {
  it('is not there without a recent check-in', async () => {
    signedInWith(profileWith(null));
    await render(<CheckInProofBanner />);
    expect(screen.queryByTestId('checkin.proofBanner')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show to staff' })).toBeNull();
  });

  it('says the member is checked in, where, and offers the proof', async () => {
    signedInWith(profileWith(recentCheckInJSON('Anna J.')));
    await render(<CheckInProofBanner />);
    expect(screen.getByText("You're checked in")).toBeOnTheScreen();
    expect(screen.getByText('World Class Laugar')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Show to staff' })).toBeOnTheScreen();
  });

  it('"Show to staff" looks like iOS\'s 36 dp capsule but takes a 48 dp touch', async () => {
    signedInWith(profileWith(recentCheckInJSON('Anna J.')));
    await render(<CheckInProofBanner />);
    const show = screen.getByRole('button', { name: 'Show to staff' });
    expect(show).toHaveStyle({ minHeight: 36 });
    const slop = show.props.hitSlop as { top: number; bottom: number };
    expect(36 + slop.top + slop.bottom).toBeGreaterThanOrEqual(48);
  });

  it('speaks Icelandic for an Icelandic account', async () => {
    setCurrentLanguage('is');
    signedInWith(profileWith(recentCheckInJSON('Anna J.'), 'is'));
    await render(<CheckInProofBanner />);
    expect(screen.getByText('Þú ert innrituð/aður')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Sýna starfsfólki' }));
    expect(screen.getByText('Almenn innskráning  ·  STAÐFESTINGARNÚMER C93B77')).toBeOnTheScreen();
    expect(screen.getByText('Sýndu þennan skjá starfsfólki í móttöku.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Lokið' })).toBeOnTheScreen();
  });
});

describe('the re-offered proof', () => {
  it('carries the short name and the confirmation code staff compare with the web (testTheReOfferedProofCarriesTheShortName)', async () => {
    signedInWith(profileWith(recentCheckInJSON('Anna J.')));
    await render(<CheckInProofBanner />);
    await openProof();
    expect(screen.getByText('14:32')).toBeOnTheScreen();
    expect(screen.getByText('Thu 23 Apr')).toBeOnTheScreen();
    expect(screen.getByText('Anna J.')).toBeOnTheScreen();
    expect(screen.getByText('Walk-in  ·  CONFIRMATION C93B77')).toBeOnTheScreen();
    expect(screen.getByText('Show this screen to the staff at reception.')).toBeOnTheScreen();
    // Decoration: hidden from TalkBack, the eyebrow says what it says.
    expect(screen.getByTestId('checkin.proof.sealMark', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('never shows the full name shipped clients read (testTheFullNameShippedClientsReadIsUntouched)', async () => {
    signedInWith(profileWith(recentCheckInJSON('Anna J.')));
    await render(<CheckInProofBanner />);
    await openProof();
    expect(screen.queryByText(/Jonsdottir/)).toBeNull();
    const label: string = screen.getByTestId('checkin.proof.headline').props.accessibilityLabel;
    expect(label).not.toContain('Jonsdottir');
  });

  it("an older server's proof still opens, with no name (testAnOlderServersProofStillOpens)", async () => {
    signedInWith(profileWith(recentCheckInJSON()));
    await render(<CheckInProofBanner />);
    await openProof();
    expect(within(screen.getByTestId('checkin.proof')).getByText('World Class Laugar')).toBeOnTheScreen();
    expect(screen.queryByTestId('checkin.proof.name')).toBeNull();
    expect(screen.queryByText(/Anna/)).toBeNull();
  });

  it('a wrong-typed short name costs the name, not the proof (testAWrongTypedShortNameDoesNotTakeTheProofAway)', async () => {
    // The member keeps their identity and their language.
    const icelandic = profileWith(recentCheckInJSON(['Anna', 'J.']), 'is');
    expect(icelandic.recentCheckIn?.memberShortName).toBeNull();
    expect(icelandic.recentCheckIn?.venue.name).toBe('World Class Laugar');
    expect(icelandic.fullName).toBe('Anna Jonsdottir');
    expect(icelandic.locale).toBe('is');
    signedInWith(profileWith(recentCheckInJSON(['Anna', 'J.'])));
    await render(<CheckInProofBanner />);
    await openProof();
    expect(screen.getByTestId('checkin.proof.headline').props.accessibilityLabel).toBe('14:32, Thu 23 Apr, World Class Laugar');
    expect(screen.queryByTestId('checkin.proof.name')).toBeNull();
  });

  it('a blank short name is no name (testABlankShortNameOnTheProofIsNoName)', async () => {
    signedInWith(profileWith(recentCheckInJSON('  ')));
    await render(<CheckInProofBanner />);
    await openProof();
    expect(screen.queryByTestId('checkin.proof.name')).toBeNull();
  });

  it('names the class a booked check-in adopted, and draws no party (D6)', async () => {
    signedInWith(
      profileWith({
        ...recentCheckInJSON('Anna J.'),
        activity: { id: 'a1', name: 'Hot Yoga' },
        party: { adults: 1, children: 1, infants: 0, guestChargeIsk: 5400 },
      }),
    );
    await render(<CheckInProofBanner />);
    await openProof();
    expect(screen.getByText('Hot Yoga  ·  CONFIRMATION C93B77')).toBeOnTheScreen();
    expect(screen.queryByTestId('checkin.proof.party')).toBeNull();
  });

  it('stays up when a profile read drops the check-in while it is open: the snapshot', async () => {
    signedInWith(profileWith(recentCheckInJSON('Anna J.')));
    await render(<CheckInProofBanner />);
    await openProof();
    // The server's window lapses and Home reads the profile again.
    await act(async () => useAppStore.setState({ profile: profileWith(null) }));
    expect(screen.queryByTestId('checkin.proofBanner')).toBeNull();
    expect(screen.getByText('14:32')).toBeOnTheScreen();
    expect(screen.getByText('Anna J.')).toBeOnTheScreen();
    // Done is still the way out, and nothing comes back after it.
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('14:32')).toBeNull();
  });

  it('keeps the proof it opened even if a newer check-in arrives under it', async () => {
    signedInWith(profileWith(recentCheckInJSON('Anna J.')));
    await render(<CheckInProofBanner />);
    await openProof();
    await act(async () =>
      useAppStore.setState({
        profile: profileWith({ ...recentCheckInJSON('Anna J.'), checkInId: '00000000-0000-4000-8000-0000000abcde', venue: { id: 'v2', name: 'Sundhöllin' } }),
      }),
    );
    expect(screen.getByText('Walk-in  ·  CONFIRMATION C93B77')).toBeOnTheScreen();
  });

  it('closes with Done, and with hardware back', async () => {
    signedInWith(profileWith(recentCheckInJSON('Anna J.')));
    await render(<CheckInProofBanner />);
    await openProof();
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('checkin.proof')).toBeNull();

    await openProof();
    expect(screen.getByTestId('checkin.proof')).toBeOnTheScreen();
    // Android's back button reaches the Modal (the cover's parent) as onRequestClose.
    const modal = screen.getByTestId('checkin.reoffer').parent;
    expect(modal?.props.onRequestClose).toBeDefined();
    await fireEvent(modal!, 'requestClose');
    expect(screen.queryByTestId('checkin.proof')).toBeNull();
  });

  it('draws the seal smaller at the accessibility sizes', async () => {
    setTestFontScale(2);
    signedInWith(profileWith(recentCheckInJSON('Anna J.')));
    await render(<CheckInProofBanner />);
    await openProof();
    const seal = screen.getByTestId('checkin.proof.sealMark', { includeHiddenElements: true });
    // The glyph is the icon font's Text: a real size, never scaled with the text.
    const glyph = within(seal).getByText(/./, { includeHiddenElements: true });
    expect(glyph).toHaveStyle({ fontSize: 26 });
    expect(glyph.props.allowFontScaling).toBe(false);
  });
});

describe('handed a check-in', () => {
  it("takes the first build's shape, whose memberName is the server's short name", async () => {
    const legacy = toLegacyRecentCheckIn(profileWith(recentCheckInJSON('Anna J.')).recentCheckIn);
    await render(<CheckInProofBanner checkIn={legacy} />);
    await openProof();
    expect(screen.getByText('Anna J.')).toBeOnTheScreen();
    expect(screen.getByText('Walk-in  ·  CONFIRMATION C93B77')).toBeOnTheScreen();
  });

  it('null shows no bar, whatever the profile says', async () => {
    signedInWith(profileWith(recentCheckInJSON('Anna J.')));
    await render(<CheckInProofBanner checkIn={null} />);
    expect(screen.queryByTestId('checkin.proofBanner')).toBeNull();
  });
});
