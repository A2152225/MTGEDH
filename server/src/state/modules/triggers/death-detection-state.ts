/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: shared locals for leftover detectDeathTriggers split
 * Public: DeathDetectionState
 */

import type { TriggeredAbility } from "./detectorTriggeredAbility.js";

export interface DeathDetectionState {
  triggers: TriggeredAbility[];
  oracleText: string;
  lowerOracle: string;
  cardName: string;
  lowerName: string;
  permanentId: string;
  counters: any;
  dieNameVariants: string[];
  dieSelfAlternatives: string[];
}
