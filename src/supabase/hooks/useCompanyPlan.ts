/**
 * The first build's company-plan hook, kept for the legacy Account screen
 * (src/screens/account/AccountScreen.tsx) until ACCT-1's screen replaces it.
 * New code reads the context through src/features/account/copay/contextSource
 * (the Account slots), which follows iOS's re-read rules.
 */
import { useCallback, useEffect, useState } from 'react';

import { errorMessage } from '../../api';
import { fetchCompanyPlanContext, type CompanyPlanContext } from '../services/companyPlans';

type CompanyPlanState = {
  context: CompanyPlanContext | null;
  loading: boolean;
  /** The failure in the member's words (never the server's raw body). */
  error: string | null;
  refetch: () => void;
};

export function useCompanyPlan(): CompanyPlanState {
  const [context, setContext] = useState<CompanyPlanContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchCompanyPlanContext()
      .then(setContext)
      .catch((e: unknown) => {
        setContext(null);
        setError(errorMessage(e));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { context, loading, error, refetch: load };
}
