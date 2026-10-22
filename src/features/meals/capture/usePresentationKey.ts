/**
 * A key that changes each time a sheet is presented, so its form starts
 * fresh every time (SwiftUI makes new `@State` per sheet presentation).
 *
 *   const key = usePresentationKey(props.visible);
 *   return <Form key={key} {...props} />;
 *
 * DERIVED WHILE RENDERING, not in an effect: an effect would first render
 * the previous form with `visible` true (its sheet presents, with the
 * cancelled form's values, for a frame) and only then remount a new one
 * that presents again. Adjusting state during render (React's "storing
 * information from previous renders") makes React redo this render before
 * anything is committed, so only the fresh form is ever shown.
 */
import { useState } from 'react';

export function usePresentationKey(visible: boolean): number {
  const [state, setState] = useState({ key: 0, visible });
  if (state.visible !== visible) {
    const next = { key: visible ? state.key + 1 : state.key, visible };
    setState(next);
    return next.key;
  }
  return state.key;
}
