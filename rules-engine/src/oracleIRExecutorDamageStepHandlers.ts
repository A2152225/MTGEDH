import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  normalizeRepeatedEachAllInList,
  parseDeterministicMixedDamageTarget,
  parseSimpleBattlefieldSelector,
} from './oracleIRExecutorBattlefieldParser';
import { permanentMatchesSelector } from './oracleIRExecutorBattlefieldOps';
import {
  addDamageToPermanentLikeCreature,
  getExcessDamageToPermanent,
  hasExecutorClass,
  removeDefenseCountersFromBattle,
  removeLoyaltyFromPlaneswalker,
} from './oracleIRExecutorPermanentUtils';
import { adjustLife, quantityToNumber, resolvePlayers, resolvePlayersFromDamageTarget } from './oracleIRExecutorPlayerUtils';

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

function applyDamageToMatchingBattlefield(
  state: GameState,
  amount: number,
  ctx: OracleIRExecutionContext,
  matcher: (permanent: any) => boolean
): { state: GameState; excessDamageDealtThisWay: number } {
  let excessDamageThisStep = 0;

  const updatedBattlefield = (state.battlefield || []).map(permanent => {
    if (!matcher(permanent)) return permanent as any;
    excessDamageThisStep += getExcessDamageToPermanent(permanent as any, amount);
    if (hasExecutorClass(permanent as any, 'battle')) return removeDefenseCountersFromBattle(permanent as any, amount);
    if (hasExecutorClass(permanent as any, 'creature')) return addDamageToPermanentLikeCreature(permanent as any, amount);
    if (hasExecutorClass(permanent as any, 'planeswalker')) return removeLoyaltyFromPlaneswalker(permanent as any, amount);
    return permanent as any;
  }) as any;

  return {
    state: { ...(state as any), battlefield: updatedBattlefield } as any,
    excessDamageDealtThisWay: Math.max(0, excessDamageThisStep),
  };
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
  ctx: OracleIRExecutionContext
): DamageStepHandlerResult {
  const amount = quantityToNumber(step.amount);
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

  const players = resolvePlayersFromDamageTarget(nextState, step.target as any, ctx);
  if (players.length > 0) {
    for (const playerId of players) {
      const result = adjustLife(nextState, playerId, -amount);
      nextState = result.state;
      log.push(`${playerId} is dealt ${amount} damage`);
    }

    return { applied: true, state: nextState, log, excessDamageDealtThisWay: 0 };
  }

  if ((step.target as any)?.kind === 'raw') {
    const rawText = String(((step.target as any).text || '') as any).trim();
    const mixed = parseDeterministicMixedDamageTarget(rawText);
    if (mixed) {
      for (const playerId of resolveMixedDamagePlayers(nextState, mixed.players, ctx)) {
        const result = adjustLife(nextState, playerId, -amount);
        nextState = result.state;
        log.push(`${playerId} is dealt ${amount} damage`);
      }

      let excessDamageDealtThisWay = 0;
      for (const selector of mixed.selectors) {
        const result = applyDamageToMatchingBattlefield(
          nextState,
          amount,
          ctx,
          permanent => permanentMatchesSelector(permanent as any, selector, ctx)
        );
        nextState = result.state;
        excessDamageDealtThisWay += result.excessDamageDealtThisWay;
      }

      log.push(`Dealt ${amount} damage to ${rawText}`);
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
        amount,
        ctx,
        permanent => permanentMatchesSelector(permanent as any, selector, ctx)
      );
      log.push(`Dealt ${amount} damage to ${normalized}`);
      return {
        applied: true,
        state: result.state,
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
