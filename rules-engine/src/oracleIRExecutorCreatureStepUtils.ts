import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import { permanentHasCreatureType } from '../../shared/src/creatureTypes.js';
import type { OracleObjectSelector } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { normalizeOracleText } from './oracleIRExecutorPlayerUtils';
import { getCounterCountOnObject } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower, hasExecutorClass, isExecutorCreature } from './oracleIRExecutorPermanentUtils';
import { getCombinedPermanentText } from './permanentText';
import { applyStaticAbilitiesToBattlefield } from './staticAbilities';
import { describeSetterOrdering } from './oracleIRExecutorEffectTimestamps';
import { stampMissingTimestampsOnBattlefieldCopy } from './permanentTimestamps';
import {
  getProcessedBattlefield,
  permanentHasSubtype,
  readPermanentPower,
  readPermanentToughness,
  permanentIsCreature,
  isMassTapOrUntapSelectorText,
  getSourceBattlefieldPermanent,
  getControlledPermanents,
} from './oracleIRExecutorCreatureStepUtils-handlers/oracleIRExecutorCreatureBattlefieldLookup';
export {
  getProcessedBattlefield,
  permanentHasSubtype,
  readPermanentPower,
  readPermanentToughness,
  permanentIsCreature,
  isMassTapOrUntapSelectorText,
  getSourceBattlefieldPermanent,
  getControlledPermanents,
};

export {
  isAttackingPermanent,
  isBlockingPermanent,
  permanentHasKeyword,
  readPowerForComparison,
  readCreatureStatForComparison,
  readToughnessForComparison,
  resolveBlockersOfPermanent,
  resolveBlockingCreatureIds,
  isUnblockedAttackingPermanent,
} from './oracleIRExecutorCreatureStepUtils-handlers/oracleIRExecutorCreatureBattlefieldHelpers';


import {
  resolveMentorTargetCreatureIdFromBattlefield,
  resolveCreatureExtremaQualifiedTargetIdFromBattlefield,
  resolveBolsterTargetCreatureIdFromBattlefield,
  resolveTrepanationBoostTargetCreatureId,
  resolveSingleCreatureTargetId,
} from './oracleIRExecutorCreatureStepUtils-handlers/oracleIRExecutorCreatureSingleTarget';
export {
  resolveMentorTargetCreatureIdFromBattlefield,
  resolveCreatureExtremaQualifiedTargetIdFromBattlefield,
  resolveBolsterTargetCreatureIdFromBattlefield,
  resolveTrepanationBoostTargetCreatureId,
  resolveSingleCreatureTargetId,
};

export { resolveCreatureTargetIds } from './oracleIRExecutorCreatureStepUtils-handlers/oracleIRExecutorCreatureTargetIds';

export function applyTemporaryPowerToughnessModifier(
  state: GameState,
  creatureId: string,
  ctx: OracleIRExecutionContext,
  powerBonus: number,
  toughnessBonus: number,
  markTrepanation: boolean,
  duration: 'end_of_turn' | 'until_next_turn' | 'end_of_combat' = 'end_of_turn',
): GameState | null {
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const index = battlefield.findIndex(permanent => permanent.id === creatureId);
  if (index < 0) return null;

  const permanent: any = battlefield[index] as any;
  const modifiers = Array.isArray(permanent.modifiers) ? [...permanent.modifiers] : [];
  modifiers.push({
    type: 'powerToughness',
    power: powerBonus,
    toughness: toughnessBonus,
    sourceId: ctx.sourceId,
    duration,
    // Turn the pump was applied: long-lived pumps ("until your next turn") expire by turn number.
    turnApplied: Number((state as any)?.turnNumber ?? 0) || 0,
    ...(duration === 'until_next_turn' && ctx.controllerId
      ? { expiresOnControllerTurn: ctx.controllerId }
      : {}),
  } as any);

  const nextPermanent: any = {
    ...permanent,
    modifiers,
    effectivePower: undefined,
    effectiveToughness: undefined,
  };

  if (markTrepanation) {
    nextPermanent.trepanationBonus = powerBonus;
    nextPermanent.lastTrepanationBonus = powerBonus;
  }

  battlefield[index] = nextPermanent as any;
  const recalculatedBattlefield = getProcessedBattlefield({ ...(state as any), battlefield } as any);
  const recalculatedPermanent = recalculatedBattlefield.find(
    permanent => String((permanent as any)?.id || '').trim() === creatureId
  ) as any;
  if (recalculatedPermanent) {
    battlefield[index] = {
      ...nextPermanent,
      power:
        typeof recalculatedPermanent.effectivePower === 'number'
          ? recalculatedPermanent.effectivePower
          : nextPermanent.power,
      toughness:
        typeof recalculatedPermanent.effectiveToughness === 'number'
          ? recalculatedPermanent.effectiveToughness
          : nextPermanent.toughness,
      effectivePower: recalculatedPermanent.effectivePower,
      effectiveToughness: recalculatedPermanent.effectiveToughness,
      grantedAbilities: recalculatedPermanent.grantedAbilities,
    } as any;
  }

  return { ...(state as any), battlefield } as any;
}

export function applyTemporarySetBasePowerToughness(
  state: GameState,
  creatureId: string,
  ctx: OracleIRExecutionContext,
  power: number,
  toughness: number,
  duration: 'end_of_turn' | 'until_next_turn' | 'static' = 'end_of_turn',
): GameState | null {
  // Exact layer 7b ordering: every permanent already on the battlefield gets its real timestamp first, so this
  // setter (drawn from the same counter) is strictly newer than all of them and older than anything that comes later.
  const stamped = stampMissingTimestampsOnBattlefieldCopy(state);
  const battlefield = [...(stamped.battlefield as BattlefieldPermanent[])];
  const index = battlefield.findIndex(permanent => permanent.id === creatureId);
  if (index < 0) return null;
  const setterTimestamp = stamped.timestampCounter + 1;

  const permanent: any = battlefield[index] as any;
  const modifiers = Array.isArray(permanent.modifiers) ? [...permanent.modifiers] : [];
  modifiers.push({
    type: 'setPowerToughness',
    setPower: power,
    setToughness: toughness,
    sourceId: ctx.sourceId,
    duration,
    // Layer 7b ordering (CR 613.7): last timestamp wins; see oracleIRExecutorEffectTimestamps.
    ...describeSetterOrdering(state),
    timestamp: setterTimestamp,
    globalTimestamp: true,
    turnApplied: Number((state as any)?.turnNumber ?? 0) || 0,
    ...(duration === 'until_next_turn' && ctx.controllerId
      ? { expiresOnControllerTurn: ctx.controllerId }
      : {}),
  } as any);

  battlefield[index] = {
    ...permanent,
    modifiers,
    effectivePower: undefined,
    effectiveToughness: undefined,
  } as any;
  const recalculatedBattlefield = getProcessedBattlefield({ ...(state as any), battlefield } as any);
  const recalculatedPermanent = recalculatedBattlefield.find(
    permanent => String((permanent as any)?.id || '').trim() === creatureId
  ) as any;
  if (recalculatedPermanent) {
    battlefield[index] = {
      ...(battlefield[index] as any),
      power:
        typeof recalculatedPermanent.effectivePower === 'number'
          ? recalculatedPermanent.effectivePower
          : (battlefield[index] as any)?.power,
      toughness:
        typeof recalculatedPermanent.effectiveToughness === 'number'
          ? recalculatedPermanent.effectiveToughness
          : (battlefield[index] as any)?.toughness,
      effectivePower: recalculatedPermanent.effectivePower,
      effectiveToughness: recalculatedPermanent.effectiveToughness,
      grantedAbilities: recalculatedPermanent.grantedAbilities,
    } as any;
  }

  return { ...(state as any), battlefield, timestampCounter: setterTimestamp } as any;
}

export function applyTemporarySwitchPowerToughness(
  state: GameState,
  creatureId: string,
  ctx: OracleIRExecutionContext
): GameState | null {
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const index = battlefield.findIndex(permanent => permanent.id === creatureId);
  if (index < 0) return null;

  const permanent: any = battlefield[index] as any;
  const modifiers = Array.isArray(permanent.modifiers) ? [...permanent.modifiers] : [];
  modifiers.push({
    type: 'switchPowerToughness',
    sourceId: ctx.sourceId,
    duration: 'end_of_turn',
  } as any);

  battlefield[index] = {
    ...permanent,
    modifiers,
    effectivePower: undefined,
    effectiveToughness: undefined,
  } as any;

  const recalculatedBattlefield = getProcessedBattlefield({ ...(state as any), battlefield } as any);
  const recalculatedPermanent = recalculatedBattlefield.find(
    permanent => String((permanent as any)?.id || '').trim() === creatureId
  ) as any;
  if (recalculatedPermanent) {
    battlefield[index] = {
      ...(battlefield[index] as any),
      power:
        typeof recalculatedPermanent.effectivePower === 'number'
          ? recalculatedPermanent.effectivePower
          : (battlefield[index] as any)?.power,
      toughness:
        typeof recalculatedPermanent.effectiveToughness === 'number'
          ? recalculatedPermanent.effectiveToughness
          : (battlefield[index] as any)?.toughness,
      effectivePower: recalculatedPermanent.effectivePower,
      effectiveToughness: recalculatedPermanent.effectiveToughness,
      grantedAbilities: recalculatedPermanent.grantedAbilities,
    } as any;
  }

  return { ...(state as any), battlefield } as any;
}

export function resolveGoadTargetCreatureIds(
  state: GameState,
  target: OracleObjectSelector,
  ctx: OracleIRExecutionContext
): string[] {
  const battlefield = getProcessedBattlefield(state).filter(permanent => isExecutorCreature(permanent));

  const chosenIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  if (chosenIds.length > 0) {
    const chosenSet = new Set(chosenIds);
    return battlefield
      .filter(permanent => chosenSet.has(String((permanent as any)?.id || '').trim()))
      .map(permanent => String((permanent as any)?.id || '').trim())
      .filter(Boolean);
  }

  const targetCreatureId = String(ctx.targetCreatureId || '').trim();
  if (targetCreatureId) {
    const matched = battlefield.find(permanent => String((permanent as any)?.id || '').trim() === targetCreatureId);
    if (matched) return [targetCreatureId];
  }

  if (target.kind !== 'raw') return [];

  const raw = normalizeOracleText(target.text);
  if (!raw) return [];

  const controllerId = String(ctx.controllerId || '').trim();
  const targetPlayerId = String(ctx.selectorContext?.targetPlayerId || '').trim();
  const targetOpponentId = String(ctx.selectorContext?.targetOpponentId || '').trim();

  const controlledBy = (playerId: string): string[] =>
    battlefield
      .filter(permanent => String((permanent as any)?.controller || '').trim() === playerId)
      .map(permanent => String((permanent as any)?.id || '').trim())
      .filter(Boolean);

  const opponentsControlled = battlefield.filter(
    permanent => String((permanent as any)?.controller || '').trim() !== controllerId
  );

  if (raw === 'all creatures your opponents control' || raw === "all creatures you don't control") {
    return opponentsControlled.map(permanent => String((permanent as any)?.id || '').trim()).filter(Boolean);
  }

  if (
    raw === 'target creature' ||
    raw === 'creature' ||
    raw === "target creature you don't control" ||
    raw === 'target creature an opponent controls' ||
    raw === 'target creature your opponents control'
  ) {
    const pool = raw === 'target creature' || raw === 'creature' ? battlefield : opponentsControlled;
    return pool.length === 1 ? [String((pool[0] as any)?.id || '').trim()] : [];
  }

  if (
    (raw === 'target creature that player controls' ||
      raw === 'each creature that player controls' ||
      raw === 'each creature target player controls') &&
    targetPlayerId
  ) {
    const pool = controlledBy(targetPlayerId);
    if (raw.startsWith('each ')) return pool;
    return pool.length === 1 ? pool : [];
  }

  if (
    (raw === 'target creature that opponent controls' ||
      raw === 'each creature that opponent controls' ||
      raw === 'each creature target opponent controls' ||
      raw === 'target creature defending player controls') &&
    (targetOpponentId || targetPlayerId)
  ) {
    const pool = controlledBy(targetOpponentId || targetPlayerId);
    if (raw.startsWith('each ')) return pool;
    return pool.length === 1 ? pool : [];
  }

  if (
    raw === 'they' ||
    raw === 'them' ||
    raw === 'those creatures' ||
    raw === 'those permanents' ||
    raw === 'those creature cards'
  ) {
    const movedIds = Array.isArray(ctx.lastMovedBattlefieldPermanentIds)
      ? ctx.lastMovedBattlefieldPermanentIds.map(id => String(id || '').trim()).filter(Boolean)
      : [];
    if (movedIds.length > 0) {
      const movedSet = new Set(movedIds);
      return battlefield
        .filter(permanent => movedSet.has(String((permanent as any)?.id || '').trim()))
        .map(permanent => String((permanent as any)?.id || '').trim())
        .filter(Boolean);
    }
  }

  return [];
}

export function applyGoadToCreatures(
  state: GameState,
  creatureIds: readonly string[],
  goaderId: PlayerID,
  duration: 'until_your_next_turn' | 'rest_of_game' = 'until_your_next_turn'
): GameState | null {
  if (!Array.isArray(creatureIds) || creatureIds.length === 0) return null;

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const turnNumber = Number((state as any)?.turnNumber ?? 0) || 0;
  // Rest-of-game: omit expiry so getGoadedBy treats undefined as never-expires (JSON-safe).
  const idSet = new Set(creatureIds.map(id => String(id || '').trim()).filter(Boolean));
  let changed = false;

  for (let index = 0; index < battlefield.length; index += 1) {
    const permanent: any = battlefield[index] as any;
    const permanentId = String((permanent as any)?.id || '').trim();
    if (!idSet.has(permanentId)) continue;
    if (!isExecutorCreature(permanent)) continue;

    const goadedBy = Array.isArray(permanent.goadedBy)
      ? permanent.goadedBy.map((value: unknown) => String(value || '').trim()).filter(Boolean)
      : [];
    const nextGoadedBy = goadedBy.includes(goaderId) ? goadedBy : [...goadedBy, goaderId];
    const nextGoadedUntil = {
      ...((permanent as any)?.goadedUntil && typeof (permanent as any).goadedUntil === 'object'
        ? (permanent as any).goadedUntil
        : {}),
    };
    if (duration === 'rest_of_game') {
      delete nextGoadedUntil[goaderId];
    } else {
      nextGoadedUntil[goaderId] = turnNumber + 1;
    }

    battlefield[index] = {
      ...permanent,
      goadedBy: nextGoadedBy,
      goadedUntil: nextGoadedUntil,
    } as any;
    changed = true;
  }

  return changed ? ({ ...(state as any), battlefield } as any) : null;
}

export function countControlledByClass(
  controlled: readonly BattlefieldPermanent[],
  klass: string,
  typeLineLower: (permanent: any) => string
): number {
  return controlled.filter(permanent => {
    if (klass === 'permanent' || klass === 'nonland permanent') {
      return hasExecutorClass(permanent, klass);
    }

    if (hasExecutorClass(permanent, klass)) {
      return true;
    }

    return typeLineLower(permanent).includes(klass);
  }).length;
}

export function normalizeControlledClassKey(text: string): string | null {
  const normalized = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^creatures?$/.test(normalized)) return 'creature';
  if (/^artifacts?$/.test(normalized)) return 'artifact';
  if (/^enchantments?$/.test(normalized)) return 'enchantment';
  if (/^lands?$/.test(normalized)) return 'land';
  if (/^planeswalkers?$/.test(normalized)) return 'planeswalker';
  if (/^snow permanents?$/.test(normalized)) return 'snow';
  if (/^nonland permanents?$/.test(normalized)) return 'nonland permanent';
  if (/^permanents?$/.test(normalized)) return 'permanent';

  const singularize = (word: string): string => {
    const irregular: Record<string, string> = {
      elves: 'elf',
      zombies: 'zombie',
    };
    if (irregular[word]) return irregular[word];
    if (word.endsWith('ies') && word.length > 3) return `${word.slice(0, -3)}y`;
    if (/(?:xes|zes|ches|shes|sses)$/.test(word) && word.length > 4) return word.slice(0, -2);
    if (word.endsWith('s') && word.length > 2) return word.slice(0, -1);
    return word;
  };

  if (/^[a-z][a-z-]*$/.test(normalized)) {
    const stopwords = new Set(['card', 'cards', 'spell', 'spells']);
    if (!stopwords.has(normalized)) return singularize(normalized);
  }

  return null;
}
