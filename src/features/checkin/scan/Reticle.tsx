/**
 * The viewfinder's reticle: four white corner brackets with 28 dp arms and
 * rounded corners, drawn as ONE path so every arm strokes with round caps
 * (iOS `ReticleShape` in Views/CheckIn/QRScannerView.swift).
 *
 * The canvas is the side plus the stroke, so the 4 dp stroke is not clipped at
 * the edges (SwiftUI strokes outside a shape's frame; SVG clips to its box). A
 * faint darker stroke under the white one stands in for iOS's soft shadow, so
 * the brackets read over a bright frame.
 */
import Svg, { Path } from 'react-native-svg';

export const RETICLE_SIDE = 240;
const ARM = 28;
const RADIUS = 14;
const STROKE = 4;

/** iOS `ReticleShape.path(in:)` for a `side` square whose top left is at `inset`. */
export function reticlePath(side: number = RETICLE_SIDE, inset: number = STROKE, arm: number = ARM, radius: number = RADIUS): string {
  const r = Math.min(radius, arm);
  const minX = inset;
  const minY = inset;
  const maxX = inset + side;
  const maxY = inset + side;
  return [
    // Top left
    `M ${minX} ${minY + arm}`,
    `L ${minX} ${minY + r}`,
    `Q ${minX} ${minY} ${minX + r} ${minY}`,
    `L ${minX + arm} ${minY}`,
    // Top right
    `M ${maxX - arm} ${minY}`,
    `L ${maxX - r} ${minY}`,
    `Q ${maxX} ${minY} ${maxX} ${minY + r}`,
    `L ${maxX} ${minY + arm}`,
    // Bottom right
    `M ${maxX} ${maxY - arm}`,
    `L ${maxX} ${maxY - r}`,
    `Q ${maxX} ${maxY} ${maxX - r} ${maxY}`,
    `L ${maxX - arm} ${maxY}`,
    // Bottom left
    `M ${minX + arm} ${maxY}`,
    `L ${minX + r} ${maxY}`,
    `Q ${minX} ${maxY} ${minX} ${maxY - r}`,
    `L ${minX} ${maxY - arm}`,
  ].join(' ');
}

export default function Reticle({ dimmed }: { readonly dimmed: boolean }) {
  const canvas = RETICLE_SIDE + STROKE * 2;
  const d = reticlePath();
  return (
    <Svg width={canvas} height={canvas} style={{ opacity: dimmed ? 0.4 : 1 }}>
      <Path d={d} stroke="rgba(0,0,0,0.22)" strokeWidth={STROKE + 3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d={d} stroke="#FFFFFF" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}
