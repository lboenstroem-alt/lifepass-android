/**
 * The steps a Plan sheet runs once the server has answered a write (Log a
 * workout's Save, No energy's move or skip): analytics, handing the answer
 * to the card, the toast.
 *
 * ONLY THE REQUEST CAN FAIL THE WRITE. Once the server has answered, the
 * workout is logged (or the session moved): a step that throws after that
 * must not read as a failed Save, or the sheet would stay open on "Something
 * went wrong" and a retry would go out under a NEW Idempotency-Key, logging
 * the workout (or moving the session) a second time. On iOS these steps are
 * closures that cannot throw; here each one runs on its own, a throw is
 * reported, and the rest still run (the sheet still closes).
 */
export function afterAnswer(step: () => void): void {
  try {
    step();
  } catch (error) {
    // Reported, not swallowed, in a development build: a refused analytics
    // param, for one, throws there on purpose. Tests stay quiet.
    if (__DEV__ && process.env.NODE_ENV !== 'test') console.error('[plan] a step after the answer failed', error);
  }
}
