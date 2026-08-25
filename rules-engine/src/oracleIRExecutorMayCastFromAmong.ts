/**
 * Origin parent: rules-engine/src/oracleIRExecutorMainLoop.ts
 * Cluster: applyMayCastFromAmongStep — optional free-cast from cards milled
 *   this resolution (Summons of Saruman family). Server queues existing
 *   GRAVEYARD_SELECTION when any eligible milled spell remains.
 * Public: applyMayCastFromAmongStep
 * Leaf must not import oracleIRExecutor.ts or oracleIRExecutorMainLoop.ts.
 */

import type { OracleEffectStep, OracleQuantity } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';
import type { GameState } from '../../shared/src';

function resolveMaxManaValue(amount: OracleQuantity | undefined, ctx: OracleIRExecutionContext): number {
  if (!amount) return Number.NaN;
  if (amount.kind === 'number') return Number(amount.value);
  if (amount.kind === 'x') {
    const xValue = Number(ctx.xValue);
    return Number.isFinite(xValue) ? xValue : Number.NaN;
  }
  return Number.NaN;
}

function cardManaValue(card: any): number {
  const value = Number(card?.mana_value ?? card?.cmc ?? card?.manaValue ?? card?.card?.mana_value ?? card?.card?.cmc);
  return Number.isFinite(value) ? value : 0;
}

function cardMatchesTypes(card: any, cardTypes: readonly string[]): boolean {
  const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
  if (!typeLine) return false;
  return cardTypes.some((typeWord) => typeLine.includes(String(typeWord || '').toLowerCase()));
}

export function applyMayCastFromAmongStep(
  _state: GameState,
  step: Extract<OracleEffectStep, { kind: 'may_cast_from_among' }>,
  ctx: OracleIRExecutionContext,
): BattlefieldStepHandlerResult {
  const maxManaValue = resolveMaxManaValue(step.maxManaValue, ctx);
  const cardTypes = (Array.isArray(step.cardTypes) ? step.cardTypes : [])
    .map((typeWord) => String(typeWord || '').trim().toLowerCase())
    .filter(Boolean);
  const milled = Array.isArray(ctx.lastMilledCards) ? ctx.lastMilledCards : [];
  const eligible = milled.filter((card) => {
    if (cardTypes.length > 0 && !cardMatchesTypes(card, cardTypes)) return false;
    if (Number.isFinite(maxManaValue) && cardManaValue(card) > maxManaValue) return false;
    return true;
  });

  if (eligible.length === 0) {
    return {
      applied: true,
      state: _state,
      log: [`No eligible ${cardTypes.join('/')} among milled cards to cast`],
    };
  }

  return {
    applied: false,
    message: `You may cast ${cardTypes.join('/')} with mana value ${Number.isFinite(maxManaValue) ? maxManaValue : 'X'} or less from among milled cards: ${step.raw}`,
    reason: 'player_choice_required',
    options: { classification: 'player_choice' },
  };
}
