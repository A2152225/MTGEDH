/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: shared locals for leftover detectAttackTriggers split
 * Public: AttackDetectionState
 */

import type { TriggeredAbility } from "./detectorTriggeredAbility.js";

export interface AttackDetectionState {
  triggers: TriggeredAbility[];
  oracleText: string;
  lowerOracle: string;
  cardName: string;
  lowerName: string;
  permanentId: string;
  controllerId: string;
  optionalManaPaymentPattern: RegExp;
  attackNameVariants: string[];
  findGenericAttackTriggerLine: () => RegExpMatchArray | null;
  card: any;
  permanent: any;
}
