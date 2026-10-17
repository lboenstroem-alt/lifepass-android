import { useEffect, useState } from 'react';

import { fetchPlanCatalog, type PlanCatalog } from '../services/catalog';

/**
 * @deprecated The Plans screen reads its catalogue from src/features/plans
 * (`usePlanCatalog` and `loadPlanCatalog` there, one catalogue per visit).
 * This first-build hook is kept for anything still written against it and is
 * deleted by QA-1: it reads the live priced catalogue once on mount, and a
 * failure resolves to `null` (the caller renders cards without prices
 * rather than blocking), as iOS's `try? await fetchPlanCatalog()`.
 */
export function usePlanCatalog(): PlanCatalog | null {
  const [catalog, setCatalog] = useState<PlanCatalog | null>(null);

  useEffect(() => {
    let alive = true;
    fetchPlanCatalog()
      .then((c) => {
        if (alive) setCatalog(c);
      })
      .catch(() => {
        // No prices available: the cards still render.
      });
    return () => {
      alive = false;
    };
  }, []);

  return catalog;
}
