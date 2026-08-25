/**
 * Origin parent: oracleIRExecutorModifyPtStepHandlers.ts
 * Cluster moved: ModifyPtRuntime
 * Public: ModifyPtRuntime
 */

import type { BattlefieldPermanent } from '../../../shared/src';
import type { LastKnownPermanentSnapshot } from '../oracleIRExecutorLastKnownInfo';

export type ModifyPtRuntime = {
  readonly lastRevealedCardCount?: number;
  readonly lastDiscardedCardCount?: number;
  readonly lastGreatestDiscardedCardCount?: number;
  readonly lastDiscardedCards?: readonly any[];
  readonly lastExiledCardCount?: number;
  readonly lastExiledCards?: readonly any[];
  readonly lastMovedCards?: readonly any[];
  readonly lastGoadedCreatures?: readonly BattlefieldPermanent[];
  readonly lastSacrificedCreaturesPowerTotal?: number;
  readonly lastSacrificedPermanents?: readonly LastKnownPermanentSnapshot[];
  readonly lastDestroyedPermanents?: readonly any[];
  readonly lastExcessDamageDealtThisWay?: number;
  readonly lastScryLookedAtCount?: number;
  readonly lastTappedMatchingPermanentCount?: number;
  readonly lastReferenceAmount?: number;
};
