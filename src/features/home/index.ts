// What other features may use of Home (the feature-boundaries lint rule lets
// them in through this file only).
//
// The cards other packages draw inside Home (plan 3.0.3 slots: the Outside
// card) follow Home's reads with `useOnHomeRead` (./homeReads.ts says how).
// Signalling a read is Home's alone and is not exported.
export { useHomeReads, useOnHomeRead } from './homeReads';
