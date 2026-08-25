/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: shared locals for leftover detectCombatDamageTriggers split
 * Public: CombatDamageDetectionState
 */

import type { TriggeredAbility } from "./detectorTriggeredAbility.js";

export interface CombatDamageDetectionState {
  triggers: TriggeredAbility[];
  oracleText: string;
  lowerOracle: string;
  cardName: string;
  lowerName: string;
  permanentId: string;
  combatNameVariants: string[];
  combatDamageSubject: string;
  card: any;
  permanent: any;
}
