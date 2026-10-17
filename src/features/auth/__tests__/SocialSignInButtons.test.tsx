/**
 * The Continue with Apple / Google block on the sign-in and sign-up screens
 * (iOS `SocialSignInButtons`, 2.5.4): what shows for each answer of the
 * gate, the terms line for what shows, the divider placement, the busy
 * state, and "a cancel is silent; anything else says auth.social_failed".
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Linking } from 'react-native';

import { Reply, supabase as authHost } from '@test/server';
import { setEnv } from '@test/harness';

import { MerchantInfo } from '../../../config/merchantInfo';
import { setCurrentLanguage } from '../../../i18n';
import { resetSocialProviderSettingsForTests } from '../providerSettings';
import { resumeSocialSignIn, signInWithSocialProvider, useSocialSignInBusy, useSocialSignInStore } from '../social';
import SocialSignInButtons from '../SocialSignInButtons';

// expo-font (behind @expo/vector-icons) imports expo-asset, which npm left
// nested under expo/ (as the UI kit's TopBar test does).
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('../social', () => ({
  ...jest.requireActual('../social'),
  signInWithSocialProvider: jest.fn(),
  resumeSocialSignIn: jest.fn(),
}));

const signIn = jest.mocked(signInWithSocialProvider);
const resume = jest.mocked(resumeSocialSignIn);

const TERMS_BOTH =
  'By continuing with Apple or Google you agree to the LifePass Terms and Privacy Policy.';
const TERMS_APPLE = 'By continuing with Apple you agree to the LifePass Terms and Privacy Policy.';
const TERMS_GOOGLE = 'By continuing with Google you agree to the LifePass Terms and Privacy Policy.';
const FAILED = "We couldn't sign you in with that provider. Try again or use email.";

function serverHas(external: { apple?: boolean; google?: boolean }) {
  authHost.on('GET', '/auth/v1/settings', Reply.json(200, { external: { email: true, ...external } }));
}

beforeEach(() => {
  resetSocialProviderSettingsForTests();
  useSocialSignInStore.setState({ busy: false });
  signIn.mockReset().mockResolvedValue('cancelled');
  resume.mockReset().mockResolvedValue('ignored');
  setEnv({ EXPO_PUBLIC_SOCIAL_SIGN_IN: 'YES' });
});

/** Renders and lets the settings read (and the launch check) answer. */
async function renderButtons(divider: 'above' | 'below' = 'above') {
  // RNTL 14: render, act and fireEvent are all async and must be awaited.
  const view = await render(<SocialSignInButtons divider={divider} />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return view;
}

describe('what shows', () => {
  it('nothing in a build without the flag, and the server is never asked', async () => {
    setEnv({ EXPO_PUBLIC_SOCIAL_SIGN_IN: undefined });
    serverHas({ apple: true, google: true });
    const view = await renderButtons();
    expect(view.toJSON()).toBeNull();
    expect(authHost.sentAll('/auth/v1/settings')).toHaveLength(0);
  });

  it('nothing when the settings read fails', async () => {
    authHost.on('GET', '/auth/v1/settings', Reply.json(503, {}));
    const view = await renderButtons();
    expect(view.toJSON()).toBeNull();
  });

  it('nothing when the server has both off', async () => {
    serverHas({ apple: false, google: false });
    const view = await renderButtons();
    expect(view.toJSON()).toBeNull();
  });

  it('both, Apple first, with the terms line that names both', async () => {
    serverHas({ apple: true, google: true });
    await renderButtons();
    const apple = await screen.findByTestId('auth.apple');
    const google = screen.getByTestId('auth.google');
    expect(screen.getByText('Continue with Apple')).toBeTruthy();
    expect(screen.getByText('Continue with Google')).toBeTruthy();
    expect(apple).toHaveProp('accessibilityRole', 'button');
    expect(apple).toHaveProp('accessibilityLabel', 'Continue with Apple');
    expect(google).toHaveProp('accessibilityLabel', 'Continue with Google');
    expect(screen.getByText(TERMS_BOTH)).toBeTruthy();
  });

  it('Apple alone, with the Apple terms line', async () => {
    serverHas({ apple: true });
    await renderButtons();
    await screen.findByTestId('auth.apple');
    expect(screen.queryByTestId('auth.google')).toBeNull();
    expect(screen.getByText(TERMS_APPLE)).toBeTruthy();
  });

  it('Google alone (owner decision D1), with its own terms line', async () => {
    serverHas({ google: true });
    await renderButtons();
    await screen.findByTestId('auth.google');
    expect(screen.queryByTestId('auth.apple')).toBeNull();
    expect(screen.getByText(TERMS_GOOGLE)).toBeTruthy();
  });

  it('in Icelandic', async () => {
    setCurrentLanguage('is');
    serverHas({ apple: true, google: true });
    await renderButtons();
    expect(await screen.findByText('Halda áfram með Apple')).toBeTruthy();
    expect(screen.getByText('Halda áfram með Google')).toBeTruthy();
    expect(screen.getByText('eða', { includeHiddenElements: true })).toBeTruthy();
    expect(
      screen.getByText(
        'Með því að halda áfram með Apple eða Google samþykkir þú skilmála og persónuverndarstefnu LifePass.',
      ),
    ).toBeTruthy();
  });

  it('at once on the next screen, from the answer this app session already has', async () => {
    serverHas({ apple: true, google: true });
    const first = await renderButtons();
    await screen.findByTestId('auth.google');
    await first.unmount();
    await render(<SocialSignInButtons divider="below" />);
    // No wait: the cached answer draws on the first frame.
    expect(screen.getByTestId('auth.google')).toBeTruthy();
    expect(authHost.sentAll('/auth/v1/settings')).toHaveLength(1);
  });
});

describe('the divider', () => {
  /** The block's children in order: which comes first, the "or" or the first button. */
  function firstChildIsDivider(): boolean {
    const block = screen.getByTestId('auth.social');
    const children = block.children as unknown as { props?: { testID?: string } }[];
    return children[0]?.props?.testID !== 'auth.apple';
  }

  it('sits above the buttons on Log in', async () => {
    serverHas({ apple: true, google: true });
    await renderButtons('above');
    await screen.findByTestId('auth.apple');
    expect(screen.getByText('or', { includeHiddenElements: true })).toBeTruthy();
    expect(firstChildIsDivider()).toBe(true);
  });

  it('sits below them on Sign up', async () => {
    serverHas({ apple: true, google: true });
    await renderButtons('below');
    await screen.findByTestId('auth.apple');
    expect(screen.getByText('or', { includeHiddenElements: true })).toBeTruthy();
    expect(firstChildIsDivider()).toBe(false);
  });

  it('is not read out by TalkBack', async () => {
    serverHas({ apple: true });
    await renderButtons();
    await screen.findByTestId('auth.apple');
    expect(screen.queryByText('or')).toBeNull(); // hidden from the accessibility tree
    expect(screen.getByText('or', { includeHiddenElements: true })).toBeTruthy();
  });
});

describe('tapping', () => {
  it('starts the provider’s sign-in', async () => {
    serverHas({ apple: true, google: true });
    await renderButtons();
    await fireEvent.press(await screen.findByTestId('auth.google'));
    expect(signIn).toHaveBeenCalledWith('google');
    await fireEvent.press(screen.getByTestId('auth.apple'));
    expect(signIn).toHaveBeenCalledWith('apple');
  });

  it('a cancel says nothing', async () => {
    serverHas({ google: true });
    signIn.mockResolvedValue('cancelled');
    await renderButtons();
    await fireEvent.press(await screen.findByTestId('auth.google'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(signIn).toHaveBeenCalledWith('google');
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('a failure says auth.social_failed under the buttons, and TalkBack hears it', async () => {
    const spoken = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    serverHas({ google: true });
    signIn.mockResolvedValue('failed');
    await renderButtons();
    await fireEvent.press(await screen.findByTestId('auth.google'));
    expect(await screen.findByText(FAILED)).toBeTruthy();
    expect(spoken).toHaveBeenCalledWith(FAILED);

    // The next try clears it.
    signIn.mockResolvedValue('cancelled');
    await fireEvent.press(screen.getByTestId('auth.google'));
    await waitFor(() => expect(screen.queryByText(FAILED)).toBeNull());
  });

  it('while a sign-in runs the buttons are disabled and the block dimmed', async () => {
    serverHas({ apple: true, google: true });
    await renderButtons();
    await screen.findByTestId('auth.google');
    await act(() => useSocialSignInStore.setState({ busy: true }));
    for (const id of ['auth.apple', 'auth.google']) {
      expect(screen.getByTestId(id)).toHaveProp('accessibilityState', { disabled: true, busy: true });
    }
    expect(screen.getByTestId('auth.social')).toHaveStyle({ opacity: 0.6 });
    await fireEvent.press(screen.getByTestId('auth.google'));
    expect(signIn).not.toHaveBeenCalled();

    await act(() => useSocialSignInStore.setState({ busy: false }));
    expect(screen.getByTestId('auth.google')).toHaveProp('accessibilityState', { disabled: false, busy: false });
  });

  it('while the screen’s email sign-in runs the block is disabled and dimmed too (iOS: one isLoading)', async () => {
    serverHas({ apple: true, google: true });
    const view = await render(<SocialSignInButtons divider="above" disabled />);
    await screen.findByTestId('auth.google');
    for (const id of ['auth.apple', 'auth.google']) {
      // Disabled, but not "busy": no provider sign-in of ours is on its way.
      expect(screen.getByTestId(id)).toHaveProp('accessibilityState', { disabled: true, busy: false });
    }
    expect(screen.getByTestId('auth.social')).toHaveStyle({ opacity: 0.6 });
    await fireEvent.press(screen.getByTestId('auth.apple'));
    expect(signIn).not.toHaveBeenCalled();

    await view.rerender(<SocialSignInButtons divider="above" disabled={false} />);
    await fireEvent.press(screen.getByTestId('auth.apple'));
    expect(signIn).toHaveBeenCalledWith('apple');
  });

  it('tells the email form while a provider sign-in runs (useSocialSignInBusy)', async () => {
    const seen: boolean[] = [];
    function EmailForm() {
      seen.push(useSocialSignInBusy());
      return null;
    }
    await render(<EmailForm />);
    await act(() => useSocialSignInStore.setState({ busy: true }));
    await act(() => useSocialSignInStore.setState({ busy: false }));
    expect(seen).toEqual([false, true, false]);
  });

  it('the terms line opens the Terms and the Privacy Policy', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    serverHas({ apple: true, google: true });
    await renderButtons();
    await screen.findByTestId('auth.google');
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.props.children).length).toBe(2);
    await fireEvent.press(screen.getByText('Terms'));
    expect(open).toHaveBeenCalledWith(MerchantInfo.termsURL);
    await fireEvent.press(screen.getByText('Privacy Policy'));
    expect(open).toHaveBeenCalledWith(MerchantInfo.privacyURL);
  });
});

describe('a start from the page’s return link', () => {
  it('finishes the sign-in it was in the middle of, and says so when that fails', async () => {
    serverHas({ apple: true, google: true });
    resume.mockResolvedValue('failed');
    await renderButtons();
    expect(resume).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(FAILED)).toBeTruthy();
  });
});
