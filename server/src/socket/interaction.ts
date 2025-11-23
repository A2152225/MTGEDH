import type { Server, Socket } from "socket.io";
import { ensureGame, appendGameEvent, broadcastGame } from "./util";
import { appendEvent } from "../db";
import { games } from "./socket";
import { uid } from "../state/utils";

export function registerInteractionHandlers(io: Server, socket: Socket) {
  // Scry: Peek and reorder library cards
  socket.on("beginScry", ({ gameId, count }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const numCards = Math.max(1, Math.min(10, count));
    const cards = game.peekTopN(pid, numCards);

    socket.emit("scryPeek", { gameId, cards });
  });

  socket.on("confirmScry", ({ gameId, keepTopOrder, bottomOrder }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const peekedCards = game.peekTopN(pid, (keepTopOrder?.length || 0) + (bottomOrder?.length || 0));
    const allSelected = [...(keepTopOrder || []), ...(bottomOrder || [])].map(c => c.id);

    // Validate consistency between client and game state
    if (
      peekedCards.length !== allSelected.length ||
      !peekedCards.every(card => allSelected.includes(card.id))
    ) {
      socket.emit("error", {
        code: "SCRY",
        message: "Scry selection does not match current library state.",
      });
      return;
    }

    game.applyEvent({
      type: "scryResolve",
      playerId: pid,
      keepTopOrder: keepTopOrder || [],
      bottomOrder: bottomOrder || [],
    });
    appendEvent(gameId, game.seq, "scryResolve", { playerId: pid, keepTopOrder, bottomOrder });

    broadcastGame(io, game, gameId);
  });

  // Surveil: Peek, send cards to graveyard, or reorder
  socket.on("beginSurveil", ({ gameId, count }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const numCards = Math.max(1, Math.min(10, count));
    const cards = game.peekTopN(pid, numCards);

    socket.emit("surveilPeek", { gameId, cards });
  });

  socket.on("confirmSurveil", ({ gameId, toGraveyard, keepTopOrder }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const peekedCards = game.peekTopN(pid, (toGraveyard?.length || 0) + (keepTopOrder?.length || 0));
    const allSelected = [...(toGraveyard || []), ...(keepTopOrder || [])].map(c => c.id);

    // Validate consistency between client and game state
    if (
      peekedCards.length !== allSelected.length ||
      !peekedCards.every(card => allSelected.includes(card.id))
    ) {
      socket.emit("error", {
        code: "SURVEIL",
        message: "Surveil selection does not match current library state.",
      });
      return;
    }

    game.applyEvent({
      type: "surveilResolve",
      playerId: pid,
      toGraveyard: toGraveyard || [],
      keepTopOrder: keepTopOrder || [],
    });
    appendEvent(gameId, game.seq, "surveilResolve", { playerId: pid, toGraveyard, keepTopOrder });

    broadcastGame(io, game, gameId);
  });

  // Library search: Query and select cards
  socket.on("searchLibrary", ({ gameId, query, limit }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const results = game.searchLibrary(pid, query || "", Math.max(1, Math.min(100, limit || 20)));

    socket.emit("searchResults", { gameId, cards: results, total: results.length });
  });

  socket.on("selectFromSearch", ({ gameId, cardIds, moveTo, reveal }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) return;

    const game = ensureGame(gameId);
    const movedCards = game.selectFromLibrary(pid, cardIds || [], moveTo);

    appendEvent(gameId, game.seq, "selectFromLibrary", {
      playerId: pid,
      cardIds: cardIds || [],
      moveTo,
      reveal,
    });

    if (movedCards.length) {
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `Player ${pid} moved ${movedCards.join(", ")} to ${moveTo}`,
        ts: Date.now(),
      });
    }

    broadcastGame(io, game, gameId);
  });

  // Play land from hand to battlefield
  socket.on("playLand", ({ gameId, cardId }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) {
      socket.emit("error", {
        code: "PLAY_LAND",
        message: "Only active players can play lands.",
      });
      return;
    }

    try {
      const game = ensureGame(gameId);
      
      // Find the card in player's hand
      const view = game.viewFor(pid, false);
      const hand = view.zones?.[pid]?.hand || [];
      const card = hand.find((c: any) => c.id === cardId);
      
      if (!card) {
        socket.emit("error", {
          code: "PLAY_LAND",
          message: "Card not found in your hand.",
        });
        return;
      }

      // Remove card from authoritative hand state
      const authHand = game.state.zones[pid]?.hand || [];
      const handIdx = authHand.findIndex((c: any) => c.id === cardId);
      if (handIdx !== -1) {
        authHand.splice(handIdx, 1);
        game.state.zones[pid].handCount = authHand.length;
      }

      // Use the game's playLand method to move card to battlefield
      game.playLand(pid, card);
      
      // Append event for replay (with full card data for event log)
      appendEvent(gameId, game.seq, "playLand", { playerId: pid, card });

      broadcastGame(io, game, gameId);
    } catch (err) {
      console.error("playLand handler error:", err);
      socket.emit("error", {
        code: "PLAY_LAND",
        message: err instanceof Error ? err.message : "Failed to play land.",
      });
    }
  });

  // Cast spell from hand to stack
  socket.on("castSpellFromHand", ({ gameId, cardId }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) {
      socket.emit("error", {
        code: "CAST_SPELL",
        message: "Only active players can cast spells.",
      });
      return;
    }

    try {
      const game = ensureGame(gameId);
      
      // Find the card in player's hand
      const view = game.viewFor(pid, false);
      const hand = view.zones?.[pid]?.hand || [];
      const card = hand.find((c: any) => c.id === cardId);
      
      if (!card) {
        socket.emit("error", {
          code: "CAST_SPELL",
          message: "Card not found in your hand.",
        });
        return;
      }

      // Remove card from authoritative hand state
      const authHand = game.state.zones[pid]?.hand || [];
      const handIdx = authHand.findIndex((c: any) => c.id === cardId);
      if (handIdx !== -1) {
        authHand.splice(handIdx, 1);
        game.state.zones[pid].handCount = authHand.length;
      }

      // Construct stack item
      const stackItem = {
        id: uid("stack"),
        type: "spell" as const,
        controller: pid,
        card,
      };

      // Use the game's pushStack method
      game.pushStack(stackItem);
      
      // Append event for replay (with full stack item data)
      appendEvent(gameId, game.seq, "pushStack", { item: stackItem });

      broadcastGame(io, game, gameId);
    } catch (err) {
      console.error("castSpellFromHand handler error:", err);
      socket.emit("error", {
        code: "CAST_SPELL",
        message: err instanceof Error ? err.message : "Failed to cast spell.",
      });
    }
  });

  // Resolve top of stack (for now as a simple control to exercise the stack)
  socket.on("resolveTopOfStack", ({ gameId }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) {
      socket.emit("error", {
        code: "RESOLVE_STACK",
        message: "Only active players can resolve stack.",
      });
      return;
    }

    try {
      const game = ensureGame(gameId);
      
      // Use the game's resolveTopOfStack method
      game.resolveTopOfStack();
      
      // Append event for replay
      appendEvent(gameId, game.seq, "resolveTopOfStack", {});

      broadcastGame(io, game, gameId);
    } catch (err) {
      console.error("resolveTopOfStack handler error:", err);
      socket.emit("error", {
        code: "RESOLVE_STACK",
        message: err instanceof Error ? err.message : "Failed to resolve stack.",
      });
    }
  });
}