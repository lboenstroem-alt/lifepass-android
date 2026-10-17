/**
 * The Account feature's public face, for other features (the lint rule
 * `lifepass/feature-boundaries` lets them in only through here or a slot):
 *
 * - the row primitives every Account slot and Body and goals draw with
 *   (./rows.tsx: rows draw their own dividers, the card hides the first);
 * - the company-plan context the screen reads on every appearance, for
 *   ACCT-3's company banner (./companyContext.ts).
 *
 * The screen itself is a route (`Account`, src/navigation/sharedRoutes).
 */
export {
  AccountCard,
  AccountRowButton,
  AccountRowDivider,
  AccountRowLabel,
  AccountSection,
  accountRowLabel,
  type AccountRowButtonProps,
  type AccountRowLabelProps,
} from './rows';
export {
  loadCompanyContext,
  resetCompanyContext,
  useCompanyContext,
  type CompanyContext,
  type CompanyContextState,
} from './companyContext';
