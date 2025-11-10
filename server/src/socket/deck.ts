import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, appendGameEvent } from "./util";
import {
  saveDeck as saveDeckDB,
  listDecks,
  getDeck as getDeckDB,
  renameDeck as renameDeckDB,
  deleteDeck as deleteDeckDB,
} from "../db/decks";
import { games } from "./socket";
import { createInitialGameState, validateDeck } from "../state/gameState";

export function registerDeckHandlers(io: Server, socket: Socket) {
  // Save a deck
  socket.on("saveDeck", ({ gameId, name, list }) => {
    const playerId = socket.data.playerId;
    if (!playerId || !name || !list) {
      socket.emit("deckError", { gameId, message: "Invalid deck data." });
      return;
    }

    try {
      const deckId = `deck_${Date.now()}`;
      saveDeckDB({ id: deckId, name, text: list, created_by_id: playerId });
      socket.emit("deckSaved", { gameId, deckId });
    } catch (error) {
      socket.emit("deckError", { gameId, message: "Failed to save deck." });
    }
  });

  // List all saved decks
  socket.on("listSavedDecks", ({ gameId }) => {
    try {
      const decks = listDecks();
      socket.emit("savedDecksList", { gameId, decks });
    } catch {
      socket.emit("deckError", { gameId, message: "Could not retrieve decks." });
    }
  });

  // Fetch details of a single deck
  socket.on("getSavedDeck", ({ gameId, deckId }) => {
    try {
      const deck = getDeckDB(deckId);
      if (!deck) {
        socket.emit("deckError", { gameId, message: "Deck not found." });
        return;
      }

      socket.emit("savedDeckDetail", { gameId, deck });
    } catch {
      socket.emit("deckError", { gameId, message: "Could not fetch deck details." });
    }
  });

  // Use a saved deck in the game
  socket.on("useSavedDeck", async ({ gameId, deckId }) => {
    const playerId = socket.data.playerId;
    const game = ensureGame(gameId);

    try {
      const deck = getDeckDB(deckId);
      if (!deck) {
        socket.emit("deckError", { gameId, message: "Deck not found." });
        return;
      }

      game.importDeck(playerId, deck.text);
      appendGameEvent(game, gameId, "deckImport", { playerId, deckId });
      broadcastGame(io, game, gameId);
    } catch {
      socket.emit("deckError", { gameId, message: "Failed to use saved deck." });
    }
  });

  // Rename a saved deck
  socket.on("renameDeck", ({ deckId, name }) => {
    try {
      const updated = renameDeckDB(deckId, name);
      if (!updated) {
        socket.emit("deckError", { message: "Could not rename deck." });
        return;
      }

      socket.emit("deckRenamed", { deck: updated });
    } catch {
      socket.emit("deckError", { message: "Renaming failed." });
    }
  });

  // Delete a deck
  socket.on("deleteDeck", ({ deckId }) => {
    try {
      const deleted = deleteDeckDB(deckId);
      if (!deleted) {
        socket.emit("deckError", { message: "Deck deletion failed." });
        return;
      }

      socket.emit("deckDeleted", { deckId });
    } catch {
      socket.emit("deckError", { message: "Failed to delete deck." });
    }
  });
}