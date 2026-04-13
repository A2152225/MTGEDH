import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { addFutureSpellEffect } from './futureSpellEffects';
import { resolvePlayers } from './oracleIRExecutorPlayerUtils';

export function applyGrantFutureSpellEffectStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_future_spell_effect' }>,
  ctx: OracleIRExecutionContext,
): {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
} {
  const affectedPlayers = resolvePlayers(state, step.who, ctx);
  let nextState = state;

  for (const playerId of affectedPlayers) {
    nextState = addFutureSpellEffect(nextState, {
      controllerId: playerId,
      ...(ctx.sourceId ? { sourceId: ctx.sourceId } : {}),
      ...(ctx.sourceName ? { sourceName: ctx.sourceName } : {}),
      duration: 'this_turn',
      scope: step.scope,
      ...(Array.isArray(step.spellFilter?.cardTypes) && step.spellFilter.cardTypes.length > 0
        ? { cardTypes: step.spellFilter.cardTypes }
        : {}),
      ...(step.timingPermission ? { timingPermission: step.timingPermission } : {}),
      ...(step.counterImmunity ? { counterImmunity: step.counterImmunity } : {}),
      ...(step.castedPermanentEntersWithCounters
        ? { castedPermanentEntersWithCounters: step.castedPermanentEntersWithCounters }
        : {}),
    });
  }

  const scopeLabel = step.scope === 'next_qualifying_spell' ? 'next qualifying spell' : 'qualifying spells this turn';
  const filterLabel = Array.isArray(step.spellFilter?.cardTypes) && step.spellFilter.cardTypes.length > 0
    ? ` (${step.spellFilter.cardTypes.join(' ')})`
    : '';

  return {
    applied: true,
    state: nextState,
    log: [`Granted future spell effect to ${affectedPlayers.length} player(s) for ${scopeLabel}${filterLabel}`],
  };
}