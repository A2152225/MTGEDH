/**
 * oracleIRExecutorLookChooseControlTransfer.ts
 *
 * Origin parent: oracleIRExecutorPlayerLookChooseFromTopStep.ts (look_choose_from_top, battlefield destination).
 * Cluster: "<player> reveals cards ... until they reveal a <selector> card. You put that card onto the
 * battlefield under your control [and lose life equal to its mana value]" - the revealing player owns the
 * library, the ability controller controls the permanent and pays the life.
 *
 * Public entries: resolveLookChooseBattlefieldControllerId, applyLookChooseControllerManaValueLifeLoss.
 */

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { adjustLife, getCardManaValue } from './oracleIRExecutorPlayerUtils';

type LookChooseStep = Extract<OracleEffectStep, { kind: 'look_choose_from_top' }>;

export function resolveLookChooseBattlefieldControllerId(
  step: LookChooseStep,
  ctx: OracleIRExecutionContext,
): PlayerID | undefined {
  if (!step.putUnderYourControl) return undefined;
  const controllerId = String(ctx.controllerId || '').trim();
  return controllerId ? (controllerId as PlayerID) : undefined;
}

export function applyLookChooseControllerManaValueLifeLoss(
  state: GameState,
  step: LookChooseStep,
  ctx: OracleIRExecutionContext,
  enteredCards: readonly any[],
): { readonly state: GameState; readonly log: readonly string[] } {
  if (!step.loseLifeEqualToManaValue || enteredCards.length === 0) return { state, log: [] };
  const controllerId = String(ctx.controllerId || '').trim();
  if (!controllerId) return { state, log: [] };

  const total = enteredCards.reduce((sum, card) => sum + Math.max(0, Number(getCardManaValue(card) ?? 0) || 0), 0);
  if (total <= 0) return { state, log: [] };
  const lost = adjustLife(state, controllerId as PlayerID, -total);
  return { state: lost.state, log: lost.log };
}
