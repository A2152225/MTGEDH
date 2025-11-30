// server/src/socket/opening-hand.ts
// Socket handlers for opening hand actions (Leylines, Chancellor effects)

import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, emitToPlayer, getPlayerName } from "./util";
import { appendEvent } from "../db";

/**
 * Check if a card has a Leyline-style opening hand ability
 * 
 * MTG rules: "If ~ is in your opening hand, you may begin the game with it on the battlefield."
 * This matches cards like Leyline of the Void, Leyline of Sanctity, etc.
 * 
 * Also matches Gemstone Caverns: "If ~ is in your opening hand and you're not playing first,
 * you may begin the game with ~ on the battlefield..."
 */
function isLeylineCard(card: any): boolean {
  const oracleText = ((card?.oracle_text) || '').toLowerCase();
  const cardName = ((card?.name) || '').toLowerCase();
  
  // Check for the specific Leyline ability text pattern
  // "If ~ is in your opening hand, you may begin the game with it on the battlefield."
  const hasLeylineAbility = (
    oracleText.includes('in your opening hand') &&
    (oracleText.includes('begin the game with') || oracleText.includes('begin the game with it on the battlefield'))
  );
  
  // Also match by card name for known Leylines (as a backup)
  const isKnownLeyline = cardName.startsWith('leyline of') || cardName === 'gemstone caverns';
  
  return hasLeylineAbility || isKnownLeyline;
}

/**
 * Find all Leyline cards in a player's hand
 */
function findLeylineCards(hand: any[]): any[] {
  return hand.filter(card => card && isLeylineCard(card));
}

export function registerOpeningHandHandlers(io: Server, socket: Socket) {
  // Play opening hand cards (Leylines) - put them on battlefield for free
  socket.on("playOpeningHandCards", ({ gameId, cardIds }: { gameId: string; cardIds: string[] }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Check if we're in PRE_GAME phase
      const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
      if (phaseStr !== "" && phaseStr !== "PRE_GAME") {
        socket.emit("error", {
          code: "NOT_PREGAME",
          message: "Can only play opening hand cards during pre-game",
        });
        return;
      }

      // Get the player's hand
      const zones = game.state?.zones?.[playerId];
      if (!zones || !Array.isArray(zones.hand)) {
        socket.emit("error", {
          code: "NO_HAND",
          message: "Hand not found",
        });
        return;
      }

      const hand = zones.hand as any[];
      // Ensure battlefield array exists on game.state
      if (!game.state.battlefield) {
        game.state.battlefield = [];
      }
      const battlefield = game.state.battlefield;
      const playedCards: string[] = [];

      for (const cardId of cardIds) {
        const cardIndex = hand.findIndex((c: any) => c?.id === cardId);
        if (cardIndex === -1) {
          console.warn(`[playOpeningHandCards] Card ${cardId} not found in hand`);
          continue;
        }

        const card = hand[cardIndex];

        // Verify it's a Leyline card
        if (!isLeylineCard(card)) {
          console.warn(`[playOpeningHandCards] Card ${card.name} is not a Leyline card`);
          continue;
        }

        // Remove from hand
        hand.splice(cardIndex, 1);

        // Add to battlefield as a permanent
        const permanent = {
          id: card.id,
          card: {
            ...card,
            zone: 'battlefield',
          },
          controller: playerId,
          owner: playerId,
          tapped: false,
          counters: {},
        };

        battlefield.push(permanent);
        playedCards.push(card.name);
      }

      // Update zone counts
      zones.handCount = hand.length;

      // Bump sequence
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      // Persist the event
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "playOpeningHandCards", {
          playerId,
          cardIds,
        });
      } catch (e) {
        console.warn("appendEvent(playOpeningHandCards) failed:", e);
      }

      if (playedCards.length > 0) {
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} begins the game with ${playedCards.join(", ")} on the battlefield.`,
          ts: Date.now(),
        });
      }

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`playOpeningHandCards error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "OPENING_HAND_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Skip opening hand actions (player doesn't want to play any Leylines)
  socket.on("skipOpeningHandActions", ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Just acknowledge and continue - no state change needed
      console.log(`[skipOpeningHandActions] Player ${playerId} skipped opening hand actions`);

      // Persist the event
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "skipOpeningHandActions", { playerId });
      } catch (e) {
        console.warn("appendEvent(skipOpeningHandActions) failed:", e);
      }

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`skipOpeningHandActions error for game ${gameId}:`, err);
    }
  });
}

/**
 * Check if a player has Leyline cards and should be prompted for opening hand actions
 * Call this after the player keeps their hand
 */
export function checkAndPromptOpeningHandActions(
  io: Server,
  game: any,
  gameId: string,
  playerId: string
): boolean {
  try {
    const zones = game.state?.zones?.[playerId];
    if (!zones || !Array.isArray(zones.hand)) {
      return false;
    }

    const hand = zones.hand;
    const leylineCards = findLeylineCards(hand);

    if (leylineCards.length > 0) {
      // Emit prompt to the player
      emitToPlayer(io, playerId, "openingHandActionsPrompt", {
        gameId,
        leylineCount: leylineCards.length,
      });
      return true;
    }

    return false;
  } catch (err) {
    console.error(`checkAndPromptOpeningHandActions error:`, err);
    return false;
  }
}
