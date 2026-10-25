/**
 * Origin parent: oracleIRExecutorBattlefieldGrantStaticAbilityStep.ts
 * Cluster: this-turn grant_static_ability "you may cast spells from your hand
 *   without paying their mana costs" stamps state.lastingEffects
 *   freeHandCastsThisTurn. Cleanup expires this_turn.
 * Public: tryApplyFreeHandCastsThisTurnGrant
 * Leaf must not import oracleIRExecutorMainLoop.ts or oracleIRExecutorBattlefieldStepHandlers.ts.
 */

import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';

const THIS_TURN_DURATIONS = new Set(['this_turn', 'end_of_turn']);

function grantEffectText(step: Extract<OracleEffectStep, { kind: 'grant_static_ability' }>): string {
  return [
    ...(Array.isArray(step.effectText) ? step.effectText : []),
    ...(Array.isArray(step.abilities) ? step.abilities : []),
    String(step.raw || ''),
  ]
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function currentTurnNumber(state: GameState): number {
  const turn = Number((state as { turnNumber?: number; turn?: number }).turnNumber
    ?? (state as { turn?: number }).turn
    ?? 0);
  return Number.isFinite(turn) ? turn : 0;
}

export function tryApplyFreeHandCastsThisTurnGrant(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_static_ability' }>,
  ctx: OracleIRExecutionContext,
): BattlefieldStepHandlerResult | null {
  const duration = String(step.duration || 'static').trim();
  if (!THIS_TURN_DURATIONS.has(duration)) return null;

  const effectText = grantEffectText(step);
  if (!effectText.includes('without paying')) return null;
  if (!effectText.includes('from your hand')) return null;
  if (!/cast (?:spells|nonland cards|cards) from your hand/.test(effectText)) return null;

  const controllerId = String(ctx.controllerId || '').trim();
  if (!controllerId) {
    return {
      applied: false,
      message: `Skipped this-turn free hand casts (no controller): ${step.raw}`,
      reason: 'unsupported_player_selector',
      options: { classification: 'ambiguous' },
    };
  }

  const existing = Array.isArray(state.lastingEffects)
    ? [...state.lastingEffects]
    : [];
  const sourceName = String(ctx.sourceName || '').trim() || 'this turn';
  const sourceId = String(ctx.sourceId || '').trim();
  const duplicate = existing.some((entry: any) =>
    String(entry?.type || '') === 'freeHandCastsThisTurn'
    && String(entry?.controllerId || '') === controllerId
    && String(entry?.sourceId || '') === sourceId
  );
  if (duplicate) {
    return { applied: true, state, log: [`Already granted this-turn free hand casts to ${controllerId}`] };
  }

  const stamp = {
    type: 'freeHandCastsThisTurn',
    duration: 'this_turn',
    controllerId,
    playerId: controllerId,
    sourceId: sourceId || undefined,
    sourceName,
    source: sourceName,
    turnApplied: currentTurnNumber(state),
  };

  return {
    applied: true,
    state: {
      ...state,
      lastingEffects: [...existing, stamp],
    },
    log: [`Granted this-turn free hand casts to ${controllerId} via ${sourceName}`],
  };
}
