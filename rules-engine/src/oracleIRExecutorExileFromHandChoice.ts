// "Each opponent exiles a card from their hand" (discard steps with destination 'exile'): the affected
// player chooses the card(s) like a discard, but they go to exile. Not a discard, so no madness and no
// discard triggers. A player with no more cards than required exiles their whole hand; otherwise the
// step waits on the player's choice (served by the DISCARD_SELECTION prompt with destination 'exile').
//
// Public entry points:
//   isHandExileChoiceStep, applyHandExileChoiceStep

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { commitCardZoneChanges } from './oracleIRExecutorCardZoneTransitionCommit';
import { getNormalizedChosenIds, resolveStepAmountForPlayer } from './oracleIRExecutorPlayerStepShared';
import type { PlayerStepHandlerResult } from './oracleIRExecutorPlayerStepTypes';
import { resolvePlayers } from './oracleIRExecutorPlayerUtils';
import { readPlayerZoneCards } from './oracleIRExecutorPlayerZoneAccess';

type DiscardStep = Extract<OracleEffectStep, { kind: 'discard' }>;

export function isHandExileChoiceStep(step: DiscardStep): boolean {
  return (step as any)?.destination === 'exile';
}

function cloneForZoneWrite(state: GameState): GameState {
  const zones = (state as any).zones;
  const clonedZones = zones && typeof zones === 'object'
    ? Object.fromEntries(Object.entries(zones).map(([key, value]) => [key, value && typeof value === 'object' ? { ...(value as any) } : value]))
    : undefined;
  return {
    ...(state as any),
    players: ((state.players || []) as any[]).map((player) => ({ ...player })),
    ...(clonedZones ? { zones: clonedZones } : {}),
  } as GameState;
}

export function applyHandExileChoiceStep(
  state: GameState,
  step: DiscardStep,
  ctx: OracleIRExecutionContext,
): PlayerStepHandlerResult {
  const controllerId = String((ctx as any).controllerId || '').trim() as PlayerID;
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped exile from hand (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const chosen = new Set(getNormalizedChosenIds(ctx));
  const plans: { playerId: PlayerID; cards: any[] }[] = [];
  for (const playerId of players) {
    const player = (state.players || []).find((entry: any) => entry?.id === playerId);
    const hand = readPlayerZoneCards(state, playerId, player, 'hand');
    const amount = resolveStepAmountForPlayer(state, controllerId, step.amount, ctx, playerId);
    if (amount === null || !Number.isFinite(amount)) {
      return {
        applied: false,
        message: `Skipped exile from hand (unknown amount): ${step.raw}`,
        reason: 'unknown_amount',
      };
    }
    const count = Math.max(0, Math.min(Math.floor(amount), hand.length));
    if (count === 0) continue;
    const picked = hand.filter((card: any) => chosen.has(String(card?.id || '').trim()));
    if (picked.length >= count) {
      plans.push({ playerId, cards: picked.slice(0, count) });
      continue;
    }
    if (hand.length <= count) {
      plans.push({ playerId, cards: hand });
      continue;
    }
    return {
      applied: false,
      message: `Exile from hand requires a card choice: ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  let nextState = cloneForZoneWrite(state);
  const log: string[] = [];
  const movedCards: any[] = [];
  const stepIndex = ctx.serverBridge && ctx.currentStepIndex != null ? ctx.currentStepIndex : Number.NaN;
  for (const plan of plans) {
    const result = commitCardZoneChanges({
      state: nextState,
      playerId: plan.playerId,
      cards: plan.cards,
      sourceZone: 'hand',
      intendedDestination: 'exile',
      stepIndex,
      stepKind: 'discard',
      cause: 'oracle_ir:exile_from_hand',
      ctx,
    });
    nextState = result.state;
    movedCards.push(...result.movedCards);
    log.push(...result.log);
    if (result.halted) break;
  }
  log.push(plans.length > 0
    ? plans.map((plan) => `${plan.playerId} exiles ${plan.cards.length} card(s) from hand`).join('; ')
    : `No cards to exile from hand: ${step.raw}`);
  return { applied: true, state: nextState, log, lastMovedCards: movedCards };
}
