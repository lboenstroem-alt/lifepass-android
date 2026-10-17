/**
 * Account slot (plan 3.0.3, mounted by ACCT-1 between the member card and
 * Billing): the company co-pay banner, a pending activation or a pending
 * invitation (iOS `AccountView.companyPlanBanner`). Nothing when neither
 * applies, or while the context has not loaded or failed to.
 *
 * It reads the context itself, each time the Account screen appears, as iOS
 * does in AccountView's `.task` (see copay/contextSource for how that read
 * is shared with the screen's fallback row).
 */
import CompanyPlanCard from '../copay/CompanyPlanCard';
import { useCopayContext, useReloadCopayContextOnAppear } from '../copay/contextSource';
import { confirmCopayActivation, openCopayKenniSheet, useCopayBusy } from '../copay/copayFlows';
import '../copay/register';

export default function CompanyPlanBanner() {
  useReloadCopayContextOnAppear();
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
