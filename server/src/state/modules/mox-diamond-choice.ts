/**
 * Back-compat re-exports — Mox Diamond uses the shared would-enter replacement module.
 */

export {
  hasWouldEnterDiscardLandReplacement as isMoxDiamondCard,
  isLandCardForWouldEnterDiscard as isLandCardForMoxDiscard,
  buildWouldEnterDiscardLandHandOptions as buildMoxDiamondLandOptions,
  queueWouldEnterDiscardLandChoiceForStackItem as queueMoxDiamondChoiceForStackItem,
  tryQueueWouldEnterDiscardLandBeforeStackResolve as tryQueueMoxDiamondBeforeStackResolve,
} from './land-would-enter-replacement.js';
