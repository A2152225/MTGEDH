/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: shared locals for leftover detectSpellCastTriggers split
 * Public: SpellCastDetectionState
 */

import type { SpellCastTrigger } from "./spell-cast-trigger-type.js";

export interface SpellCastDetectionState {
  triggers: SpellCastTrigger[];
  oracleText: string;
  lowerOracle: string;
  cardName: string;
  permanentId: string;
  controllerId: string;
  card: any;
  permanent: any;
  state?: unknown;
  getSpellCastConditionData: (spellType: string) => Pick<SpellCastTrigger, 'spellCondition' | 'tribalType'>;
  getSpellCastEffectMetadata: (effectText: string, tribalType?: string) => {
    copiesSpell: boolean;
    isTapUntap: boolean;
    createsToken: boolean;
    tokenDetails: SpellCastTrigger['tokenDetails'];
    isOptional: boolean;
    optionalPaymentCost?: string;
  };
}
