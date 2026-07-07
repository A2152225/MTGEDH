import type { GameState } from '../../shared/src';
import type { ActivatedAbility } from './activatedAbilities';
import { parseActivatedAbilityCostReducerSpecsFromPermanent } from './activatedAbilityCostReductionOracle';
import type { ManaCost } from './types/mana';

export type ActivatedAbilitySourceZone = 'battlefield' | 'graveyard' | 'hand';

export interface ActivatedAbilityCostReducerConfig {
  readonly nameMatch: string;
  readonly cardName: string;
  readonly genericReduction: number;
  /** Minimum total mana symbols that must remain after this reducer applies. */
  readonly minimumTotalMana: number;
  /** Reducer permanent must be controlled by the activating player. */
  readonly reducerControllerScope: 'you_control' | 'any';
  /** Source permanent/card must be controlled by the activating player. */
  readonly sourceControllerScope?: 'you_control' | 'any';
  /** Source must be in this zone. */
  readonly sourceZone?: ActivatedAbilitySourceZone | 'any';
  readonly sourceTypes?: readonly string[];
  readonly sourceMustBeToken?: boolean;
  readonly excludesManaAbilities?: boolean;
  readonly requiresCommander?: boolean;
}

export interface ActivatedAbilityCostReductionContext {
  readonly state: GameState;
  readonly playerId: string;
  readonly ability: ActivatedAbility;
  readonly sourceZone?: ActivatedAbilitySourceZone;
  readonly sourceCard?: any;
  readonly sourcePermanent?: any;
}

export interface ActivatedAbilityCostReductionResult {
  readonly manaCost?: ManaCost;
  readonly log: readonly string[];
}

function hasType(source: any, type: string): boolean {
  const typeLine = String(
    source?.card?.type_line
    || source?.type_line
    || source?.card?.typeLine
    || '',
  ).toLowerCase();
  return typeLine.includes(type.toLowerCase());
}

function isArtifactToken(source: any): boolean {
  const isToken = source?.isToken === true || source?.card?.isToken === true;
  return isToken && hasType(source, 'artifact');
}

export function getTotalMana(cost?: ManaCost): number {
  if (!cost) return 0;
  return (
    Number(cost.white || 0)
    + Number(cost.blue || 0)
    + Number(cost.black || 0)
    + Number(cost.red || 0)
    + Number(cost.green || 0)
    + Number(cost.colorless || 0)
    + Number(cost.generic || 0)
  );
}

export function applyTotalManaReductionWithFloor(
  manaCost: ManaCost,
  reduction: number,
  minimumTotalMana: number,
): { manaCost: ManaCost; amountReduced: number } {
  const totalMana = getTotalMana(manaCost);
  const maxReducible = Math.max(0, totalMana - minimumTotalMana);
  const allowedReduction = Math.min(Math.max(0, reduction), maxReducible);
  if (allowedReduction <= 0) {
    return { manaCost, amountReduced: 0 };
  }

  let remaining = allowedReduction;
  const next: ManaCost = {
    white: Number(manaCost.white || 0),
    blue: Number(manaCost.blue || 0),
    black: Number(manaCost.black || 0),
    red: Number(manaCost.red || 0),
    green: Number(manaCost.green || 0),
    colorless: Number(manaCost.colorless || 0),
    generic: Number(manaCost.generic || 0),
    ...(manaCost.x !== undefined ? { x: manaCost.x } : {}),
  };

  const colorKeys: Array<keyof ManaCost> = ['generic', 'colorless', 'white', 'blue', 'black', 'red', 'green'];
  for (const key of colorKeys) {
    if (remaining <= 0) break;
    const current = Number(next[key] || 0);
    if (current <= 0) continue;
    const removed = Math.min(current, remaining);
    (next as any)[key] = current - removed;
    remaining -= removed;
  }

  return { manaCost: next, amountReduced: allowedReduction - remaining };
}

function playerControlsCommander(state: any, playerId: string): boolean {
  const commanderInfo = state?.commandZone?.[playerId];
  const commanderIds = Array.isArray(commanderInfo?.commanderIds) ? commanderInfo.commanderIds : [];
  if (commanderIds.length === 0) return false;

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.some((perm: any) => {
    if (!perm || String(perm.controller || '') !== String(playerId)) return false;
    const cardId = String(perm.card?.id || perm.id || '').trim();
    if (cardId && commanderIds.includes(cardId)) return true;
    if (perm.isCommander === true) return true;
    return false;
  });
}

function resolveAbilitySource(
  state: any,
  ability: ActivatedAbility,
  context?: Pick<ActivatedAbilityCostReductionContext, 'sourceZone' | 'sourceCard' | 'sourcePermanent'>,
): { source: any; zone: ActivatedAbilitySourceZone } | null {
  if (context?.sourcePermanent) {
    return {
      source: context.sourcePermanent,
      zone: context.sourceZone === 'graveyard' ? 'graveyard' : 'battlefield',
    };
  }

  if (context?.sourceCard) {
    return {
      source: context.sourceCard,
      zone: context.sourceZone === 'graveyard' ? 'graveyard' : 'battlefield',
    };
  }

  const sourceId = String(ability.sourceId || '').trim();
  if (!sourceId) return null;

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const battlefieldSource = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId);
  if (battlefieldSource) {
    return { source: battlefieldSource, zone: 'battlefield' };
  }

  const zonesByPlayer = state?.zones && typeof state.zones === 'object' ? state.zones : {};
  for (const [ownerId, zones] of Object.entries(zonesByPlayer)) {
    const graveyard = Array.isArray((zones as any)?.graveyard) ? (zones as any).graveyard : [];
    const graveyardSource = graveyard.find((card: any) => String(card?.id || '').trim() === sourceId);
    if (graveyardSource) {
      return {
        source: {
          ...graveyardSource,
          controller: ownerId,
          card: graveyardSource,
        },
        zone: 'graveyard',
      };
    }
  }

  return null;
}

function reducerApplies(
  reducerPermanent: any,
  config: ActivatedAbilityCostReducerConfig,
  playerId: string,
  source: any,
  sourceZone: ActivatedAbilitySourceZone,
  ability: ActivatedAbility,
  state: any,
): boolean {
  if (config.reducerControllerScope === 'you_control'
    && String(reducerPermanent?.controller || '').trim() !== String(playerId)) {
    return false;
  }

  if (config.requiresCommander && !playerControlsCommander(state, playerId)) {
    return false;
  }

  if (config.excludesManaAbilities && ability.isManaAbility) {
    return false;
  }

  if (config.sourceZone && config.sourceZone !== 'any' && config.sourceZone !== sourceZone) {
    return false;
  }

  if (sourceZone === 'hand' && config.sourceTypes && config.sourceTypes.length > 0 && !config.sourceZone) {
    return false;
  }

  const sourceController = String(source?.controller || playerId);
  if (config.sourceControllerScope === 'you_control' && sourceController !== String(playerId)) {
    return false;
  }

  if (config.sourceMustBeToken && !isArtifactToken(source)) {
    return false;
  }

  if (config.sourceTypes && config.sourceTypes.length > 0) {
    const matchesType = config.sourceTypes.some((type) => {
      if (type === 'artifact' && config.sourceMustBeToken) {
        return isArtifactToken(source);
      }
      return hasType(source, type);
    });
    if (!matchesType) return false;
  }

  return true;
}

export function applyActivatedAbilityCostReductions(
  args: ActivatedAbilityCostReductionContext,
): ActivatedAbilityCostReductionResult {
  const { state, playerId, ability } = args;
  if (!ability.manaCost) {
    return { manaCost: ability.manaCost, log: [] };
  }

  const resolvedSource = resolveAbilitySource(state as any, ability, args);
  if (!resolvedSource) {
    return { manaCost: ability.manaCost, log: [] };
  }

  let nextManaCost: ManaCost = { ...ability.manaCost };
  const logs: string[] = [];
  const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];

  for (const permanent of battlefield) {
    const reducerSpecs = parseActivatedAbilityCostReducerSpecsFromPermanent(permanent);
    for (const config of reducerSpecs) {
      if (!reducerApplies(permanent, config, playerId, resolvedSource.source, resolvedSource.zone, ability, state)) {
        continue;
      }

      const applied = applyTotalManaReductionWithFloor(
        nextManaCost,
        config.genericReduction,
        config.minimumTotalMana,
      );
      if (applied.amountReduced <= 0) continue;

      nextManaCost = applied.manaCost;
      logs.push(`${config.cardName} reduced ${ability.sourceName || 'ability'} activation cost by {${applied.amountReduced}}`);
    }
  }

  return { manaCost: nextManaCost, log: logs };
}
