import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { createDamageSourceFromPermanent } from './damageProcessing';
import {
  createSourceColorDamagePreventionEffect,
  previewPreventedDamage,
  registerDamagePreventionEffect,
} from './oracleIRDamagePrevention';
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
import { adjustLife, adjustPlayerCounter, getCardManaValue, quantityToNumber, resolvePlayers, resolvePlayersFromDamageTarget } from './oracleIRExecutorPlayerUtils';
import { findCardsExiledWithSource } from './oracleIRExecutorZoneOps';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly excessDamageDealtThisWay: number;
};

type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason: 'unknown_amount' | 'unsupported_target' | 'unsupported_permanent_types';
  readonly options?: {
    readonly classification?: 'ambiguous';
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
  readonly reason: 'impossible_action' | 'unsupported_target' | 'missing_linked_card';
  readonly options?: {
    readonly classification?: 'ambiguous' | 'invalid_input';
  };
};

export type PreventDamageStepHandlerResult = PreventionStepApplyResult | PreventionStepSkipResult;

type DamageRuntime = {
  readonly lastMovedCards?: readonly any[];
  readonly lastTappedMatchingPermanentCount?: number;
};

type DamageSourceKeywords = {
  readonly controllerId: PlayerID | null;
  readonly hasInfect: boolean;
  readonly hasWither: boolean;
  readonly hasLifelink: boolean;
};

function readFiniteCardStat(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function resolveDamageAmount(
  amount: Extract<OracleEffectStep, { kind: 'deal_damage' }>['amount'],
  runtime?: DamageRuntime
): number | null {
  const numericAmount = quantityToNumber(amount);
  if (numericAmount !== null) return numericAmount;
  if (amount.kind !== 'unknown') return null;

  const raw = String(amount.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  if (!raw) return null;

  const moved = Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : [];
  if (moved.length === 1 && /^(?:its|that card's|that creature's) mana value$/.test(raw)) {
    const manaValue = getCardManaValue(moved[0]);
    return manaValue === null ? null : manaValue;
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
  sourceKeywords?: DamageSourceKeywords | null
): { state: GameState; excessDamageDealtThisWay: number; damageDealt: number } {
  let excessDamageThisStep = 0;
  let damageDealt = 0;
  const sourcePermanentId = String(ctx.sourceId || '').trim() || undefined;

  const updatedBattlefield = (state.battlefield || []).map(permanent => {
    if (!matcher(permanent)) return permanent as any;
    damageDealt += amount;
    excessDamageThisStep += getExcessDamageToPermanent(permanent as any, amount);
    if (hasExecutorClass(permanent as any, 'battle')) return removeDefenseCountersFromBattle(permanent as any, amount);
    if (hasExecutorClass(permanent as any, 'creature')) {
      if (sourceKeywords?.hasInfect || sourceKeywords?.hasWither) {
        return addMinusCountersToPermanentLikeCreatureFromSource(permanent as any, amount, sourcePermanentId);
      }
      return addDamageToPermanentLikeCreatureFromSource(permanent as any, amount, sourcePermanentId);
    }
    if (hasExecutorClass(permanent as any, 'planeswalker')) return removeLoyaltyFromPlaneswalker(permanent as any, amount);
    return permanent as any;
  }) as any;

  return {
    state: { ...(state as any), battlefield: updatedBattlefield } as any,
    excessDamageDealtThisWay: Math.max(0, excessDamageThisStep),
    damageDealt,
  };
}

function resolvePreventionTargetSourceId(state: GameState, ctx: OracleIRExecutionContext): string | null {
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

  const stackMatch = (state.stack || []).find(
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

export function applyDealDamageStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'deal_damage' }>,
  ctx: OracleIRExecutionContext,
  runtime?: DamageRuntime
): DamageStepHandlerResult {
  const amount = resolveDamageAmount(step.amount, runtime);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped deal damage (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  let nextState = state;
  const log: string[] = [];
  const damageSourceId = String(ctx.sourceId || '').trim() || undefined;
  const sourceKeywords = resolveDamageSourceKeywords(nextState, ctx);
  const prevention = previewPreventedDamage(nextState, amount, damageSourceId);
  log.push(...prevention.log);
  const finalAmount = prevention.remainingDamage;
  if (finalAmount <= 0) {
    log.push(`All damage was prevented: ${step.raw}`);
    return { applied: true, state: nextState, log, excessDamageDealtThisWay: 0 };
  }

  const players = resolvePlayersFromDamageTarget(nextState, step.target as any, ctx);
  if (players.length > 0) {
    for (const playerId of players) {
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
    }

    return { applied: true, state: nextState, log, excessDamageDealtThisWay: 0 };
  }

  if ((step.target as any)?.kind === 'raw') {
    const rawText = String(((step.target as any).text || '') as any).trim();
    const singleCreatureId = resolveSingleCreatureTargetId(nextState, step.target as any, ctx);
    if (singleCreatureId) {
      const result = applyDamageToMatchingBattlefield(
        nextState,
        finalAmount,
        ctx,
        permanent => String((permanent as any)?.id || '').trim() === singleCreatureId,
        sourceKeywords
      );
      nextState = result.state;
      if (sourceKeywords?.hasLifelink && sourceKeywords.controllerId && result.damageDealt > 0) {
        const lifeGain = adjustLife(nextState, sourceKeywords.controllerId, result.damageDealt);
        nextState = lifeGain.state;
        log.push(...lifeGain.log);
      }
      log.push(`Dealt ${finalAmount} damage to ${rawText}`);
      return {
        applied: true,
        state: nextState,
        log,
        excessDamageDealtThisWay: result.excessDamageDealtThisWay,
      };
    }

    const mixed = parseDeterministicMixedDamageTarget(rawText);
    if (mixed) {
      for (const playerId of resolveMixedDamagePlayers(nextState, mixed.players, ctx)) {
        const result = adjustLife(nextState, playerId, -finalAmount);
        nextState = result.state;
        log.push(`${playerId} is dealt ${finalAmount} damage`);
      }

      let excessDamageDealtThisWay = 0;
      let totalDamageDealt = 0;
      for (const selector of mixed.selectors) {
        const result = applyDamageToMatchingBattlefield(
          nextState,
          finalAmount,
          ctx,
          permanent => permanentMatchesSelector(permanent as any, selector, ctx),
          sourceKeywords
        );
        nextState = result.state;
        excessDamageDealtThisWay += result.excessDamageDealtThisWay;
        totalDamageDealt += result.damageDealt;
      }

      if (sourceKeywords?.hasLifelink && sourceKeywords.controllerId && totalDamageDealt > 0) {
        const lifeGain = adjustLife(nextState, sourceKeywords.controllerId, totalDamageDealt);
        nextState = lifeGain.state;
        log.push(...lifeGain.log);
      }

      log.push(`Dealt ${finalAmount} damage to ${rawText}`);
      return {
        applied: true,
        state: nextState,
        log,
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
        finalAmount,
        ctx,
        permanent => permanentMatchesSelector(permanent as any, selector, ctx),
        sourceKeywords
      );
      nextState = result.state;
      if (sourceKeywords?.hasLifelink && sourceKeywords.controllerId && result.damageDealt > 0) {
        const lifeGain = adjustLife(nextState, sourceKeywords.controllerId, result.damageDealt);
        nextState = lifeGain.state;
        log.push(...lifeGain.log);
      }
      log.push(`Dealt ${finalAmount} damage to ${normalized}`);
      return {
        applied: true,
        state: nextState,
        log,
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
