// Android-only copy for CHECKIN-1: Scan tab, QR rules, check-in links, staff proof.
//
// Owned by CHECKIN-1 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
//
// Empty on purpose: every word the Scan tab, its camera states, the QR
// refusals, the chip, "Scan another code" and the staff proof say is iOS's
// own (checkin.*, scan.*, common.*), and Android adds none.
import { definePack } from './pack';

export default definePack({
  en: {},
  is: {},
});
