/**
 * The first Android build's plan read, kept for the screens that still import
 * it. `GET /subscriptions` is read by the app store now (one shared plan,
 * kept through a failed read); the call itself is src/api/subscriptions.ts.
 */
export { fetchActiveSubscription } from '../../api/subscriptions';
