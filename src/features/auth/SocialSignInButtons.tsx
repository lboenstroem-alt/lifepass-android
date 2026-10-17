// @f4-stub (plan 3.0.3): Continue with Google and Apple, filled by AUTH-2; mounted by AUTH-1.
//
// iOS `SocialSignInButtons(viewModel:divider:)`: the "or" divider sits above
// the buttons on Log in and below them on Sign up. The buttons show only
// when the build allows them AND the auth server reports the provider on.
// Keep the default export and its props; replace the body (and this marker).
// Renders nothing until AUTH-2 lands.

/** Where the "or" divider goes: above the buttons (Log in) or below them (Sign up). */
export type SocialDividerPlacement = 'above' | 'below';

export interface SocialSignInButtonsProps {
  readonly divider: SocialDividerPlacement;
}

export default function SocialSignInButtons(_props: SocialSignInButtonsProps) {
  return null;
}
