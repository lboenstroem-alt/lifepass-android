/**
 * iOS `ViewThatFits(in: .horizontal)` for the runner's rows and rest bar: lay
 * the parts out side by side when they fit, else stack them.
 *
 * Android has no "first layout that fits", so the parts are measured where
 * they are drawn (each keeps its natural width in either layout: nothing
 * stretches them) and the container's width is measured too; `fits` says
 * whether the widths plus the gaps fit.
 *
 * A part only ever grows here (the widest it has been): a countdown whose
 * text narrows from "1:05 left" to "9 s left" would otherwise flip a row
 * between its two layouts as it counts. A row of the next exercise (or of
 * a swapped one) is a new component and measures afresh: RunnerExerciseCard
 * keys its rows by exercise. The rest bar keeps its measures across rests
 * (RunnerBottomBar holds them), so a later rest is drawn in its layout at
 * once.
 */
import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

export interface Fit {
  /** The container's width, 0 until measured. */
  readonly width: number;
  /** The widest each part has been, by key; absent until measured. */
  readonly parts: Readonly<Record<string, number>>;
  onContainerLayout(event: LayoutChangeEvent): void;
  /** The `onLayout` of the part named `key`. */
  onPartLayout(key: string): (event: LayoutChangeEvent) => void;
}

export function useFit(): Fit {
  const [width, setWidth] = useState(0);
  const [parts, setParts] = useState<Readonly<Record<string, number>>>({});
  const onContainerLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setWidth((previous) => (previous === next ? previous : next));
  }, []);
  const onPartLayout = useCallback(
    (key: string) => (event: LayoutChangeEvent) => {
      const next = Math.ceil(event.nativeEvent.layout.width);
      setParts((previous) => ((previous[key] ?? 0) >= next ? previous : { ...previous, [key]: next }));
    },
    [],
  );
  return { width, parts, onContainerLayout, onPartLayout };
}

/**
 * Whether `keys` (and `fixed` widths) fit side by side in `available` with
 * `gap` between them. Unknown until every part and the container are
 * measured: then `fallback`.
 */
export function fitsInRow(
  fit: Pick<Fit, 'parts'>,
  available: number,
  keys: readonly string[],
  options: { readonly gap: number; readonly fixed?: number; readonly fixedCount?: number; readonly fallback: boolean },
): boolean {
  if (available <= 0) return options.fallback;
  let total = options.fixed ?? 0;
  for (const key of keys) {
    const width = fit.parts[key];
    if (width === undefined) return options.fallback;
    total += width;
  }
  const count = keys.length + (options.fixedCount ?? 0);
  total += Math.max(0, count - 1) * options.gap;
  return total <= available;
}
