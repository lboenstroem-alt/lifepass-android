/**
 * The figure a session kind is drawn with (iOS `SessionKind.symbolName`):
 * the gate's sample week here, and the Today card, the plan overview and the
 * history in their packages. iOS uses SF Symbols' activity figures
 * (`figure.strengthtraining.traditional`, `figure.pool.swim`, ...); Material
 * Community Icons has the same figures, so the two apps draw the same thing.
 * Decoration only: every row that shows one also says its kind in words.
 */
import type MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';

import type { SessionKind } from '../../../health';

export type SessionKindIcon = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function sessionKindIcon(kind: SessionKind | null | undefined): SessionKindIcon {
  switch (kind) {
    case 'strength':
      return 'weight-lifter';
    case 'cardio':
      return 'run';
    case 'mobility':
      return 'human-handsup';
    case 'swim':
      return 'swim';
    case 'hike':
      return 'hiking';
    case 'walk':
      return 'walk';
    case 'class':
      return 'yoga';
    case 'rest':
      return 'power-sleep';
    default:
      return 'circle-outline';
  }
}
