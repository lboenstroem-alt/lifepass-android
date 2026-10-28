/**
 * Route `HealthConnectDetail`: Health Connect is NOT built (owner decision,
 * DECISIONS.md). The route exists so the route list matches the plan, and it
 * renders nothing, permanently: where iOS shows Apple Health, Android shows
 * nothing (no "coming soon"). Nothing navigates here.
 */
import type { SharedRouteProps } from '../types';

export default function HealthConnectDetailScreen(_props: SharedRouteProps<'HealthConnectDetail'>) {
  return null;
}
