/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: the registerGameActions socket handlers for foretellCard,
 * castForetold, and phaseOutPermanents.
 *
 * These were arrow bodies inside registerGameActions. They take io/socket and
 * the room guard explicitly; registerGameActions now just registers them.
 * castForetold also takes handleCastSpellFromHand because that nested helper
 * still lives in registerGameActions.
 *
 * Public entry symbols: handleForetellCardRequest, handleCastForetoldRequest,
 * handlePhaseOutPermanentsRequest.
 */
import type { Server, Socket } from "socket.io";
import { appendEvent } from "../../db";
import { cleanupCardLeavingExile } from "../../state/modules/playable-from-exile.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { broadcastGame, ensureGame, getPlayerName, payGenericManaWithAvailableSources } from "../util";
import type { EnsureInGameRoom } from "./gameActionsSocketRoomGuard.js";

// ==========================================================================
// FORETELL SUPPORT
// ==========================================================================

/**
 * Handle foretelling a card from hand (exile face-down for {2})
 * Foretell: Exile this card from your hand face-down for {2}. 
 * You may cast it later for its foretell cost.
 */
export async function handleForetellCardRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: { gameId?: unknown; cardId?: unknown },
): Promise<void> {
  const gameId = payload?.gameId;
  const cardId = payload?.cardId;

  if (!gameId || typeof gameId !== 'string') return;
  if (!cardId || typeof cardId !== 'string') return;

  try {
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return;

    if (!ensureInGameRoom(gameId)) return;

    const zones = game.state.zones?.[playerId];
    if (!zones || !Array.isArray(zones.hand)) {
      socket.emit("error", { code: "NO_HAND", message: "Hand not found" });
      return;
    }

    // Find the card in hand
    const cardIndex = (zones.hand as any[]).findIndex((c: any) => c?.id === cardId);
    if (cardIndex === -1) {
      socket.emit("error", { code: "CARD_NOT_FOUND", message: "Card not found in hand" });
      return;
    }

    const card = zones.hand[cardIndex] as any;
    const oracleText = String(card.oracle_text || card.oracleText || '');
    const keywords = card.keywords;
    const hasForetellKeyword = Array.isArray(keywords)
      ? keywords.some((entry: unknown) => String(entry || '').toLowerCase() === 'foretell')
      : /\bforetell\b/i.test(String(keywords || ''));
    if (!/\bforetell\b/i.test(oracleText) && !hasForetellKeyword) {
      socket.emit("error", { code: "NO_FORETELL", message: "This card doesn't have foretell" });
      return;
    }

    const turnPlayer = String((game.state as any)?.turnPlayer || '').trim();
    if (turnPlayer && turnPlayer !== String(playerId)) {
      socket.emit("error", { code: "NOT_YOUR_TURN", message: "You can only foretell during your turn." });
      return;
    }
    const priority = (game.state as any)?.priority;
    if (priority && String(priority) !== String(playerId)) {
      socket.emit("error", { code: "NO_PRIORITY", message: "You need priority to foretell." });
      return;
    }

    const payment = payGenericManaWithAvailableSources(game.state, playerId, 2);
    if (!payment.ok) {
      socket.emit("error", { code: "CANNOT_PAY_FORETELL", message: payment.error || "Pay {2} to foretell." });
      return;
    }

    // Parse the later-turn cast cost (not the {2} exile cost)
    const foretellCostMatch = oracleText.match(/\bforetell\b\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    const foretellCost = foretellCostMatch ? foretellCostMatch[1] : '{2}';

    // Remove from hand
    (zones.hand as any[]).splice(cardIndex, 1);
    zones.handCount = (zones.hand as any[]).length;

    // Add to exile face-down with foretell marker
    zones.exile = zones.exile || [];
    const foretoldCard = {
      ...card,
      zone: 'exile',
      foretold: true,
      foretellCost: foretellCost,
      foretoldBy: playerId,
      foretoldAt: Date.now(),
      faceDown: true,
    };
    (zones.exile as any[]).push(foretoldCard);
    (zones as any).exileCount = (zones.exile as any[]).length;

    debug(1, `[foretellCard] ${playerId} foretold ${card.name} (foretell cost: ${foretellCost})`);

    // Persist event for replay
    try {
      appendEvent(gameId, (game as any).seq ?? 0, "foretellCard", {
        playerId,
        cardId,
        cardName: card.name,
        foretellCost,
        card: foretoldCard, // Include full card data for reliable replay
      });
    } catch (e) {
      debugWarn(1, 'appendEvent(foretellCard) failed:', e);
    }

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `=��� ${getPlayerName(game, playerId)} foretells a card.`,
      ts: Date.now(),
    });

    broadcastGame(io, game, gameId);
  } catch (err: any) {
    debugError(1, `foretellCard error for game ${gameId}:`, err);
    socket.emit("error", { code: "FORETELL_ERROR", message: err?.message ?? String(err) });
  }
}

/**
 * Handle casting a foretold card from exile
 */
export async function handleCastForetoldRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  handleCastSpellFromHand: (payload?: any) => Promise<any>,
  payload?: { gameId?: unknown; cardId?: unknown },
): Promise<void> {
  const gameId = payload?.gameId;
  const cardId = payload?.cardId;

  if (!gameId || typeof gameId !== 'string') return;
  if (!cardId || typeof cardId !== 'string') return;

  try {
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return;

    if (!ensureInGameRoom(gameId)) return;

    const zones = game.state.zones?.[playerId];
    if (!zones || !Array.isArray(zones.exile)) {
      socket.emit("error", { code: "NO_EXILE", message: "Exile zone not found" });
      return;
    }

    // Find the foretold card in exile
    const cardIndex = (zones.exile as any[]).findIndex((c: any) => c?.id === cardId && c?.foretold);
    if (cardIndex === -1) {
      socket.emit("error", { code: "CARD_NOT_FOUND", message: "Foretold card not found in exile" });
      return;
    }

    const card = zones.exile[cardIndex] as any;

    if (card.foretoldBy && String(card.foretoldBy) !== String(playerId)) {
      socket.emit("error", { code: "NOT_YOUR_FORETOLD_CARD", message: "You can only cast cards you foretold." });
      return;
    }

    // Move the card into hand temporarily and reuse the normal cast pipeline.
    // This avoids a bespoke client prompt and ensures targeting/payment flows stay consistent.
    const originalCard = { ...card };
    (zones.exile as any[]).splice(cardIndex, 1);
    (zones as any).exileCount = (zones.exile as any[]).length;

    // Defensive: if any impulse-style playable-from-exile permissions/tags exist on this card,
    // strip them as it leaves true exile so they can't leak into hand/cast representations.
    cleanupCardLeavingExile(game.state as any, card);

    zones.hand = Array.isArray((zones as any).hand) ? (zones as any).hand : [];

    const foretellCost = String(card.foretellCost || '{2}');
    const handCard = {
      ...card,
      zone: 'hand',
      faceDown: false,
      mana_cost: foretellCost,
      castFromForetell: true,
      originalManaCost: card.mana_cost,
    };
    (zones.hand as any[]).push(handCard);
    zones.handCount = (zones.hand as any[]).length;

    (game.state as any).pendingForetellCasts = (game.state as any).pendingForetellCasts || {};
    (game.state as any).pendingForetellCasts[cardId] = {
      playerId,
      originalCard,
      foretellCost,
      movedAt: Date.now(),
    };

    debug(2, `[castForetold] ${playerId} starting cast for foretold ${card.name} (cost ${foretellCost})`);

    // Start the normal spell cast flow (will request targets via Resolution Queue, then payment).
    await handleCastSpellFromHand({ gameId, cardId });

    broadcastGame(io, game, gameId);
  } catch (err: any) {
    debugError(1, `castForetold error for game ${gameId}:`, err);
    socket.emit("error", { code: "CAST_FORETOLD_ERROR", message: err?.message ?? String(err) });
  }
}

// ==========================================================================
// PHASE OUT SUPPORT
// ==========================================================================

/**
 * Handle phase out effect (Clever Concealment, Teferi's Protection, etc.)
 */
export async function handlePhaseOutPermanentsRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: { gameId?: unknown; permanentIds?: unknown },
): Promise<void> {
  const gameId = payload?.gameId;
  const permanentIds = payload?.permanentIds;

  if (!gameId || typeof gameId !== 'string') return;
  if (!Array.isArray(permanentIds) || !permanentIds.every((id) => typeof id === 'string')) return;

  try {
    if (!ensureInGameRoom(gameId, { code: 'NOT_IN_GAME', message: 'Not in game.' })) return;

    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return;

    const battlefield = game.state?.battlefield || [];
    const phasedOut: string[] = [];

    for (const permId of permanentIds) {
      const permanent = battlefield.find((p: any) => p?.id === permId);
      if (permanent && permanent.controller === playerId && !permanent.phasedOut) {
        permanent.phasedOut = true;
        permanent.phaseOutController = playerId;
        phasedOut.push(permanent.card?.name || permId);
      }
    }

    if (phasedOut.length > 0) {
      debug(1, `[phaseOutPermanents] ${playerId} phased out: ${phasedOut.join(', ')}`);

      // Persist event for replay
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "phaseOutPermanents", {
          playerId,
          permanentIds,
          phasedOutNames: phasedOut,
        });
      } catch (e) {
        debugWarn(1, 'appendEvent(phaseOutPermanents) failed:', e);
      }

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `G�� ${getPlayerName(game, playerId)}'s permanents phase out: ${phasedOut.join(', ')}`,
        ts: Date.now(),
      });

      broadcastGame(io, game, gameId);
    }
  } catch (err: any) {
    debugError(1, `phaseOutPermanents error for game ${gameId}:`, err);
    socket.emit("error", { code: "PHASE_OUT_ERROR", message: err?.message ?? String(err) });
  }
}

