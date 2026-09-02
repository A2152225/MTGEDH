/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover BlockTrigger (evolved leftover copy)
 * Public: BlockTrigger
 */
export interface BlockTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType?: string;
  description: string;
  effect?: string;
  mandatory: boolean;
  oncePerTurn?: boolean;
  blockedCreatureId?: string;
  requiredTypePhrase?: string;
  createTokens?: {
    count: number;
    power: number;
    toughness: number;
    type: string;
    color: string;
    abilities?: string[];
  };
}
