import type { GameState } from '../../shared/src';
import type { ActivatedAbility } from './activatedAbilities';
import type { ManaCost } from './types/mana';

interface ActivatedAbilityCostReducerConfig {
  readonly cardName: string;
  readonly genericReduction: number;
  readonly minimumTotalMana: number;
  readonly controllerScope: 'you_control' | 'any';
  readonly sourceTypes?: readonly string[];
  readonly excludesManaAbilities?: boolean;
}

interface ActivatedAbilityCostReductionResult {
  readonly manaCost?: ManaCost;
  readonly log: readonly string[];
}

const ACTIVATED_ABILITY_COST_REDUCERS: Record<string, ActivatedAbilityCostReducerConfig> = {
  'training grounds': {
    cardName: 'Training Grounds',
    genericReduction: 2,
    minimumTotalMana: 1,
    controllerScope: 'you_control',
    sourceTypes: ['creature'],
  },
  "biomancer's familiar": {
    cardName: "Biomancer's Familiar",
    genericReduction: 2,
    minimumTotalMana: 1,
    controllerScope: 'you_control',
    sourceTypes: ['creature'],
  },
  zirda: {
    cardName: 'Zirda',
    genericReduction: 2,
    minimumTotalMana: 1,
    controllerScope: 'you_control',
    excludesManaAbilities: true,
  },
  heartstone: {
    cardName: 'Heartstone',
    genericReduction: 1,
    minimumTotalMana: 1,
    controllerScope: 'any',
    sourceTypes: ['creature'],
  },
};

function hasType(permanent: any, type: string): boolean {
  const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
  return typeLine.includes(type.toLowerCase());
}

function getTotalMana(cost?: ManaCost): number {
  if (!cost) return 0;
  return (
    Number(cost.white || 0) +
    Number(cost.blue || 0) +
    Number(cost.black || 0) +
    Number(cost.red || 0) +
    Number(cost.green || 0) +
    Number(cost.colorless || 0) +
    Number(cost.generic || 0)
  );
}

function applyGenericReductionWithFloor(
  manaCost: ManaCost,
  reduction: number,
  minimumTotalMana: number
): { manaCost: ManaCost; amountReduced: number } {
  const totalMana = getTotalMana(manaCost);
  const maxReducible = Math.max(0, totalMana - minimumTotalMana);
  const allowedReduction = Math.min(Math.max(0, reduction), maxReducible);
  const genericBefore = Number(manaCost.generic || 0);
  const genericReduction = Math.min(genericBefore, allowedReduction);
  if (genericReduction <= 0) {
    return { manaCost, amountReduced: 0 };
  }

  return {
    manaCost: {
      ...manaCost,
      generic: Math.max(0, genericBefore - genericReduction),
    },
    amountReduced: genericReduction,
  };
}

function reducerApplies(
  reducerPermanent: any,
  config: ActivatedAbilityCostReducerConfig,
  playerId: string,
  sourcePermanent: any,
  ability: ActivatedAbility
): boolean {
  if (config.controllerScope === 'you_control' && String(reducerPermanent?.controller || '').trim() !== playerId) {
    return false;
  }
  if (config.excludesManaAbilities && ability.isManaAbility) return false;
  if (config.sourceTypes && config.sourceTypes.length > 0) {
    return config.sourceTypes.some(type => hasType(sourcePermanent, type));
  }
  return true;
}

export function applyActivatedAbilityCostReductions(args: {
  state: GameState;
  playerId: string;
  ability: ActivatedAbility;
}): ActivatedAbilityCostReductionResult {
  const { state, playerId, ability } = args;
  if (!ability.manaCost) {
    return { manaCost: ability.manaCost, log: [] };
  }

  const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];
  const sourceId = String(ability.sourceId || '').trim();
  const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId);
  if (!sourcePermanent) {
    return { manaCost: ability.manaCost, log: [] };
  }

  let nextManaCost: ManaCost = { ...ability.manaCost };
  const logs: string[] = [];

  for (const permanent of battlefield) {
    const reducerName = String(permanent?.card?.name || permanent?.name || '').trim().toLowerCase();
    const config = ACTIVATED_ABILITY_COST_REDUCERS[reducerName];
    if (!config) continue;
    if (!reducerApplies(permanent, config, playerId, sourcePermanent, ability)) continue;

    const applied = applyGenericReductionWithFloor(nextManaCost, config.genericReduction, config.minimumTotalMana);
    if (applied.amountReduced <= 0) continue;

    nextManaCost = applied.manaCost;
    logs.push(`${config.cardName} reduced ${ability.sourceName}'s activation cost by {${applied.amountReduced}}`);
  }

  return { manaCost: nextManaCost, log: logs };
}

