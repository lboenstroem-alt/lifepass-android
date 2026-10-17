/**
 * The check-in proof (CHECKIN-1): the screen a member holds up at reception,
 * live after a walk-in and re-offered on Home.
 *
 *   CheckInProofDisplay    the proof itself (also a published slot: the
 *                          walk-in flow's success cover, CHECKIN-2, draws it
 *                          with its pulsing tick)
 *   CheckInProofCover      the proof full screen, with Done (Home's re-offer)
 *   SealMark               the re-offered proof's still seal
 *   proofFormat            the words: Reykjavík time, the day in the
 *                          account's language, the summary, the receipt
 */
export { default as CheckInProofDisplay, type CheckInProofDisplayProps } from './CheckInProofDisplay';
export { default as CheckInProofCover, type CheckInProofCoverProps } from './CheckInProofCover';
export { SealMark, sealMarkSize } from './marks';
export * from './proofFormat';
