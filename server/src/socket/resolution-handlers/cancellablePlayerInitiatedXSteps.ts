/**
 * socket/resolution-handlers/cancellablePlayerInitiatedXSteps.ts
 *
 * Player-started required X prompts that may be backed out of before anything is committed:
 * cast-time "Choose X" (spellCastXSelection), Replicate count (spellCastReplicateSelection) and
 * planeswalker +X/-X before loyalty is paid (planeswalkerLoyaltyX). Cancelling drops the pending
 * cast/activation: no card moves, no mana or loyalty is spent.
 *
 * Public entry symbols: isCancellablePlayerInitiatedXStep, applyCancelledPlayerInitiatedXStep.
 * Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { ResolutionStepType, type ResolutionStep } from "../../state/resolution/index.js";
import { getPlayerName } from "../util.js";

export function isCancellablePlayerInitiatedXStep(step: ResolutionStep | null | undefined): boolean {
  const s = step as any;
  if (!s || s.type !== ResolutionStepType.X_VALUE_SELECTION) return false;
  return s.spellCastXSelection === true
    || s.spellCastReplicateSelection === true
    || s.planeswalkerLoyaltyX === true;
}

export function applyCancelledPlayerInitiatedXStep(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  playerId: string,
): void {
  if (!isCancellablePlayerInitiatedXStep(step)) return;
  const s = step as any;

  // Spell casts: nothing has been paid or moved yet; drop any stale pending-cast bookkeeping
  // for this card so the card simply stays in its cast source zone.
  const cardId = String(s.spellCardId || '').trim();
  const pending = (game?.state as any)?.pendingSpellCasts;
  if (cardId && pending && typeof pending === 'object') {
    for (const [effectId, entry] of Object.entries(pending)) {
      const e = entry as any;
      if (String(e?.cardId || '') !== cardId) continue;
      if (e?.playerId && String(e.playerId) !== String(playerId)) continue;
      delete pending[effectId];
    }
  }

  const what = s.planeswalkerLoyaltyX === true
    ? 'loyalty ability'
    : s.spellCastReplicateSelection === true ? 'cast (replicate)' : 'cast (choose X)';
  const cardName = String(s.sourceName || 'spell');
  try {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)} cancelled ${cardName} ${what}.`,
      ts: Date.now(),
    });
  } catch {
    // chat is best-effort
  }
}
