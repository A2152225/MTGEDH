// server/src/socket/becomeAuraEndEffectSocketHandlers.ts
// Socket event `endBecomeAuraEffect` { gameId, permanentId }: the effect's controller pays the recorded
// `auraEndEffectCost` ("You may pay {U} to end this effect." on Licids) as a special action (no stack).
// Legality, payment and the state change live in state/modules/becomeAuraEndEffectAction.ts; this file only
// validates the seat, persists the event for replay, announces it and rebroadcasts.
// Public entry symbols: registerBecomeAuraEndEffectHandlers, handleEndBecomeAuraEffectRequest.

import type { Server, Socket } from "socket.io";
import { appendEvent } from "../db/index.js";
import { reportHookFailure } from "../../../shared/src/hookFailureReporter.js";
import { broadcastGame, ensureGame, getPlayerName } from "./util.js";
import {
  BECOME_AURA_END_EFFECT_EVENT,
  applyBecomeAuraEndEffect,
} from "../state/modules/becomeAuraEndEffectAction.js";

const ERROR_CODES: Record<string, string> = {
  no_priority: "NO_PRIORITY",
  insufficient_mana: "INSUFFICIENT_MANA",
  not_controller: "NOT_CONTROLLER",
  no_end_effect_cost: "END_EFFECT_NOT_AVAILABLE",
};

export function handleEndBecomeAuraEffectRequest(
  io: Server,
  socket: Socket,
  payload?: { gameId?: unknown; permanentId?: unknown },
): void {
  const gameId = typeof payload?.gameId === "string" ? payload.gameId : "";
  const permanentId = typeof payload?.permanentId === "string" ? payload.permanentId.trim() : "";
  if (!gameId || !permanentId) return;
  try {
    const socketGameId = socket.data?.gameId;
    if ((socketGameId && socketGameId !== gameId) || !socket.rooms?.has?.(gameId)) {
      socket.emit("error", { code: "NOT_IN_GAME", message: "Not in game." });
      return;
    }
    const game = ensureGame(gameId);
    const playerId = typeof socket.data?.playerId === "string" ? socket.data.playerId : "";
    if (!game || !playerId) return;

    const result = applyBecomeAuraEndEffect(game, { playerId, permanentId });
    if (result.applied === false) {
      const reason = (result as { applied: false; reason: string }).reason;
      socket.emit("error", { code: ERROR_CODES[reason] || "END_EFFECT_FAILED", message: reason });
      return;
    }

    if (typeof game.bumpSeq === "function") game.bumpSeq();
    try {
      appendEvent(gameId, game.seq ?? 0, BECOME_AURA_END_EFFECT_EVENT, {
        playerId,
        permanentId,
        cost: result.cost,
        detachedFrom: result.detachedFrom,
        payment: result.payment,
      });
    } catch (err) {
      reportHookFailure("becomeAuraEndEffect.appendEvent", err, { gameId, playerId, cardId: permanentId });
    }

    const perm = (Array.isArray(game.state?.battlefield) ? game.state.battlefield : [])
      .find((entry: { id?: unknown }) => String(entry?.id ?? "") === permanentId);
    const cardName = String(perm?.card?.name ?? permanentId);
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, playerId)} paid ${result.cost} to end ${cardName}'s Aura effect.`,
      ts: Date.now(),
    });
    broadcastGame(io, game, gameId);
  } catch (err) {
    reportHookFailure("becomeAuraEndEffect.socket", err, { gameId, cardId: permanentId });
  }
}

export function registerBecomeAuraEndEffectHandlers(io: Server, socket: Socket): void {
  socket.on(BECOME_AURA_END_EFFECT_EVENT, (payload?: { gameId?: unknown; permanentId?: unknown }) =>
    handleEndBecomeAuraEffectRequest(io, socket, payload));
}
