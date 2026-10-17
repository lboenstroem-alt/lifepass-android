/**
 * F4's interim auth-link bridge (until AUTH-1 fills src/features/auth/authCallback.ts):
 * a recovery link signs in with the post-sign-up Kenni nudge suppressed, so
 * the nudge can never hide the set-new-password screen (iOS
 * `handleSignIn(userId:suppressKennitalaPrompt: isRecovery)`).
 */
import { handleAuthCallback } from '../../features/auth/authCallback';
import { resetAppStoreForTests, useAppStore } from '../../stores/appStore';
import { supabase } from '../../supabase/lib/client';

const mockComplete = jest.fn(async (_url: string) => true);
jest.mock('../../supabase/services/auth', () => ({
  AUTH_CALLBACK_URL: 'lifepass://auth/callback',
  completeAuthFromUrl: (url: string) => mockComplete(url),
}));

const handleSignIn = jest.fn(async (_userId: string, _options?: object) => undefined);
const realHandleSignIn = useAppStore.getState().handleSignIn;

beforeEach(() => {
  resetAppStoreForTests();
  mockComplete.mockReset().mockResolvedValue(true);
  handleSignIn.mockClear();
  useAppStore.setState({ handleSignIn });
  jest
    .spyOn(supabase.auth, 'getSession')
    .mockResolvedValue({ data: { session: { user: { id: 'member-a' } } }, error: null } as never);
});

afterEach(() => {
  useAppStore.setState({ handleSignIn: realHandleSignIn });
  jest.restoreAllMocks();
});

describe('a password-reset link', () => {
  it('signs in with the Kenni nudge suppressed, then asks for the new password', async () => {
    await handleAuthCallback('lifepass://auth/callback#access_token=a&refresh_token=b&type=recovery');
    expect(handleSignIn).toHaveBeenCalledWith('member-a', { suppressKennitalaPrompt: true });
    expect(useAppStore.getState().pendingPasswordRecovery).toBe(true);
  });

  it('in its App Link form too', async () => {
    await handleAuthCallback('https://www.lifepass.is/app/auth-callback#access_token=a&refresh_token=b&type=recovery');
    expect(mockComplete).toHaveBeenCalledWith('lifepass://auth/callback#access_token=a&refresh_token=b&type=recovery');
    expect(handleSignIn).toHaveBeenCalledWith('member-a', { suppressKennitalaPrompt: true });
  });

  it('that fails shows the reset-specific banner and signs nobody in', async () => {
    mockComplete.mockRejectedValue(new Error('otp_expired'));
    await handleAuthCallback('lifepass://auth/callback?error_code=otp_expired&type=recovery');
    expect(handleSignIn).not.toHaveBeenCalled();
    expect(useAppStore.getState().pendingPasswordRecovery).toBe(false);
    expect(useAppStore.getState().deepLinkError).not.toBeNull();
  });
});

describe('an email-confirmation link', () => {
  it('leaves the sign-in (and its nudge) to the session listener', async () => {
    await handleAuthCallback('lifepass://auth/callback#access_token=a&refresh_token=b');
    expect(handleSignIn).not.toHaveBeenCalled();
    expect(useAppStore.getState().pendingPasswordRecovery).toBe(false);
  });
});
