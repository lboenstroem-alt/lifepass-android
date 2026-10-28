/**
 * The workout runner's model (RUN-1): the in-progress workout and every rule
 * that changes it, pure and told the time. The screen (RUN-2) and the swap,
 * skip and finish sheets (RUN-3) build on this; nothing here touches a file,
 * the network or the clock.
 *
 *   import * as Runner from '../model';
 *   const { state, outcome } = Runner.tick(previous, 0, 1, new Date());
 */
export * from './types';
export * from './exercise';
export * from './timer';
export * from './state';
export * from './performed';
export * from './codec';
export * from './analytics';
