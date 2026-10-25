/**
 * socket/assistPaymentFlow.ts
 *
 * Assist (CR 702.132) wiring for the cast/payment socket flow.
 *  - Caster emits `requestAssist` { gameId, effectId, helperId } while a cast is pending payment.
 *  - The helper gets a NUMBER_CHOICE resolution step (0..max) flagged `assistPaymentChoice`.
 *  - The chosen amount is drained from the helper's mana pool and stored as an assist credit
 *    keyed by caster + card; the cost assembly consumes it as a generic-cost reduction.
 */

import type { Server, Socket } from "socket.io";
import { ResolutionQueueManager, ResolutionStepType } from "../state/resolution/index.js";
import { applyAssistContribution, hasAssist, maxAssistAmount } from "../state/modules/assistPayment.js";
import { broadcastGame, ensureGame } from "./util.js";

type AssistCredit = { amount: number; helperId: string; turn: number; paidByColor?: Record<string, number> };

function playerDisplayName(state: any, playerId: string): string {
  const p = (state?.players || []).find((x: any) => String(x?.id) === String(playerId));
  return String(p?.name || playerId);
}

function currentTurn(state: any): number {
  return Number(state?.turnNumber ?? state?.turn ?? 0) || 0;
}

function creditKey(casterId: string, cardId: string): string {
  return `${casterId}:${cardId}`;
}

function findPendingCast(state: any, effectId: string): any {
  return state?.pendingSpellCasts?.[effectId];
}

function findCasterCard(state: any, casterId: string, cardId: string): any {
  const zones = state?.zones?.[casterId] || {};
  for (const zone of ['hand', 'graveyard', 'exile', 'commandZone', 'library']) {
    const found = (Array.isArray(zones[zone]) ? zones[zone] : []).find((c: any) => c?.id === cardId);
    if (found) return found;
  }
  return (state?.commandZone?.[casterId]?.cards || []).find?.((c: any) => c?.id === cardId);
}

/** Validate and enqueue the helper's assist prompt. Returns an error code or null. */
export function requestAssistForPendingCast(
  game: any,
  gameId: string,
  casterId: string,
  effectId: string,
  helperId: string,
): string | null {
  const state = game?.state;
  const pending = findPendingCast(state, effectId);
  if (!pending || String(pending.playerId) !== String(casterId)) return 'NO_PENDING_CAST';
  if (!helperId || helperId === casterId) return 'HELPER_MUST_BE_OTHER_PLAYER';
  if (!(state?.players || []).some((p: any) => p?.id === helperId)) return 'UNKNOWN_PLAYER';
  const card = findCasterCard(state, casterId, String(pending.cardId));
  const oracle = String(card?.oracle_text || pending.oracleText || '');
  if (!hasAssist(oracle)) return 'NO_ASSIST';
  const max = maxAssistAmount(String(pending.manaCost || card?.mana_cost || ''), Number(pending.xValue || 0));
  if (max <= 0) return 'NO_GENERIC_COST';
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.NUMBER_CHOICE,
    playerId: helperId as any,
    sourceId: String(pending.cardId),
    sourceName: String(pending.cardName || card?.name || 'Assist'),
    sourceImage: card?.image_uris?.small,
    description: `Assist ${playerDisplayName(state, casterId)}: pay up to ${max} generic mana toward their ${String(pending.cardName || card?.name || 'spell')} from your mana pool (0 to decline).`,
    mandatory: false,
    minValue: 0,
    maxValue: max,
    assistPaymentChoice: true,
    assistEffectId: effectId,
    assistCasterId: casterId,
    assistCardId: String(pending.cardId),
  } as any);
  return null;
}

export function isAssistPaymentChoiceStep(step: any): boolean {
  return step?.assistPaymentChoice === true;
}

/** Apply the helper's chosen amount. Returns the amount actually paid. */
export function applyAssistPaymentChoice(game: any, step: any, helperId: string, chosen: number | null): number {
  const state = game?.state;
  if (!state || !chosen || chosen <= 0) return 0;
  if (String(step?.playerId) !== String(helperId)) return 0;
  const casterId = String(step.assistCasterId || '');
  const cardId = String(step.assistCardId || '');
  const pending = findPendingCast(state, String(step.assistEffectId || ''));
  const card = findCasterCard(state, casterId, cardId);
  const totalCost = String(pending?.manaCost || card?.mana_cost || '');
  const key = creditKey(casterId, cardId);
  state.assistCredits = state.assistCredits || {};
  const prior: AssistCredit | undefined = state.assistCredits[key];
  const tracker: any = {
    oracle_text: String(card?.oracle_text || ''),
    assistPaid: prior && prior.turn === currentTurn(state) ? prior.amount : 0,
  };
  const max = Math.max(0, Number(step.maxValue || 0));
  const poolBefore: Record<string, number> = { ...(state.manaPool?.[helperId] || {}) };
  const result = applyAssistContribution(state, tracker, casterId, helperId, Math.min(chosen, max), totalCost, Number(pending?.xValue || 0));
  if (!result.ok) return 0;
  const paidByColor: Record<string, number> = prior && prior.turn === currentTurn(state) ? { ...(prior.paidByColor || {}) } : {};
  const poolAfter = state.manaPool?.[helperId] || {};
  for (const [k, v] of Object.entries(poolBefore)) {
    const diff = Number(v || 0) - Number(poolAfter[k] || 0);
    if (diff > 0) paidByColor[k] = (paidByColor[k] || 0) + diff;
  }
  state.assistCredits[key] = { amount: tracker.assistPaid, helperId, turn: currentTurn(state), paidByColor } as AssistCredit;
  return result.paid;
}

/** Cost assembly hook: consume any assist credit for this cast, returning the reduced generic. */
export function consumeAssistCredit(state: any, casterId: string, cardId: string, generic: number): number {
  const key = creditKey(String(casterId), String(cardId));
  const credit: AssistCredit | undefined = state?.assistCredits?.[key];
  if (!credit) return generic;
  delete state.assistCredits[key];
  if (credit.turn !== currentTurn(state)) return generic;
  return Math.max(0, generic - Math.max(0, Number(credit.amount || 0)));
}

/**
 * Abandoned cast: return the helper's assist mana (exact colors) to their pool and drop the credit.
 * Returns the amount refunded.
 */
export function refundAssistCredit(state: any, casterId: string, cardId: string): number {
  const key = creditKey(String(casterId), String(cardId));
  const credit: AssistCredit | undefined = state?.assistCredits?.[key];
  if (!credit) return 0;
  delete state.assistCredits[key];
  state.manaPool = state.manaPool || {};
  const pool = (state.manaPool[credit.helperId] = state.manaPool[credit.helperId] || {});
  let refunded = 0;
  const byColor = credit.paidByColor && Object.keys(credit.paidByColor).length ? credit.paidByColor : { colorless: credit.amount };
  for (const [k, v] of Object.entries(byColor)) {
    const n = Math.max(0, Number(v || 0));
    pool[k] = Number(pool[k] || 0) + n;
    refunded += n;
  }
  return refunded;
}

/** Refund for a pending cast identified by effectId (caster must own it). */
export function abandonAssistedCast(game: any, casterId: string, effectId: string): number {
  const state = game?.state;
  const pending = findPendingCast(state, effectId);
  if (!pending || String(pending.playerId) !== String(casterId)) return 0;
  return refundAssistCredit(state, casterId, String(pending.cardId));
}

export function registerAssistSocketHandlers(io: Server, socket: Socket): void {
  socket.on("requestAssist", (payload?: { gameId?: unknown; effectId?: unknown; helperId?: unknown }) => {
    const gameId = payload?.gameId;
    const effectId = payload?.effectId;
    const helperId = payload?.helperId;
    if (typeof gameId !== 'string' || typeof effectId !== 'string' || typeof helperId !== 'string') return;
    const casterId = (socket.data as any)?.playerId;
    const game = ensureGame(gameId);
    if (!game || !casterId) return;
    if (!(socket as any)?.rooms?.has?.(gameId)) return;
    const error = requestAssistForPendingCast(game, gameId, String(casterId), effectId, helperId);
    if (error) {
      socket.emit("error", { code: error, message: `Cannot request assist: ${error}` });
      return;
    }
    broadcastGame(io, game, gameId);
  });

  socket.on("abandonAssistedCast", (payload?: { gameId?: unknown; effectId?: unknown }) => {
    const gameId = payload?.gameId;
    const effectId = payload?.effectId;
    if (typeof gameId !== 'string' || typeof effectId !== 'string') return;
    const casterId = (socket.data as any)?.playerId;
    const game = ensureGame(gameId);
    if (!game || !casterId) return;
    if (!(socket as any)?.rooms?.has?.(gameId)) return;
    const pendingBefore = findPendingCast(game.state, effectId);
    const helperId = pendingBefore ? (game.state as any)?.assistCredits?.[creditKey(String(casterId), String(pendingBefore.cardId))]?.helperId : undefined;
    const refunded = abandonAssistedCast(game, String(casterId), effectId);
    if (refunded > 0) {
      io.to(gameId).emit("assistRefunded", {
        gameId,
        amount: refunded,
        cardName: String(pendingBefore?.cardName || ''),
        helperId,
        helperName: helperId ? playerDisplayName(game.state, String(helperId)) : undefined,
      });
      broadcastGame(io, game, gameId);
    }
  });
}