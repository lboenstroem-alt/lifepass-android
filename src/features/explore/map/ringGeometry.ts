// One drawing of a venue ring, as data: the port of iOS `VenueRingView`
// (Views/Search/SearchMapView.swift), itself the web's `venueRingStyle`. The
// 44 pt pin, the 20 pt legend swatch and the 10 pt card swatch all come from
// here, so the three can never disagree; `VenueRing` turns the layers into
// SVG.
//
// THE RECIPE. The ring is the circle's own fill and the content (the photo,
// or the grey stand-in) sits on top of it, inset by the ring's width; the
// forms are concentric circles and wedges, never a dashed stroke:
//   - every ring keeps an outer hairline, 1 pt wider all round (ink at 55 %),
//     which holds the white ring at about 3:1 on the light basemap;
//   - solid types are one disc of their colour;
//   - gym + pool is white and ink split on the diagonal (the web's CSS
//     conic gradient from 45 degrees: white from half past one round to half
//     past seven, ink the other half), with the pool's white inner hairline;
//   - pool keeps a 70 % white inner hairline, so the ink band still reads
//     against a dark photo;
//   - spa and recovery is a double ring: moss, a white gap, moss;
//   - racquet is framed by an ink hairline inside the ring;
//   - coming soon is 12 grey dashes with white gaps (18 and 12 degrees),
//     from the top, whatever the type: the only dashed ring on the map.
// Angles are degrees clockwise from 3 o'clock (y grows down), as SwiftUI's.
import { mapRing, mapRingHex } from '../../../theme';
import type { VenueMarkerType } from '../../../lib/venueMarkerType';

/** The three sizes a ring is drawn at. */
export type RingSize = 'pin' | 'legend' | 'card';

/** The ring's outer diameter (iOS `VenueRingView.Size.diameter`). */
export const RING_DIAMETER: Readonly<Record<RingSize, number>> = { pin: 44, legend: 20, card: 10 };

/** A filled circle centred in the ring. */
export interface DiscLayer {
  readonly kind: 'disc';
  readonly diameter: number;
  readonly fill: string;
}

/** A pie slice of the ring's disc (the content covers its middle). */
export interface WedgeLayer {
  readonly kind: 'wedge';
  readonly diameter: number;
  /** Degrees clockwise from 3 o'clock. */
  readonly startDeg: number;
  readonly sweepDeg: number;
  readonly fill: string;
}

export type RingLayer = DiscLayer | WedgeLayer;

export interface RingGeometry {
  /** The ring's diameter (without the outer hairline). */
  readonly diameter: number;
  /** The whole drawing's size: the ring plus its 1 pt outer hairline all round. */
  readonly outer: number;
  /** How far in the content sits: the ring's width (more for the double ring). */
  readonly inset: number;
  /** The content's diameter. */
  readonly inner: number;
  /** Drawn in order, the first at the back; the content goes on top of the last. */
  readonly layers: readonly RingLayer[];
}

const DASHES = 12;
/** A dash's share of its twelfth (18 of 30 degrees); the rest is the white gap. */
const DASH_SHARE = 0.6;

/** The layers for a type's ring at a size. */
export function ringGeometry(type: VenueMarkerType, comingSoon: boolean, size: RingSize): RingGeometry {
  const diameter = RING_DIAMETER[size];
  const small = size === 'card';
  const width = small ? 2 : 3;
  const inset = !comingSoon && type === 'recovery' ? (small ? 3 : 4) : width;
  const inner = diameter - inset * 2;
  const outer = diameter + 2;

  const layers: RingLayer[] = [{ kind: 'disc', diameter: outer, fill: mapRing.outerHairline }];

  if (comingSoon) {
    layers.push({ kind: 'disc', diameter, fill: mapRing.gym });
    for (let index = 0; index < DASHES; index += 1) {
      layers.push({
        kind: 'wedge',
        diameter,
        startDeg: -90 + (index * 360) / DASHES,
        sweepDeg: (360 / DASHES) * DASH_SHARE,
        fill: mapRing.soon,
      });
    }
    return { diameter, outer, inset, inner, layers };
  }

  if (type === 'gymPool') {
    layers.push({ kind: 'wedge', diameter, startDeg: -45, sweepDeg: 180, fill: mapRing.gym });
    layers.push({ kind: 'wedge', diameter, startDeg: 135, sweepDeg: 180, fill: mapRing.pool });
  } else {
    layers.push({ kind: 'disc', diameter, fill: mapRingHex(type) });
  }

  // The web's inner box shadows: a hairline, the double ring's white gap,
  // the racquet frame.
  switch (type) {
    case 'pool':
    case 'gymPool':
      layers.push({ kind: 'disc', diameter: inner + 2, fill: mapRing.innerHairline });
      break;
    case 'recovery': {
      const first = small ? 1 : 1.5;
      const second = small ? 2 : 2.5;
      layers.push({ kind: 'disc', diameter: inner + second * 2, fill: mapRing.gym });
      layers.push({ kind: 'disc', diameter: inner + first * 2, fill: mapRing.recovery });
      break;
    }
    case 'racquet': {
      const frame = small ? 1 : 1.5;
      layers.push({ kind: 'disc', diameter: inner + frame * 2, fill: mapRing.ink });
      break;
    }
    case 'gym':
    case 'lagoon':
    case 'studio':
      break;
  }
  return { diameter, outer, inset, inner, layers };
}

/**
 * An SVG path for a wedge of a circle centred at (`centre`, `centre`): from
 * the centre out to the arc and back. Arcs are drawn in steps of at most 90
 * degrees, so a half circle never leaves the arc's direction ambiguous.
 */
export function wedgePath(centre: number, radius: number, startDeg: number, sweepDeg: number): string {
  const point = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return `${round(centre + radius * Math.cos(rad))} ${round(centre + radius * Math.sin(rad))}`;
  };
  const steps = Math.max(1, Math.ceil(Math.abs(sweepDeg) / 90));
  let path = `M ${round(centre)} ${round(centre)} L ${point(startDeg)}`;
  for (let step = 1; step <= steps; step += 1) {
    path += ` A ${round(radius)} ${round(radius)} 0 0 1 ${point(startDeg + (sweepDeg * step) / steps)}`;
  }
  return `${path} Z`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
