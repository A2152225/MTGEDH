/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: shared locals for leftover detectETBTriggers split
 * Public: EtbDetectionState
 */

import type { TriggeredAbility } from "./detectorTriggeredAbility.js";

export interface EtbDetectionState {
  triggers: TriggeredAbility[];
  oracleText: string;
  lowerOracle: string;
  cardName: string;
  lowerName: string;
  permanentId: string;
  etbNameVariants: string[];
  etbAlternatives: string[];
  card: any;
  permanent: any;
}
