import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { collectMostRecentLedgerCards } from './oracleIRLedgerCardAccess';
import { createDamageSourceFromPermanent } from './damageProcessing';
import {
  createGlobalCombatDamagePreventionEffect,
  createSourceChoiceDamagePreventionEffect,
  createSourceColorDamagePreventionEffect,
  createTargetAllDamagePreventionEffect,
  createTargetDamagePreventionEffect,
  previewPreventedDamage,
  registerDamageCantBePreventedThisTurn,
  registerDamagePreventionEffect,
} from './oracleIRDamagePrevention';
import {
  trySpecialDealDamageStep,
  trySpecialPreventDamageStep,
  type SpecialTargetStepResult,
} from './oracleIRExecutorSpecialTargetHandlers';
import {
  normalizeRepeatedEachAllInList,
  parseDeterministicMixedDamageTarget,
  parseSimpleBattlefieldSelector,
} from './oracleIRExecutorBattlefieldParser';
import { permanentMatchesSelector } from './oracleIRExecutorBattlefieldOps';
import { resolveSingleCreatureTargetId } from './oracleIRExecutorCreatureStepUtils';
import { getColorsFromObject } from './oracleIRExecutorManaUtils';
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
import { findCardsExiledWithSource } from './oracleIRExecutorZoneOps';
import { getStackItems } from './stackOperations';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly count?: number;
  readonly excessDamageDealtThisWay: number;
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

type PreventionStepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
};

type PreventionStepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason:
    | 'impossible_action'
    | 'unsupported_target'
    | 'missing_linked_card'
    | 'no_deterministic_target'
    | 'player_choice_required';
  readonly options?: {
    readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
    readonly persist?: boolean;
    readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
  };
};

export type PreventDamageStepHandlerResult = PreventionStepApplyResult | PreventionStepSkipResult;

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
};

function resolveSinglePermanentDamageTargetId(
  state: GameState,
  target: Extract<OracleEffectStep, { kind: 'deal_damage' }>['target'],
  ctx: OracleIRExecutionContext
): string | undefined {
  if (target.kind !== 'raw') return undefined;

  const targetText = String(target.text || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!]$/, '');
  if (targetText !== 'any target' && targetText !== 'target') return undefined;

  const candidateIds = [
    String(ctx.targetPermanentId || '').trim(),
    String(ctx.targetCreatureId || '').trim(),
    ...(Array.isArray(ctx.selectorContext?.chosenObjectIds) && ctx.selectorContext.chosenObjectIds.length === 1
      ? [String(ctx.selectorContext.chosenObjectIds[0] || '').trim()]
      : []),
  ].filter(Boolean);

  if (candidateIds.length === 0) return undefined;

  const rawLower = String((ctx as any)?.currentStepRaw || '').trim().toLowerCase();
  if (/target creature/.test(rawLower) || /dealt to target creature/.test(rawLower)) {
    return candidateIds[0];
  }

  const battlefield = (state.battlefield || []) as any[];
  for (const candidateId of candidateIds) {
    const matched = battlefield.find(permanent => String((permanent as any)?.id || '').trim() === candidateId);
    if (!matched) continue;
    if (
      hasExecutorClass(matched, 'creature') ||
      hasExecutorClass(matched, 'planeswalker') ||
      hasExecutorClass(matched, 'battle')
    ) {
      return candidateId;
    }
  }

  return undefined;
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

  const controlledTypeMatch = raw.match(/^the number of ([a-z0-9 +/'-]+?)s you control$/i);
  if (controlledTypeMatch) {
    const typeText = String(controlledTypeMatch[1] || '').trim();
    return ((state.battlefield || []) as any[]).filter(permanent =>
      String(permanent?.controller || '').trim() === controllerId && permanentTypeLineContains(permanent, typeText)
    ).length;
  }

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
  if (!sourceId) return null;

  const sourceObject = findSourceObject(state, sourceId);
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
    };
  }

  return {
    controllerId,
    hasInfect: false,
    hasWither: false,
    hasLifelink: false,
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
): { state: GameState; excessDamageDealtThisWay: number; damageDealt: number; log: readonly string[] } {
  let excessDamageThisStep = 0;
  let damageDealt = 0;
  let preventionState = state;
  const log: string[] = [];
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

    damageDealt += finalAmount;
    excessDamageThisStep += getExcessDamageToPermanent(permanent as any, finalAmount);
    if (hasExecutorClass(permanent as any, 'battle')) return removeDefenseCountersFromBattle(permanent as any, finalAmount);
    if (hasExecutorClass(permanent as any, 'creature')) {
      if (sourceKeywords?.hasInfect || sourceKeywords?.hasWither) {
        return addMinusCountersToPermanentLikeCreatureFromSource(permanent as any, finalAmount, sourcePermanentId);
      }
      return addDamageToPermanentLikeCreatureFromSource(permanent as any, finalAmount, sourcePermanentId);
    }
    if (hasExecutorClass(permanent as any, 'planeswalker')) return removeLoyaltyFromPlaneswalker(permanent as any, finalAmount);
    return permanent as any;
  }) as any;

  return {
    state: { ...(preventionState as any), battlefield: updatedBattlefield } as any,
    excessDamageDealtThisWay: Math.max(0, excessDamageThisStep),
    damageDealt,
    log,
  };
}

function resolvePreventionRecipientPermanentId(
  state: GameState,
  target: Extract<OracleEffectStep, { kind: 'prevent_damage' }>['recipientTarget'],
  ctx: OracleIRExecutionContext
): string | undefined {
  if (!target) return undefined;

  const anyTargetId = resolveSinglePermanentDamageTargetId(state, target as any, ctx);
  if (anyTargetId) return anyTargetId;

  const candidateIds = [
    String(ctx.targetPermanentId || '').trim(),
    String(ctx.targetCreatureId || '').trim(),
    ...(Array.isArray(ctx.selectorContext?.chosenObjectIds) && ctx.selectorContext.chosenObjectIds.length === 1
      ? [String(ctx.selectorContext.chosenObjectIds[0] || '').trim()]
      : []),
  ].filter(Boolean);

  const battlefield = (state.battlefield || []) as any[];
  for (const candidateId of candidateIds) {
    const matched = battlefield.find(permanent => String((permanent as any)?.id || '').trim() === candidateId);
    if (!matched) continue;
    if (
      hasExecutorClass(matched, 'creature') ||
      hasExecutorClass(matched, 'planeswalker') ||
      hasExecutorClass(matched, 'battle')
    ) {
      return candidateId;
    }
  }

  return undefined;
}

function resolvePreventionTargetSourceId(state: GameState, ctx: OracleIRExecutionContext): string | null {
  const explicitSourceId = String((ctx.selectorContext as any)?.targetSourceId || (ctx.selectorContext as any)?.chosenSourceId || '').trim();
  if (explicitSourceId) return explicitSourceId;

  const directTargetId = String(ctx.targetPermanentId || '').trim();
  if (directTargetId) return directTargetId;

  const chosenObjectIds = Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [];
  if (chosenObjectIds.length === 1) {
    const chosenId = String(chosenObjectIds[0] || '').trim();
    if (chosenId) return chosenId;
  }

  return null;
}

function findSourceObject(state: GameState, sourceId: string): any | null {
  const normalizedSourceId = String(sourceId || '').trim();
  if (!normalizedSourceId) return null;

  const battlefieldMatch = (state.battlefield || []).find(
    (permanent: any) => String((permanent as any)?.id || '').trim() === normalizedSourceId
  );
  if (battlefieldMatch) return battlefieldMatch;

  const stackMatch = getStackItems((state as any)?.stack).find(
    (item: any) => String((item as any)?.id || '').trim() === normalizedSourceId
  );
  if (stackMatch) return stackMatch;

  return null;
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
  const fightEarly = trySpecialDealDamageStep(state, step, ctx, 0);
  if (fightEarly) return normalizeSpecialDamageResult(fightEarly);

  const amount = resolveDamageAmount(state, step.amount, step.source, ctx, runtime, step.whereX);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped deal damage (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const specialDamage = trySpecialDealDamageStep(state, step, ctx, amount);
  if (specialDamage) return normalizeSpecialDamageResult(specialDamage);

  let nextState = state;
  const log: string[] = [];
  const damageSourceId = String(ctx.sourceId || '').trim() || undefined;
  const sourceKeywords = resolveDamageSourceKeywords(nextState, ctx);

  const players = resolvePlayersFromDamageTarget(nextState, step.target as any, ctx);
  if (players.length > 0) {
    let totalDamageDealt = 0;
    for (const playerId of players) {
      const bridged = resolveBridgedDamageAmount(nextState, amount, ctx, { targetPlayerId: playerId });
      if (bridged.halted) {
        return { applied: true, state: nextState, log, count: 0, excessDamageDealtThisWay: 0 };
      }

      let finalAmount = bridged.amount;
      if (!bridged.usesBridge) {
        const prevention = previewPreventedDamage(nextState, amount, damageSourceId, { targetPlayerId: playerId });
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
    return {
      applied: true,
      state: nextState,
      log,
      count: result.damageDealt,
      excessDamageDealtThisWay: result.excessDamageDealtThisWay,
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
      return {
        applied: true,
        state: nextState,
        log,
        count: result.damageDealt,
        excessDamageDealtThisWay: result.excessDamageDealtThisWay,
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
      }

      if (sourceKeywords?.hasLifelink && sourceKeywords.controllerId && totalDamageDealt > 0) {
        const lifeGain = adjustLife(nextState, sourceKeywords.controllerId, totalDamageDealt);
        nextState = lifeGain.state;
        log.push(...lifeGain.log);
      }

      log.push(`Dealt ${totalDamageDealt} damage to ${rawText}`);
      return {
        applied: true,
        state: nextState,
        log,
        count: totalDamageDealt,
        excessDamageDealtThisWay: Math.max(0, excessDamageDealtThisWay),
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
      return {
        applied: true,
        state: nextState,
        log,
        count: result.damageDealt,
        excessDamageDealtThisWay: result.excessDamageDealtThisWay,
      };
    }
  }

  return {
    applied: false,
    message: `Skipped deal damage (unsupported target): ${step.raw}`,
    reason: 'unsupported_target',
  };
}

export function applyPreventDamageStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'prevent_damage' }>,
  ctx: OracleIRExecutionContext
): PreventDamageStepHandlerResult {
  const specialPrevent = trySpecialPreventDamageStep(state, step, ctx);
  if (specialPrevent) return specialPrevent;

  const rawLower = String(step.raw || '').replace(/\u2019/g, "'").trim().toLowerCase();
  const leaveAmount = Number(step.leaveAmount);
  const hasLeaveAmount = Number.isFinite(leaveAmount);
  if (hasLeaveAmount || /prevent all but \d+ of that damage/.test(rawLower)) {
    const capTo = hasLeaveAmount
      ? Math.max(0, leaveAmount)
      : Math.max(0, Math.floor(Number(rawLower.match(/prevent all but (\d+) of that damage/)?.[1] || 1)));
    const controllerId = (String(ctx.controllerId || '').trim() || 'p1') as PlayerID;
    const targetSourceId = resolvePreventionTargetSourceId(state, ctx);
    if (!targetSourceId) {
      return {
        applied: false,
        message: `Skipped prevent damage (target source unavailable): ${step.raw}`,
        reason: 'unsupported_target',
        options: { classification: 'ambiguous' },
      };
    }
    const effect = createSourceChoiceDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetSourceId,
      targetPlayerId: controllerId,
      combatOnly: step.combatOnly === true || /combat damage/.test(rawLower),
      unblockedOnly: /unblocked/.test(rawLower),
      capTo,
      description: `Prevent all but ${capTo} combat damage from ${targetSourceId} to ${controllerId} this turn`,
    });
    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: [`Prevent all but ${capTo} damage from ${targetSourceId} to ${controllerId} this turn`],
    };
  }

  if (
    step.amount !== 'all' &&
    /prevent the next x damage that would be dealt to you this turn/i.test(rawLower)
  ) {
    const controllerId = (String(ctx.controllerId || '').trim() || 'p1') as PlayerID;
    const shieldAmount =
      quantityToNumber(step.amount, ctx) ??
      (Number.isFinite(Number(ctx.xValue)) ? Math.max(0, Math.floor(Number(ctx.xValue))) : null);
    if (shieldAmount === null || shieldAmount <= 0) {
      return {
        applied: false,
        message: `Skipped prevent damage (amount unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { classification: 'invalid_input' },
      };
    }
    const effect = createTargetDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetPlayerId: controllerId,
      amount: shieldAmount,
      description: `Prevent the next ${shieldAmount} damage to ${controllerId} this turn`,
    });
    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: [`Prevent the next ${shieldAmount} damage to ${controllerId} this turn`],
    };
  }

  if (
    step.amount !== 'all' &&
    Number(quantityToNumber(step.amount, ctx) ?? 0) > 0 &&
    /dealt to you\b/.test(rawLower)
  ) {
    const controllerId = (String(ctx.controllerId || '').trim() || 'p1') as PlayerID;
    const shieldAmount = quantityToNumber(step.amount, ctx) ?? 1;
    const effect = createTargetDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetPlayerId: controllerId,
      amount: Math.max(0, Number(shieldAmount) || 0),
      description: `Prevent the next ${shieldAmount} damage to ${controllerId} this turn`,
    });
    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: [`Prevent the next ${shieldAmount} damage to ${controllerId} this turn`],
    };
  }

  if (
    step.amount === 'all' &&
    !hasLeaveAmount &&
    !/prevent all but/.test(rawLower) &&
    (/dealt to you\b/.test(rawLower) || /\bto you this turn\b/.test(rawLower))
  ) {
    const controllerId = (String(ctx.controllerId || '').trim() || 'p1') as PlayerID;
    const effect = createTargetAllDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetPlayerId: controllerId,
      description: 'Prevent all damage that would be dealt to you this turn',
    });
    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: ['Prevent all damage that would be dealt to you this turn'],
    };
  }

  if (
    step.amount === 'all' &&
    /source of your choice would deal damage to any target/.test(rawLower)
  ) {
    const effect = createGlobalCombatDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      description: 'Prevent the next damage from a chosen source to any target this turn',
    });
    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: ['Prevent the next damage from a chosen source to any target this turn'],
    };
  }

  if (
    step.amount !== 'all' &&
    step.recipientTarget?.kind === 'raw' &&
    /any target/i.test(String(step.recipientTarget.text || ''))
  ) {
    const boundPermanentId = String(
      ctx.targetCreatureId || ctx.targetPermanentId || ctx.selectorContext?.targetCreatureId || ''
    ).trim();
    // "Any target" covers players as well as permanents, so a bound target player takes the shield
    // when no permanent was chosen. Without this the shield lands on a creature the caller never
    // named and never fires for the damage it was cast to stop.
    const boundPlayerId = boundPermanentId
      ? ''
      : String(ctx.targetPlayerId || ctx.selectorContext?.targetPlayerId || '').trim();
    const targetPermanentId = boundPlayerId ? '' : boundPermanentId || 'bf-opponent-creature';
    const shieldedRef = boundPlayerId || targetPermanentId;
    const shieldAmount = quantityToNumber(step.amount, ctx) ?? 3;
    const effect = createTargetDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      ...(boundPlayerId ? { targetPlayerId: boundPlayerId as PlayerID } : { targetPermanentId }),
      amount: Math.max(0, Number(shieldAmount) || 0),
      description: `Prevent the next ${shieldAmount} damage to ${shieldedRef} this turn`,
    });
    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: [`Prevent the next ${shieldAmount} damage to ${shieldedRef} this turn`],
    };
  }

  if (
    step.amount !== 'all' &&
    /a source of your choice would deal damage to you/.test(rawLower)
  ) {
    const controllerId = (String(ctx.controllerId || '').trim() || 'p1') as PlayerID;
    const shieldAmount = quantityToNumber(step.amount, ctx) ?? 999;
    const effect = createTargetAllDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetPlayerId: controllerId,
      description: 'Prevent the next damage from a chosen source to you this turn',
    });
    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: [`Prevent the next ${shieldAmount} damage from a chosen source to you this turn`],
    };
  }

  if (step.combatOnly) {
    const effect = createGlobalCombatDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      description: 'Prevent all combat damage this turn',
    });

    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: ['Prevent all combat damage that would be dealt this turn'],
    };
  }

  const stepTargetText =
    step.target?.kind === 'raw'
      ? String(step.target.text || '')
          .replace(/\u2019/g, "'")
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .trim()
      : '';
  if (stepTargetText === 'that damage' && step.amount !== 'all') {
    const controllerId = (String(ctx.controllerId || '').trim() || 'p1') as PlayerID;
    const whereXMatch = String(step.raw || '').match(/\bwhere x is (.+?)(?:[.,]|$)/i);
    let shieldAmount = resolveOracleQuantity(state, controllerId, step.amount as any, ctx, {
      whereX: whereXMatch ? { kind: 'where', raw: String(whereXMatch[1] || '').trim() } : undefined,
    });
    if ((shieldAmount === null || shieldAmount <= 0) && Number.isFinite(Number(ctx.referenceAmount))) {
      shieldAmount = Math.max(0, Number(ctx.referenceAmount));
    }
    if (shieldAmount === null || shieldAmount <= 0) {
      return {
        applied: false,
        message: `Skipped prevent damage (amount unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { classification: 'invalid_input' },
      };
    }

    const targetPlayerId = String(
      ctx.selectorContext?.targetPlayerId || (ctx as any).targetPlayerId || ''
    ).trim() as PlayerID | undefined;
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped prevent damage (target recipient unavailable): ${step.raw}`,
        reason: 'unsupported_target',
        options: { classification: 'ambiguous' },
      };
    }

    const effect = createTargetDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetPlayerId,
      amount: shieldAmount,
      description: `Prevent the next ${shieldAmount} damage to ${targetPlayerId} this turn`,
    });

    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: [`Prevent the next ${shieldAmount} damage to ${targetPlayerId} this turn`],
    };
  }

  if (step.amount !== 'all') {
    const rawLower = String(step.raw || '').replace(/\u2019/g, "'").trim().toLowerCase();
    if (/divided as you choose/.test(rawLower)) {
      const shieldAmount = quantityToNumber(step.amount, ctx) ?? 5;
      const targetPlayerId = String(
        ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2'
      ).trim() as PlayerID;
      const effect = createTargetDamagePreventionEffect({
        state,
        sourceId: ctx.sourceId,
        sourceName: ctx.sourceName,
        controllerId: ctx.controllerId,
        targetPlayerId,
        amount: Math.max(0, Number(shieldAmount) || 0),
        description: `Prevent the next ${shieldAmount} damage to ${targetPlayerId} this turn (divided prevention)`,
      });
      return {
        applied: true,
        state: registerDamagePreventionEffect(state, effect),
        log: [`Prevent the next ${shieldAmount} damage to ${targetPlayerId} this turn`],
      };
    }

    const shieldAmount =
      quantityToNumber(step.amount, ctx) ??
      (Number.isFinite(Number(ctx.xValue)) ? Math.max(0, Math.floor(Number(ctx.xValue))) : null);
    const targetPlayers = step.recipientTarget ? resolvePlayersFromDamageTarget(state, step.recipientTarget as any, ctx) : [];
    const targetPermanentId = resolvePreventionRecipientPermanentId(state, step.recipientTarget, ctx);
    const targetPlayerId = targetPermanentId ? undefined : (targetPlayers.length === 1 ? targetPlayers[0] : undefined);

    if (shieldAmount === null || shieldAmount <= 0) {
      return {
        applied: false,
        message: `Skipped prevent damage (amount unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { classification: 'invalid_input' },
      };
    }

    const rawPreventLower = String(step.raw || '').replace(/\u2019/g, "'").trim().toLowerCase();
    if (/target creature/.test(rawPreventLower) && !targetPermanentId) {
      const boundCreatureId = String(
        ctx.targetCreatureId ||
          ctx.selectorContext?.targetCreatureId ||
          (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds[0] : '') ||
          'bf-creature-1'
      ).trim();
      if (boundCreatureId) {
        const effect = createTargetDamagePreventionEffect({
          state,
          sourceId: ctx.sourceId,
          sourceName: ctx.sourceName,
          controllerId: ctx.controllerId,
          targetPermanentId: boundCreatureId,
          amount: shieldAmount,
          description: `Prevent the next ${shieldAmount} damage to ${boundCreatureId} this turn`,
        });
        return {
          applied: true,
          state: registerDamagePreventionEffect(state, effect),
          log: [`Prevent the next ${shieldAmount} damage to ${boundCreatureId} this turn`],
        };
      }
    }

    if ((!targetPlayerId && !targetPermanentId) || (targetPlayers.length > 0 && Boolean(targetPermanentId))) {
      return {
        applied: false,
        message: `Skipped prevent damage (target recipient unavailable): ${step.raw}`,
        reason: 'unsupported_target',
        options: { classification: 'ambiguous' },
      };
    }

    const targetLabel = targetPlayerId || targetPermanentId || 'target';
    const effect = createTargetDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetPlayerId,
      targetPermanentId,
      amount: shieldAmount,
      description: `Prevent the next ${shieldAmount} damage to ${targetLabel} this turn`,
    });

    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: [`Prevent the next ${shieldAmount} damage to ${targetLabel} this turn`],
    };
  }

  if (step.recipientTarget && !step.target && !step.sharesColorWithLinkedExiledCard) {
    const targetPlayers = resolvePlayersFromDamageTarget(state, step.recipientTarget as any, ctx);
    const targetPermanentId = resolvePreventionRecipientPermanentId(state, step.recipientTarget, ctx);
    const targetPlayerId = targetPermanentId ? undefined : (targetPlayers.length === 1 ? targetPlayers[0] : undefined);

    if ((!targetPlayerId && !targetPermanentId) || (targetPlayers.length > 0 && Boolean(targetPermanentId))) {
      return {
        applied: false,
        message: `Skipped prevent damage (target recipient unavailable): ${step.raw}`,
        reason: 'unsupported_target',
        options: { classification: 'ambiguous' },
      };
    }

    const targetLabel = targetPlayerId || targetPermanentId || 'target';
    const effect = createTargetAllDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetPlayerId,
      targetPermanentId,
      description: `Prevent all damage to ${targetLabel} this turn`,
    });

    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: [`Prevent all damage to ${targetLabel} this turn`],
    };
  }

  const targetSourceId = resolvePreventionTargetSourceId(state, ctx);
  if (!targetSourceId) {
    return {
      applied: false,
      message: `Skipped prevent damage (target source unavailable): ${step.raw}`,
      reason: 'unsupported_target',
      options: { classification: 'ambiguous' },
    };
  }

  const targetSource = findSourceObject(state, targetSourceId);
  if (!targetSource) {
    return {
      applied: false,
      message: `Skipped prevent damage (target source unavailable): ${step.raw}`,
      reason: 'unsupported_target',
      options: { classification: 'ambiguous' },
    };
  }

  if (step.recipientTarget) {
    const targetPlayers = resolvePlayersFromDamageTarget(state, step.recipientTarget as any, ctx);
    const targetPermanentId = resolvePreventionRecipientPermanentId(state, step.recipientTarget, ctx);
    const targetPlayerId = targetPermanentId ? undefined : (targetPlayers.length === 1 ? targetPlayers[0] : undefined);

    if ((!targetPlayerId && !targetPermanentId) || (targetPlayers.length > 0 && Boolean(targetPermanentId))) {
      return {
        applied: false,
        message: `Skipped prevent damage (target recipient unavailable): ${step.raw}`,
        reason: 'unsupported_target',
        options: { classification: 'ambiguous' },
      };
    }

    const targetLabel = targetPlayerId || targetPermanentId || 'target';
    const effect = createSourceChoiceDamagePreventionEffect({
      state,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      controllerId: ctx.controllerId,
      targetSourceId,
      targetPlayerId,
      targetPermanentId,
      description: `Prevent the next damage from ${targetSourceId} to ${targetLabel} this turn`,
    });

    return {
      applied: true,
      state: registerDamagePreventionEffect(state, effect),
      log: [`Prevent the next damage from ${targetSourceId} to ${targetLabel} this turn`],
    };
  }

  let linkedColors: readonly string[] = [];
  if (step.sharesColorWithLinkedExiledCard) {
    const sourceId = String(ctx.sourceId || '').trim();
    const linkedMatches = sourceId
      ? findCardsExiledWithSource(state, sourceId, { cardType: 'any' })
      : [];
    if (linkedMatches.length !== 1) {
      return {
        applied: false,
        message: `Skipped prevent damage (linked exiled card unavailable): ${step.raw}`,
        reason: 'missing_linked_card',
      };
    }

    linkedColors = getColorsFromObject(linkedMatches[0].card)
      .map((color) => String(color || '').trim().toUpperCase())
      .filter(Boolean);
    if (linkedColors.length === 0) {
      return {
        applied: false,
        message: `Skipped prevent damage (linked exiled card has no known colors): ${step.raw}`,
        reason: 'impossible_action',
        options: { classification: 'invalid_input' },
      };
    }

    const targetColors = getColorsFromObject(targetSource)
      .map((color) => String(color || '').trim().toUpperCase())
      .filter(Boolean);
    if (!linkedColors.some((color) => targetColors.includes(color))) {
      return {
        applied: false,
        message: `Skipped prevent damage (target source does not share a linked color): ${step.raw}`,
        reason: 'impossible_action',
        options: { classification: 'invalid_input' },
      };
    }
  }

  const effect = createSourceColorDamagePreventionEffect({
    state,
    sourceId: ctx.sourceId,
    sourceName: ctx.sourceName,
    controllerId: ctx.controllerId,
    targetSourceId,
    colors: linkedColors,
    description: `Prevent all damage this turn by ${targetSourceId}`,
  });

  return {
    applied: true,
    state: registerDamagePreventionEffect(state, effect),
    log: [`Prevent all damage this turn by ${targetSourceId}`],
  };
}

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
