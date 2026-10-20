/**
 * The washes iOS draws with `.opacity()` come from the theme tokens, so they
 * follow a token change (PlansView's hero fade and back disc, PlanCard's
 * popular border).
 */
import { colors } from '../../../theme';
import { withOpacity } from '../tint';

describe('withOpacity', () => {
  it('draws a token at an opacity, as iOS does', () => {
    expect(withOpacity(colors.rust, 0.4)).toBe('rgba(71,133,194,0.4)');
    expect(withOpacity(colors.ink, 0.3)).toBe('rgba(248,246,241,0.3)');
    expect(withOpacity(colors.ink2, 0.7)).toBe('rgba(242,239,232,0.7)');
  });

  it('multiplies a token that is already translucent', () => {
    expect(withOpacity('rgba(25,28,36,0.5)', 0.5)).toBe('rgba(25,28,36,0.25)');
  });
});
