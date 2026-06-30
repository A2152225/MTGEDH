import type { OracleGraveyardAdditionalCost } from './oracleIR.ts';

export type SerializableGrantedAdditionalCost = {
  type: 'discard' | 'sacrifice' | 'remove_counters' | 'exile_from_graveyard';
  amount: number;
  filter?: string;
  counterType?: string;
  distributed?: boolean;
};

export function oracleGraveyardAdditionalCostToSerializable(
  cost: OracleGraveyardAdditionalCost | undefined | null,
): SerializableGrantedAdditionalCost | undefined {
  if (!cost || typeof cost !== 'object') {
    return undefined;
  }

  switch (cost.kind) {
    case 'discard':
      return {
        type: 'discard',
        amount: Math.max(1, Number(cost.count || 0)),
        ...(cost.filterText ? { filter: cost.filterText } : {}),
      };
    case 'sacrifice':
      return {
        type: 'sacrifice',
        amount: Math.max(1, Number(cost.count || 0)),
        ...(cost.filterText ? { filter: cost.filterText } : {}),
      };
    case 'exile_from_graveyard':
      return {
        type: 'exile_from_graveyard',
        amount: Math.max(1, Number(cost.count || 0)),
      };
    case 'remove_counter':
      return {
        type: 'remove_counters',
        amount: cost.count === 'any' ? 1 : Math.max(0, Number(cost.count || 0)),
        distributed: cost.count === 'any',
        ...(cost.filterText ? { filter: cost.filterText } : {}),
        ...(cost.counter ? { counterType: cost.counter } : {}),
      };
    default:
      return undefined;
  }
}
