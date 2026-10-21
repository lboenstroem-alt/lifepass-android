/**
 * Account slot (plan 3.0.3, mounted by ACCT-1 between the member card and
 * Billing): the company co-pay banner, a pending activation or a pending
 * invitation (iOS `AccountView.companyPlanBanner`). Nothing when neither
 * applies, or while the context has not loaded or failed to.
 *
 * The context is read each time the Account screen appears, as iOS does in
 * AccountView's `.task`: by this slot until ACCT-1's screen does it itself
 * (copay/contextStore says how the two share one store), and again whenever
 * a Kenni sheet closes while it is on screen (the verification is where an
 * invitation is claimed), whoever opened the sheet.
 */
import CompanyPlanCard from '../copay/CompanyPlanCard';
import { useCopayContext, useReloadCopayContextOnAppear } from '../copay/contextSource';
import {
  confirmCopayActivation,
  openCopayKenniSheet,
  useContextReadAfterKenni,
  useCopayBusy,
} from '../copay/copayFlows';
import '../copay/register';

export default function CompanyPlanBanner() {
  useReloadCopayContextOnAppear();
  useContextReadAfterKenni();
  const context = useCopayContext();
  const activating = useCopayBusy((state) => state.activating);
  const activation = context?.pendingActivation ?? null;

  return (
    <CompanyPlanCard
      context={context}
      activating={activating}
      onActivate={() => {
        if (activation) confirmCopayActivation(activation);
      }}
      onVerify={openCopayKenniSheet}
    />
  );
}
