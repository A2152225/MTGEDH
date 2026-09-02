import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { collectMostRecentLedgerCards } from './oracleIRLedgerCardAccess';
import { createDamageSourceFromPermanent } from './damageProcessing';
import {
  previewPreventedDamage,
  registerDamageCantBePreventedThisTurn,
} from './oracleIRDamagePrevention';
import {
  trySpecialDealDamageStep,
  type SpecialTargetStepResult,
} from './oracleIRExecutorSpecialTargetHandlers';
import { tryApplyFightDealDamageStep } from './oracleIRExecutorFightStep';
import {
  normalizeRepeatedEachAllInList,
  parseDeterministicMixedDamageTarget,
  parseSimpleBattlefieldSelector,
} from './oracleIRExecutorBattlefieldParser';
import { permanentMatchesSelector } from './oracleIRExecutorBattlefieldOps';
import { resolveSingleCreatureTargetId } from './oracleIRExecutorCreatureStepUtils';
import {
  addDamageToPermanentLikeCreatureFromSource,
  getExcessDamageToPermanent,
  hasExecutorClass,
  removeDefenseCountersFromBattle,
  removeLoyaltyFromPlaneswalker,
} from './oracleIRExecutorPermanentUtils';
import { resolveOracleQuantity } from './oracleIRExecutorResolveQuantity';
import { adjustLife, adjustPlayerCounter, getCardManaValue, getCardTypeLineLower, quantityToNumber, resolvePlayers, resolvePlayersFromDamageTarget } from './oracleIRExecutorPlayerUtils';
import { buildEffectBridgeOptions, interceptDamageViaBridge } from './oracleIRExecutorDamageTransitionCommit';
import { resolveSinglePermanentDamageTargetId } from './oracleIRExecutorDamageStepHandlers-handlers/oracleIRExecutorDamagePermanentTarget';
import { findSourceObject } from './oracleIRExecutorDamageStepHandlers-handlers/oracleIRExecutorDamagePreventionLookups';
import type { PreventDamageStepHandlerResult } from './oracleIRExecutorDamageStepHandlers-handlers/oracleIRExecutorDamagePreventionStepTypes';
import { resolveControlledPermanentCountDamageAmount } from './oracleIRExecutorDamageStepHandlers-handlers/oracleIRExecutorDamageControlledCountAmount';
export type { PreventDamageStepHandlerResult };

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly count?: number;
  readonly excessDamageDealtThisWay: number;
  readonly lastDamagedBattlefieldPermanentIds?: readonly string[];
};

type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason:
    | 'unknown_amount'
    | 'unsupported_target'
    | 'unsupported_permanent_types'
    | 'no_deterministic_target'
    | 'player_choice_required'
    | 'impossible_action';
  readonly options?: {
    readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
    readonly persist?: boolean;
    readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
  };
};

export type DamageStepHandlerResult = StepApplyResult | StepSkipResult;

function normalizeSpecialDamageResult(result: SpecialTargetStepResult): DamageStepHandlerResult {
  if (result.applied === false) return result;
  return {
    ...result,
    excessDamageDealtThisWay: 0,
  };
}

type DamageRuntime = {
  readonly lastMovedCards?: readonly any[];
  readonly lastDiscardedCards?: readonly any[];
  readonly lastExiledCards?: readonly any[];
  readonly lastSacrificedPermanents?: readonly any[];
  readonly lastTappedMatchingPermanentCount?: number;
  readonly lastReferenceAmount?: number;
};

type DamageSourceKeywords = {
  readonly controllerId: PlayerID | null;
  readonly hasInfect: boolean;
  readonly hasWither: boolean;
  readonly hasLifelink: boolean;
  readonly hasDeathtouch: boolean;
};

function readGrantedAbilityNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const value of raw) {
    const name = typeof value === 'string'
      ? value.trim()
      : String((value as any)?.name || (value as any)?.type || '').trim();
    if (name) names.push(name);
  }
  return names;
}

function mergeGrantedAbilityNames(...lists: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const name of readGrantedAbilityNames(list)) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

function readFiniteCardStat(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readObjectStat(source: any, stat: 'power' | 'toughness' | 'mana_value'): number | null {
  if (!source || typeof source !== 'object') return null;
  if (stat === 'mana_value') {
    return getCardManaValue((source as any)?.card ?? source);
  }
  return readFiniteCardStat((source as any)?.[stat] ?? (source as any)?.card?.[stat]);
}

function permanentTypeLineContains(permanent: any, needle: string): boolean {
  const normalizedNeedle = String(needle || '').trim().toLowerCase();
  if (!normalizedNeedle) return false;
  const singular = normalizedNeedle.endsWith('s') ? normalizedNeedle.slice(0, -1) : normalizedNeedle;
  const typeLine = getCardTypeLineLower(permanent);
  return new RegExp(`(^|[^a-z])${singular.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s)?($|[^a-z])`, 'i').test(typeLine);
}

function resolveReferenceDamageAmountFromState(
  state: GameState,
  amount: Extract<OracleEffectStep, { kind: 'deal_damage' }>['amount'],
  ctx: OracleIRExecutionContext
): number | null {
  if (amount.kind === 'greatest_power_among_creatures_you_control') {
    const controllerId = String(ctx.controllerId || '').trim();
    const powers = ((state.battlefield || []) as any[])
      .filter(permanent => String(permanent?.controller || '').trim() === controllerId)
      .filter(permanent => permanentTypeLineContains(permanent, 'creature'))
      .map(permanent => readObjectStat(permanent, 'power'))
      .filter((value): value is number => value !== null);
    return powers.length > 0 ? Math.max(0, ...powers) : 0;
  }

  if (amount.kind !== 'reference_amount') return null;
  const raw = String(amount.raw || '').replace(/\u2019/g, "'").trim().toLowerCase();
  const controllerId = String(ctx.controllerId || '').trim();
  if (!raw || !controllerId) return null;

  if (raw === 'the number of attacking creatures') {
    return ((state.battlefield || []) as any[]).filter(permanent =>
      permanentTypeLineContains(permanent, 'creature') && Boolean(permanent?.attacking)
    ).length;
  }

  const controlledCount = resolveControlledPermanentCountDamageAmount(state, raw, ctx);
  if (controlledCount !== null) return controlledCount;

  return null;
}

function resolveDamageAmountSourceObjects(
  state: GameState,
  source: Extract<OracleEffectStep, { kind: 'deal_damage' }>['source'],
  ctx: OracleIRExecutionContext,
  runtime?: DamageRuntime
): any[] {
  const ledgerMoved = collectMostRecentLedgerCards(ctx);
  const moved = ledgerMoved.length > 0
    ? ledgerMoved
    : (Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []);
  if (!source || (source as any).kind !== 'raw') {
    const directSource = findSourceObject(state, String(ctx.sourceId || '').trim());
    return directSource ? [directSource] : [];
  }

  const raw = String((source as any).text || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  if (!raw) return [];

  if (/^that (?:card|creature card)$/.test(raw)) {
    return moved;
  }

  if (/^(?:it|this (?:permanent|spell|creature|card))$/.test(raw)) {
    const directSource = findSourceObject(state, String(ctx.sourceId || '').trim());
    if (directSource) return [directSource];
    return moved.length > 0 ? moved : [];
  }

  if (/^those creatures$/.test(raw)) {
    const ids = [
      ...(Array.isArray(ctx.lastMovedBattlefieldPermanentIds) ? ctx.lastMovedBattlefieldPermanentIds : []),
      ...(Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : []),
    ]
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    const uniqueIds = [...new Set(ids)];
    return uniqueIds
      .map((id) => (state.battlefield || []).find((entry: any) => String(entry?.id || '').trim() === id))
      .filter(Boolean);
  }

  const singleCreatureId = resolveSingleCreatureTargetId(state, source as any, ctx);
  if (singleCreatureId) {
    const permanent = (state.battlefield || []).find((entry: any) => String(entry?.id || '').trim() === singleCreatureId);
    return permanent ? [permanent] : [];
  }

  const selector = parseSimpleBattlefieldSelector({ kind: 'raw', text: normalizeRepeatedEachAllInList(String((source as any).text || '')) } as any);
  if (selector) {
    return ((state.battlefield || []) as any[]).filter((permanent: any) => permanentMatchesSelector(permanent, selector, ctx));
  }

  return [];
}

function withDamageAmountTargetPlayer(
  ctx: OracleIRExecutionContext,
  playerId: PlayerID,
): OracleIRExecutionContext {
  return {
    ...ctx,
    selectorContext: {
      ...(ctx.selectorContext || {}),
      targetPlayerId: playerId,
    },
  };
}

function resolveDamageAmountBoundPlayerId(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'deal_damage' }>,
  ctx: OracleIRExecutionContext,
  players: readonly PlayerID[],
): PlayerID | undefined {
  if (players[0]) return players[0];
  const creatureId = String(
    ctx.targetCreatureId
    || ctx.selectorContext?.targetCreatureId
    || ctx.selectorContext?.targetPermanentId
    || ctx.targetPermanentId
    || resolveSingleCreatureTargetId(state, step.target as any, ctx)
    || resolveSinglePermanentDamageTargetId(state, step.target, ctx)
    || '',
  ).trim();
  if (!creatureId) return undefined;
  const creature = ((state.battlefield || []) as any[]).find(
    (entry) => String(entry?.id || '').trim() === creatureId,
  );
  const controller = String(creature?.controller || creature?.controllerId || '').trim();
  return controller ? (controller as PlayerID) : undefined;
}

function resolveDamageAmount(
  state: GameState,
  amount: Extract<OracleEffectStep, { kind: 'deal_damage' }>['amount'],
  source: Extract<OracleEffectStep, { kind: 'deal_damage' }>['source'],
  ctx: OracleIRExecutionContext,
  runtime?: DamageRuntime,
  whereX?: Extract<OracleEffectStep, { kind: 'deal_damage' }>['whereX']
): number | null {
  const fromOracle = resolveOracleQuantity(state, ctx.controllerId, amount, ctx, {
    whereX,
    runtime: runtime as any,
  });
  if (fromOracle !== null) return fromOracle;

  const numericAmount = quantityToNumber(amount, ctx);
  if (numericAmount !== null) return numericAmount;
  const stateReferenceAmount = resolveReferenceDamageAmountFromState(state, amount, ctx);
  if (stateReferenceAmount !== null) return stateReferenceAmount;
  if (amount.kind === 'reference_amount') {
    const runtimeAmount = Number(runtime?.lastReferenceAmount);
    return Number.isFinite(runtimeAmount) ? Math.max(0, runtimeAmount) : null;
  }
  if (amount.kind === 'object_stat') {
    const sourceObjects =
      amount.subject === 'the_sacrificed_creature'
        ? (Array.isArray(runtime?.lastSacrificedPermanents) ? [...runtime.lastSacrificedPermanents] : [])
        :
      amount.subject === 'that_card' || amount.subject === 'that_creature'
        ? [
            ...(Array.isArray(runtime?.lastMovedCards) ? [...runtime.lastMovedCards] : []),
            ...(Array.isArray(runtime?.lastDiscardedCards) ? [...runtime.lastDiscardedCards] : []),
            ...(Array.isArray(runtime?.lastExiledCards) ? [...runtime.lastExiledCards] : []),
          ]
        : resolveDamageAmountSourceObjects(state, source, ctx, runtime);
    if (sourceObjects.length === 0) return null;

    const values = sourceObjects
      .map((entry) => readObjectStat(entry, amount.stat))
      .filter((entry): entry is number => entry !== null);
    if (values.length === 0) return null;
    const multiplier = Number.isFinite(Number((amount as any).multiplier)) ? Math.max(0, Number((amount as any).multiplier)) : 1;
    return values.reduce((sum, value) => sum + value, 0) * multiplier;
  }
  if (amount.kind !== 'unknown') return null;

  const raw = String(amount.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  if (!raw) return null;

  if (raw === 'triple that' || raw === 'triple that much') {
    const ref = Number(runtime?.lastReferenceAmount ?? (ctx as any).lastReferenceAmount ?? ctx.referenceAmount);
    return Number.isFinite(ref) ? Math.max(0, ref * 3) : null;
  }
  if (raw === 'twice that much' || raw === 'twice that') {
    const ref = Number(runtime?.lastReferenceAmount ?? (ctx as any).lastReferenceAmount ?? ctx.referenceAmount);
    return Number.isFinite(ref) ? Math.max(0, ref * 2) : null;
  }

  const moved = [
    ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
    ...(Array.isArray(runtime?.lastDiscardedCards) ? runtime.lastDiscardedCards : []),
    ...(Array.isArray(runtime?.lastExiledCards) ? runtime.lastExiledCards : []),
  ];
  if (moved.length === 1 && /^(?:its|that card's|that creature's) mana value$/.test(raw)) {
    const manaValue = getCardManaValue(moved[0]);
    return manaValue === null ? null : manaValue;
  }
  if (/^(?:its|that card's|that creature's|this permanent's|this creature's) power$/.test(raw)) {
    const sourceObjects = resolveDamageAmountSourceObjects(state, source, ctx, runtime);
    if (sourceObjects.length >= 1) {
      const power = readFiniteCardStat(
        (sourceObjects[0] as any)?.power ?? (sourceObjects[0] as any)?.card?.power
      );
      if (power !== null) return power;
    }
  }
  if (/^the creature's power$/.test(raw)) {
    const creatureId = String(
      ctx.targetCreatureId ||
        ctx.selectorContext?.targetCreatureId ||
        ctx.selectorContext?.combatOpponentCreatureId ||
        ''
    ).trim();
    if (creatureId) {
      const creature = (state.battlefield || []).find(
        (entry: any) => String(entry?.id || '').trim() === creatureId
      );
      const power = readFiniteCardStat((creature as any)?.power ?? (creature as any)?.card?.power);
      if (power !== null) return power;
    }
  }
  if (moved.length === 1 && /^(?:its|that card's|that creature's) power$/.test(raw)) {
    return readFiniteCardStat((moved[0] as any)?.power ?? (moved[0] as any)?.card?.power);
  }
  if (moved.length === 1 && /^(?:its|that card's|that creature's) toughness$/.test(raw)) {
    return readFiniteCardStat((moved[0] as any)?.toughness ?? (moved[0] as any)?.card?.toughness);
  }
  if (/^the number of (?:permanents|creatures|myr) tapped this way$/.test(raw)) {
    const tapped = Number(runtime?.lastTappedMatchingPermanentCount ?? 0);
    return Number.isFinite(tapped) ? Math.max(0, tapped) : 0;
  }

  return null;
}

function resolveDamageSourceKeywords(
  state: GameState,
  ctx: OracleIRExecutionContext
): DamageSourceKeywords | null {
  const sourceId = String(ctx.sourceId || '').trim();
  const liveObject = sourceId ? findSourceObject(state, sourceId) : null;
  const mergedGranted = mergeGrantedAbilityNames(
    (liveObject as any)?.grantedAbilities,
    ctx.sourceGrantedAbilities,
  );

  let sourceObject = liveObject && typeof liveObject === 'object' ? liveObject : null;
  if (sourceObject && mergedGranted.length > 0) {
    sourceObject = { ...(sourceObject as any), grantedAbilities: mergedGranted };
  } else if (!sourceObject && (mergedGranted.length > 0 || sourceId)) {
    // Instant/sorcery resolve pops the stack item before IR damage. Keywords
    // granted to "that spell" (Judith) must still apply from the snapshot.
    sourceObject = {
      id: sourceId,
      controller: ctx.controllerId,
      grantedAbilities: mergedGranted,
      card: {
        name: ctx.sourceName || '',
        oracle_text: '',
        type_line: '',
      },
    };
  }

  if (!sourceObject || typeof sourceObject !== 'object') return null;

  const controllerId = String((sourceObject as any)?.controller || ctx.controllerId || '').trim() || null;
  const permanentLike = sourceObject as any;
  if (permanentLike?.card || permanentLike?.type_line || permanentLike?.cardType) {
    const source = createDamageSourceFromPermanent(permanentLike as any);
    return {
      controllerId: source.controllerId || controllerId,
      hasInfect: Boolean(source.hasInfect),
      hasWither: Boolean(source.hasWither),
      hasLifelink: Boolean(source.hasLifelink),
      hasDeathtouch: Boolean(source.hasDeathtouch),
    };
  }

  return {
    controllerId,
    hasInfect: false,
    hasWither: false,
    hasLifelink: false,
    hasDeathtouch: false,
  };
}

function addMinusCountersToPermanentLikeCreatureFromSource(
  perm: any,
  amount: number,
  sourcePermanentId?: string
): any {
  const n = Math.max(0, amount | 0);
  if (n <= 0) return perm;

  const counters = {
    ...(((perm as any).counters || {}) as Record<string, number>),
    '-1/-1': Number((perm as any).counters?.['-1/-1'] || 0) + n,
  };
  const currentDamageSourceIds = Array.isArray((perm as any)?.damageSourceIds)
    ? (perm as any).damageSourceIds
        .map((id: unknown) => String(id || '').trim())
        .filter(Boolean)
    : [];
  const normalizedSourcePermanentId = String(sourcePermanentId || '').trim();
  const damageSourceIds =
    normalizedSourcePermanentId && !currentDamageSourceIds.includes(normalizedSourcePermanentId)
      ? [...currentDamageSourceIds, normalizedSourcePermanentId]
      : currentDamageSourceIds;

  return {
    ...(perm as any),
    counters,
    ...(damageSourceIds.length > 0 ? { damageSourceIds } : {}),
  };
}

function applyDamageToMatchingBattlefield(
  state: GameState,
  amount: number,
  ctx: OracleIRExecutionContext,
  matcher: (permanent: any) => boolean,
  sourceKeywords?: DamageSourceKeywords | null,
  skipPrevention = false,
): {
  state: GameState;
  excessDamageDealtThisWay: number;
  damageDealt: number;
  log: readonly string[];
  lastDamagedBattlefieldPermanentIds: readonly string[];
} {
  let excessDamageThisStep = 0;
  let damageDealt = 0;
  let preventionState = state;
  const log: string[] = [];
  const damagedIds: string[] = [];
  const sourcePermanentId = String(ctx.sourceId || '').trim() || undefined;

  const updatedBattlefield = (state.battlefield || []).map(permanent => {
    if (!matcher(permanent)) return permanent as any;
    const targetPermanentId = String((permanent as any)?.id || '').trim() || undefined;
    let finalAmount = amount;
    if (!skipPrevention) {
      const prevention = previewPreventedDamage(preventionState, amount, sourcePermanentId, { targetPermanentId });
      preventionState = prevention.state ?? preventionState;
      log.push(...prevention.log);
      finalAmount = prevention.remainingDamage;
    }
    if (finalAmount <= 0) {
      return permanent as any;
    }

    if (targetPermanentId) damagedIds.push(targetPermanentId);
    damageDealt += finalAmount;
    excessDamageThisStep += getExcessDamageToPermanent(permanent as any, finalAmount);
    if (hasExecutorClass(permanent as any, 'battle')) return removeDefenseCountersFromBattle(permanent as any, finalAmount);
    if (hasExecutorClass(permanent as any, 'creature')) {
      let damaged = (sourceKeywords?.hasInfect || sourceKeywords?.hasWither)
        ? addMinusCountersToPermanentLikeCreatureFromSource(permanent as any, finalAmount, sourcePermanentId)
        : addDamageToPermanentLikeCreatureFromSource(permanent as any, finalAmount, sourcePermanentId);
      if (sourceKeywords?.hasDeathtouch) {
        damaged = { ...damaged, deathtouchDamageMarked: true };
      }
      return damaged;
    }
    if (hasExecutorClass(permanent as any, 'planeswalker')) return removeLoyaltyFromPlaneswalker(permanent as any, finalAmount);
    return permanent as any;
  }) as any;

  return {
    state: { ...(preventionState as any), battlefield: updatedBattlefield } as any,
    excessDamageDealtThisWay: Math.max(0, excessDamageThisStep),
    damageDealt,
    log,
    lastDamagedBattlefieldPermanentIds: damagedIds,
  };
}

function stampLastDamagedIds(
  ctx: OracleIRExecutionContext,
  ids: readonly string[] | undefined,
): void {
  const cleaned = [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (cleaned.length === 0) return;
  (ctx as any).lastDamagedBattlefieldPermanentIds = cleaned;
}

function resolveMixedDamagePlayers(
  state: GameState,
  mixedPlayers: Iterable<string>,
  ctx: OracleIRExecutionContext
): readonly PlayerID[] {
  const playerIds = new Set<PlayerID>();

  for (const who of mixedPlayers) {
    const ids =
      who === 'you'
        ? resolvePlayers(state, { kind: 'you' } as any, ctx)
        : who === 'each_player'
          ? resolvePlayers(state, { kind: 'each_player' } as any, ctx)
          : who === 'each_opponent'
            ? resolvePlayers(state, { kind: 'each_opponent' } as any, ctx)
            : who === 'each_of_those_opponents'
              ? resolvePlayers(state, { kind: 'each_of_those_opponents' } as any, ctx)
              : who === 'target_player'
                ? resolvePlayers(state, { kind: 'target_player' } as any, ctx)
                : resolvePlayers(state, { kind: 'target_opponent' } as any, ctx);

    for (const id of ids) playerIds.add(id);
  }

  return [...playerIds];
}

function resolveBridgedDamageAmount(
  state: GameState,
  amount: number,
  ctx: OracleIRExecutionContext,
  target: {
    targetPlayerId?: PlayerID;
    targetPermanentId?: string;
    targetPermanent?: unknown;
  },
): { amount: number; halted: boolean; usesBridge: boolean } {
  const bridgeOptions = buildEffectBridgeOptions(ctx, 'deal_damage');
  if (!bridgeOptions) {
    return { amount, halted: false, usesBridge: false };
  }

  const intercepted = interceptDamageViaBridge({
    state,
    amount,
    stepIndex: Number(bridgeOptions.stepIndex),
    stepKind: 'deal_damage',
    cause: 'oracle_ir:deal_damage',
    ctx: bridgeOptions.ctx,
    targetPlayerId: target.targetPlayerId,
    targetPermanentId: target.targetPermanentId,
    targetPermanent: target.targetPermanent,
  });

  return {
    amount: intercepted.effectiveAmount,
    halted: intercepted.halted,
    usesBridge: true,
  };
}

export function applyDealDamageStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'deal_damage' }>,
  ctx: OracleIRExecutionContext,
  runtime?: DamageRuntime
): DamageStepHandlerResult {
  const fight = tryApplyFightDealDamageStep(state, step, ctx);
  if (fight) {
    if (fight.applied) {
      stampLastDamagedIds(ctx, fight.lastDamagedBattlefieldPermanentIds);
      return {
        ...fight,
        excessDamageDealtThisWay: Math.max(0, Number(fight.excessDamageDealtThisWay) || 0),
      };
    }
    return fight;
  }

  const fightEarly = trySpecialDealDamageStep(state, step, ctx, 0);
  if (fightEarly) return normalizeSpecialDamageResult(fightEarly);

  const players = resolvePlayersFromDamageTarget(state, step.target as any, ctx);
  const boundPlayerId = resolveDamageAmountBoundPlayerId(state, step, ctx, players);
  const amount = resolveDamageAmount(
    state,
    step.amount,
    step.source,
    boundPlayerId ? withDamageAmountTargetPlayer(ctx, boundPlayerId) : ctx,
    runtime,
    step.whereX,
  );
  if (amount === null && players.length === 0) {
    return {
      applied: false,
      message: `Skipped deal damage (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const specialDamage = trySpecialDealDamageStep(state, step, ctx, amount ?? 0);
  if (specialDamage) return normalizeSpecialDamageResult(specialDamage);

  let nextState = state;
  const log: string[] = [];
  const damageSourceId = String(ctx.sourceId || '').trim() || undefined;
  const sourceKeywords = resolveDamageSourceKeywords(nextState, ctx);

  if (players.length > 0) {
    let totalDamageDealt = 0;
    for (const playerId of players) {
      const playerAmount = resolveDamageAmount(
        nextState,
        step.amount,
        step.source,
        withDamageAmountTargetPlayer(ctx, playerId),
        runtime,
        step.whereX,
      );
      if (playerAmount === null) {
        return {
          applied: false,
          message: `Skipped deal damage (unknown amount): ${step.raw}`,
          reason: 'unknown_amount',
          options: { classification: 'ambiguous' },
        };
      }

      const bridged = resolveBridgedDamageAmount(nextState, playerAmount, ctx, { targetPlayerId: playerId });
      if (bridged.halted) {
        return { applied: true, state: nextState, log, count: 0, excessDamageDealtThisWay: 0 };
      }

      let finalAmount = bridged.amount;
      if (!bridged.usesBridge) {
        const prevention = previewPreventedDamage(nextState, playerAmount, damageSourceId, { targetPlayerId: playerId });
        nextState = prevention.state ?? nextState;
        log.push(...prevention.log);
        finalAmount = prevention.remainingDamage;
      }

      if (finalAmount <= 0) {
        log.push(`All damage to ${playerId} was prevented: ${step.raw}`);
        continue;
      }

      if (sourceKeywords?.hasInfect) {
        const result = adjustPlayerCounter(nextState, playerId, 'poison', finalAmount);
        nextState = result.state;
        log.push(...result.log);
      } else {
        const result = adjustLife(nextState, playerId, -finalAmount);
        nextState = result.state;
        log.push(...result.log);
      }

      if (sourceKeywords?.hasLifelink && sourceKeywords.controllerId) {
        const lifeGain = adjustLife(nextState, sourceKeywords.controllerId, finalAmount);
        nextState = lifeGain.state;
        log.push(...lifeGain.log);
      }

      log.push(`${playerId} is dealt ${finalAmount} damage`);
      totalDamageDealt += finalAmount;
    }

    return { applied: true, state: nextState, log, count: totalDamageDealt, excessDamageDealtThisWay: 0 };
  }

  if (amount === null) {
    return {
      applied: false,
      message: `Skipped deal damage (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const singlePermanentId = resolveSinglePermanentDamageTargetId(nextState, step.target, ctx);
  if (singlePermanentId) {
    const targetPermanent = (nextState.battlefield || []).find(
      (permanent: any) => String(permanent?.id || '').trim() === singlePermanentId,
    );
    const bridged = resolveBridgedDamageAmount(nextState, amount, ctx, {
      targetPermanentId: singlePermanentId,
      targetPermanent,
    });
    if (bridged.halted) {
      return { applied: true, state: nextState, log, count: 0, excessDamageDealtThisWay: 0 };
    }

    const result = applyDamageToMatchingBattlefield(
      nextState,
      bridged.amount,
      ctx,
      permanent => String((permanent as any)?.id || '').trim() === singlePermanentId,
      sourceKeywords,
      bridged.usesBridge,
    );
    nextState = result.state;
    log.push(...result.log);
    if (sourceKeywords?.hasLifelink && sourceKeywords.controllerId && result.damageDealt > 0) {
      const lifeGain = adjustLife(nextState, sourceKeywords.controllerId, result.damageDealt);
      nextState = lifeGain.state;
      log.push(...lifeGain.log);
    }
    if (result.damageDealt <= 0) {
      log.push(`All damage to ${singlePermanentId} was prevented: ${step.raw}`);
    } else {
      log.push(`Dealt ${result.damageDealt} damage to ${singlePermanentId}`);
    }
    stampLastDamagedIds(ctx, result.lastDamagedBattlefieldPermanentIds);
    return {
      applied: true,
      state: nextState,
      log,
      count: result.damageDealt,
      excessDamageDealtThisWay: result.excessDamageDealtThisWay,
      lastDamagedBattlefieldPermanentIds: result.lastDamagedBattlefieldPermanentIds,
    };
  }

  if ((step.target as any)?.kind === 'raw') {
    const rawText = String(((step.target as any).text || '') as any).trim();
    const singleCreatureId = resolveSingleCreatureTargetId(nextState, step.target as any, ctx);
    if (singleCreatureId) {
      const targetPermanent = (nextState.battlefield || []).find(
        (permanent: any) => String(permanent?.id || '').trim() === singleCreatureId,
      );
      const bridged = resolveBridgedDamageAmount(nextState, amount, ctx, {
        targetPermanentId: singleCreatureId,
        targetPermanent,
      });
      if (bridged.halted) {
        return { applied: true, state: nextState, log, count: 0, excessDamageDealtThisWay: 0 };
      }

      const result = applyDamageToMatchingBattlefield(
        nextState,
        bridged.amount,
        ctx,
        permanent => String((permanent as any)?.id || '').trim() === singleCreatureId,
        sourceKeywords,
        bridged.usesBridge,
      );
      nextState = result.state;
      log.push(...result.log);
      if (sourceKeywords?.hasLifelink && sourceKeywords.controllerId && result.damageDealt > 0) {
        const lifeGain = adjustLife(nextState, sourceKeywords.controllerId, result.damageDealt);
        nextState = lifeGain.state;
        log.push(...lifeGain.log);
      }
      if (result.damageDealt <= 0) {
        log.push(`All damage to ${rawText} was prevented: ${step.raw}`);
      } else {
        log.push(`Dealt ${result.damageDealt} damage to ${rawText}`);
      }
      stampLastDamagedIds(ctx, result.lastDamagedBattlefieldPermanentIds);
      return {
        applied: true,
        state: nextState,
        log,
        count: result.damageDealt,
        excessDamageDealtThisWay: result.excessDamageDealtThisWay,
        lastDamagedBattlefieldPermanentIds: result.lastDamagedBattlefieldPermanentIds,
      };
    }

    const mixed = parseDeterministicMixedDamageTarget(rawText);
    if (mixed) {
      let totalDamageDealt = 0;
      for (const playerId of resolveMixedDamagePlayers(nextState, mixed.players, ctx)) {
        const prevention = previewPreventedDamage(nextState, amount, damageSourceId, { targetPlayerId: playerId });
        nextState = prevention.state ?? nextState;
        log.push(...prevention.log);
        const finalAmount = prevention.remainingDamage;
        if (finalAmount <= 0) {
          log.push(`All damage to ${playerId} was prevented: ${step.raw}`);
          continue;
        }

        const result = adjustLife(nextState, playerId, -finalAmount);
        nextState = result.state;
        log.push(...result.log);
        log.push(`${playerId} is dealt ${finalAmount} damage`);
        totalDamageDealt += finalAmount;
      }

      let excessDamageDealtThisWay = 0;
      const mixedDamagedIds: string[] = [];
      for (const selector of mixed.selectors) {
        const result = applyDamageToMatchingBattlefield(
          nextState,
          amount,
          ctx,
          permanent => permanentMatchesSelector(permanent as any, selector, ctx),
          sourceKeywords
        );
        nextState = result.state;
        log.push(...result.log);
        excessDamageDealtThisWay += result.excessDamageDealtThisWay;
        totalDamageDealt += result.damageDealt;
        mixedDamagedIds.push(...result.lastDamagedBattlefieldPermanentIds);
      }

      if (sourceKeywords?.hasLifelink && sourceKeywords.controllerId && totalDamageDealt > 0) {
        const lifeGain = adjustLife(nextState, sourceKeywords.controllerId, totalDamageDealt);
        nextState = lifeGain.state;
        log.push(...lifeGain.log);
      }

      log.push(`Dealt ${totalDamageDealt} damage to ${rawText}`);
      stampLastDamagedIds(ctx, mixedDamagedIds);
      return {
        applied: true,
        state: nextState,
        log,
        count: totalDamageDealt,
        excessDamageDealtThisWay: Math.max(0, excessDamageDealtThisWay),
        lastDamagedBattlefieldPermanentIds: mixedDamagedIds,
      };
    }
  }

  if ((step.target as any)?.kind === 'raw') {
    const rawText = String(((step.target as any).text || '') as any).trim();
    const normalized = normalizeRepeatedEachAllInList(rawText);
    const selector = parseSimpleBattlefieldSelector({ kind: 'raw', text: normalized } as any);

    if (selector) {
      const disallowed = selector.types.some(
        type => type === 'land' || type === 'artifact' || type === 'enchantment' || type === 'permanent' || type === 'nonland_permanent'
      );
      if (disallowed) {
        return {
          applied: false,
          message: `Skipped deal damage (unsupported permanent types): ${step.raw}`,
          reason: 'unsupported_permanent_types',
        };
      }

      const result = applyDamageToMatchingBattlefield(
        nextState,
        amount,
        ctx,
        permanent => permanentMatchesSelector(permanent as any, selector, ctx),
        sourceKeywords
      );
      nextState = result.state;
      log.push(...result.log);
      if (sourceKeywords?.hasLifelink && sourceKeywords.controllerId && result.damageDealt > 0) {
        const lifeGain = adjustLife(nextState, sourceKeywords.controllerId, result.damageDealt);
        nextState = lifeGain.state;
        log.push(...lifeGain.log);
      }
      if (result.damageDealt <= 0) {
        log.push(`All damage to ${normalized} was prevented: ${step.raw}`);
      } else {
        log.push(`Dealt ${result.damageDealt} damage to ${normalized}`);
      }
      stampLastDamagedIds(ctx, result.lastDamagedBattlefieldPermanentIds);
      return {
        applied: true,
        state: nextState,
        log,
        count: result.damageDealt,
        excessDamageDealtThisWay: result.excessDamageDealtThisWay,
        lastDamagedBattlefieldPermanentIds: result.lastDamagedBattlefieldPermanentIds,
      };
    }
  }

  return {
    applied: false,
    message: `Skipped deal damage (unsupported target): ${step.raw}`,
    reason: 'unsupported_target',
  };
}

export { applyPreventDamageStep } from './oracleIRExecutorDamageStepHandlers-handlers/oracleIRExecutorPreventDamageStep';

export function applyDamageCantBePreventedStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'damage_cant_be_prevented' }>,
  _ctx: OracleIRExecutionContext
): PreventDamageStepHandlerResult {
  return {
    applied: true,
    state: registerDamageCantBePreventedThisTurn(state),
    log: ['Damage cannot be prevented this turn'],
  };
}
