/**
 * socket/interaction-handlers/activationTargetsBeforeCosts.ts
 *
 * CR 602.2b / 601.2c-h: an activated ability's targets are chosen before its costs are paid.
 * Many activation families (grant / fight / counter / move-counter / tap-untap, equip, level-up
 * style, planeswalker loyalty, the generic non-mana path) validate the cost, pay it, and then queue
 * the target prompt. Rather than reorder each family, activateBattlefieldAbility is wrapped:
 *
 *   1. snapshot the activator's mana pool and life and the source's tapped state and counters;
 *   2. run the activation;
 *   3. if it queued a target prompt for that source, undo the cost-shaped changes and attach them
 *      to the prompt as `deferredActivationCost`;
 *   4. payDeferredActivationCostForStep re-applies them once the targets are chosen (and drops the
 *      activation if they can no longer be paid). Cancelling the prompt pays nothing.
 *
 * Persistence is untouched: the activation event already records the payment and the persisted
 * queued step carries no deferred cost, so replay applies the payment exactly once.
 */

import type { Server } from "socket.io";
import { ResolutionStepStatus, ResolutionStepType, ResolutionQueueManager } from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import { broadcastGame, emitToPlayer, ensureGame } from "../util.js";

type CostSnapshot = {
  pool: Record<string, number>;
  life: number;
  tapped: boolean;
  counters: Record<string, number>;
  loyalty: number | undefined;
};

export type DeferredActivationCost = {
  playerId: string;
  permanentId: string;
  poolDelta: Record<string, number>;
  lifeDelta: number;
  tapSource: boolean;
  countersDelta: Record<string, number>;
  loyaltyDelta: number;
};

const TARGET_STEP_TYPES = new Set<string>([
  ResolutionStepType.TARGET_SELECTION,
  ResolutionStepType.FIGHT_TARGET,
  ResolutionStepType.COUNTER_TARGET,
  ResolutionStepType.COUNTER_MOVEMENT,
  ResolutionStepType.TAP_UNTAP_TARGET,
  ResolutionStepType.GRAVEYARD_SELECTION,
].map(String));

const COST_CHOICE_FLAGS = new Set(['tapCreaturesCost', 'crewAbility', 'saddleAbility', 'stationAbility', 'opponentTargetChooserSelection']);

/** A prompt that chooses the ability's targets (not a cost choice such as crew, sacrifice or tap-other). */
export function isAbilityTargetPromptStep(step: any): boolean {
  if (!step || !TARGET_STEP_TYPES.has(String(step.type || ''))) return false;
  for (const [key, value] of Object.entries(step)) {
    if (value === true && (/AsCost$/.test(key) || COST_CHOICE_FLAGS.has(key))) return false;
  }
  const type = String(step.type);
  if (type === String(ResolutionStepType.TARGET_SELECTION) || type === String(ResolutionStepType.GRAVEYARD_SELECTION)) {
    return step.battlefieldAbilityTargetSelection === true || Boolean(step.planeswalkerAbility);
  }
  return true;
}

function snapshot(game: any, playerId: string, permanentId: string): CostSnapshot {
  const pool = { ...((game.state?.manaPool || {})[playerId] || {}) };
  const perm = (game.state?.battlefield || []).find((p: any) => p && String(p.id) === permanentId);
  return {
    pool: Object.fromEntries(Object.entries(pool).filter(([, v]) => typeof v === 'number')) as Record<string, number>,
    life: Number(game.state?.life?.[playerId] ?? NaN),
    tapped: Boolean(perm?.tapped),
    counters: Object.fromEntries(Object.entries(perm?.counters || {}).filter(([, v]) => typeof v === 'number')) as Record<string, number>,
    loyalty: typeof perm?.loyalty === 'number' ? perm.loyalty : undefined,
  };
}

function numericDelta(before: Record<string, number>, after: Record<string, number>): Record<string, number> {
  const delta: Record<string, number> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const d = Number(after[key] || 0) - Number(before[key] || 0);
    if (d !== 0) delta[key] = d;
  }
  return delta;
}

function sourceIdOf(step: any): string {
  return String(step?.permanentId || step?.sourceId || '');
}

/** Wraps the activateBattlefieldAbility socket handler (see module header). */
export function withActivationTargetsBeforeCosts<P extends { gameId?: unknown; permanentId?: unknown }>(
  io: Server,
  socket: any,
  handler: (payload?: P) => Promise<void>,
): (payload?: P) => Promise<void> {
  return async (payload?: P) => {
    const gameId = typeof payload?.gameId === 'string' ? payload.gameId : String(socket?.data?.gameId || '');
    const permanentId = typeof payload?.permanentId === 'string' ? payload.permanentId : '';
    const playerId = String(socket?.data?.playerId || '');
    const game: any = gameId && permanentId && playerId ? ensureGame(gameId) : undefined;
    if (!game || (game as any).isReplaying) {
      await handler(payload);
      return;
    }
    const before = snapshot(game, playerId, permanentId);
    const priorStepIds = new Set((ResolutionQueueManager.getQueue(gameId)?.steps || []).map((s: any) => String(s?.id || '')));
    await handler(payload);

    const steps: any[] = ResolutionQueueManager.getQueue(gameId)?.steps || [];
    const targetStep = steps.find((s: any) => s && !priorStepIds.has(String(s.id || ''))
      && s.status === ResolutionStepStatus.PENDING
      && String(s.targetsChosenFor || s.playerId || '') === playerId
      && sourceIdOf(s) === permanentId
      && isAbilityTargetPromptStep(s));
    if (!targetStep) return;

    const after = snapshot(game, playerId, permanentId);
    const poolDelta = numericDelta(before.pool, after.pool);
    const lifeDelta = Number.isFinite(before.life) && Number.isFinite(after.life) ? after.life - before.life : 0;
    const tapSource = !before.tapped && after.tapped;
    const countersDelta = numericDelta(before.counters, after.counters);
    const loyaltyDelta = before.loyalty !== undefined && after.loyalty !== undefined ? after.loyalty - before.loyalty : 0;
    if (Object.keys(poolDelta).length === 0 && lifeDelta === 0 && !tapSource && Object.keys(countersDelta).length === 0 && loyaltyDelta === 0) return;

    const cost: DeferredActivationCost = { playerId, permanentId, poolDelta, lifeDelta, tapSource, countersDelta, loyaltyDelta };
    applyCost(game, cost, -1);
    targetStep.deferredActivationCost = cost;
    debug(2, `[activationTargetsBeforeCosts] ${permanentId}: cost deferred until targets are chosen (CR 602.2b)`);
    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
  };
}

function applyCost(game: any, cost: DeferredActivationCost, sign: 1 | -1): void {
  const state = game.state;
  if (Object.keys(cost.poolDelta).length > 0) {
    state.manaPool = state.manaPool || {};
    const pool = state.manaPool[cost.playerId] = state.manaPool[cost.playerId] || {};
    for (const [key, d] of Object.entries(cost.poolDelta)) pool[key] = Number(pool[key] || 0) + sign * d;
  }
  if (cost.lifeDelta !== 0) {
    state.life = state.life || {};
    state.life[cost.playerId] = Number(state.life[cost.playerId] || 0) + sign * cost.lifeDelta;
    const player = (state.players || []).find((p: any) => p && String(p.id) === cost.playerId);
    if (player && typeof player.life === 'number') player.life = state.life[cost.playerId];
  }
  const perm = (state.battlefield || []).find((p: any) => p && String(p.id) === cost.permanentId);
  if (!perm) return;
  if (cost.tapSource) perm.tapped = sign > 0;
  if (Object.keys(cost.countersDelta).length > 0) {
    perm.counters = perm.counters || {};
    for (const [key, d] of Object.entries(cost.countersDelta)) {
      const next = Number(perm.counters[key] || 0) + sign * d;
      if (next > 0) perm.counters[key] = next; else delete perm.counters[key];
    }
  }
  if (cost.loyaltyDelta !== 0 && typeof perm.loyalty === 'number') perm.loyalty += sign * cost.loyaltyDelta;
}

/** What makes a deferred cost unpayable now (or null when it can be paid). */
export function deferredActivationCostProblem(game: any, cost: DeferredActivationCost): string | null {
  const pool = (game.state?.manaPool || {})[cost.playerId] || {};
  for (const [key, d] of Object.entries(cost.poolDelta)) {
    if (Number(pool[key] || 0) + d < 0) return 'Insufficient mana to pay the activation cost.';
  }
  const perm = (game.state?.battlefield || []).find((p: any) => p && String(p.id) === cost.permanentId);
  if (cost.tapSource && (!perm || perm.tapped)) return 'The source can no longer be tapped to pay the activation cost.';
  for (const [key, d] of Object.entries(cost.countersDelta)) {
    if (d < 0 && Number(perm?.counters?.[key] || 0) + d < 0) return `Not enough ${key} counters to pay the activation cost.`;
  }
  return null;
}

/**
 * Called before a step response is handled. Pays the deferred cost when the targets are chosen;
 * returns false (activation dropped) when it can no longer be paid.
 */
export function payDeferredActivationCostForStep(io: Server, game: any, step: any, response: any): boolean {
  const cost: DeferredActivationCost | undefined = step?.deferredActivationCost;
  if (!cost || step.deferredActivationCostPaid === true) return true;
  if (response?.cancelled === true || (game as any).isReplaying) return true;
  // Mixed choosers: an opponent still has to pick. Pay once every target is chosen.
  if (step?.mixedChooserFollowup && typeof step.mixedChooserFollowup === 'object') {
    step.mixedChooserFollowup.deferredActivationCost = cost;
    return true;
  }
  const problem = deferredActivationCostProblem(game, cost);
  if (problem) {
    emitToPlayer(io, cost.playerId as any, 'error', { code: 'COST_UNPAYABLE', message: problem });
    return false;
  }
  applyCost(game, cost, 1);
  step.deferredActivationCostPaid = true;
  return true;
}
