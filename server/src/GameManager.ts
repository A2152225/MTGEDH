/**
 * server/src/GameManager.ts
 *
 * Lightweight singleton manager for Game instances.
 *
 * Purpose of this replacement:
 * - Ensure new games start in phase = "PRE_GAME".
 * - Ensure resets (via resetGame) also set phase = "PRE_GAME" when requested.
 * - Provide small helper API (create/get/ensure/reset/delete/list) used by server socket code.
 *
 * Notes / assumptions:
 * - There's an application Game class exported from ./game (or ./Game) that the rest of the server uses.
 *   If your code uses a different path/name, update the import below.
 * - This module intentionally performs minimal side-effects: it does not broadcast state.
 *   Existing code that calls broadcastGame(io, game, gameId) continues to be responsible for broadcasting.
 * - resetGame supports preservePlayers boolean (keeps parity with earlier calls in socket handlers).
 *
 * Behavior:
 * - createGame(opts?) returns the newly created Game and sets game.state.phase = "PRE_GAME".
 * - ensureGame(gameId) returns existing game or creates a fresh one.
 * - resetGame(gameId, preservePlayers) calls game.reset(preservePlayers) if available, then forces phase = "PRE_GAME".
 *
 * If you want me to also update every place that constructs Game instances (factory functions elsewhere),
 * I can patch those too — for now this central manager ensures new games started via this manager are PRE_GAME.
 */

import type { Game as GameType } from "./game"; // adjust path/name if your game export differs
import { randomUUID } from "crypto";

// Try to import Game class. If your repository exports Game under a different path/name,
// update the import above to match. We only reference methods used by sockets (reset, seq, etc.).
let GameImpl: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
  GameImpl = require("./game")?.Game || require("./game")?.default || require("./game");
} catch (err) {
  // Defer error: createGame will throw if GameImpl is not present.
  GameImpl = null;
}

export type CreateGameOptions = {
  id?: string;
  startingState?: any; // optional initial state applied after construction
};

/**
 * GameManager singleton
 */
class GameManagerClass {
  private games: Map<string, any> = new Map();

  // Return list of game ids
  listGameIds(): string[] {
    return Array.from(this.games.keys());
  }

  // Create a new game instance and store it under gameId. If id is not provided, a UUID will be generated.
  createGame(opts: CreateGameOptions = {}): any {
    const id = opts.id || `g_${randomUUID()}`;
    if (this.games.has(id)) {
      throw new Error(`Game ${id} already exists`);
    }
    if (!GameImpl) {
      throw new Error("Game implementation not found. Update import path in server/src/GameManager.ts");
    }
    // Construct game. Many Game constructors accept options; we pass none to be conservative.
    const game: any = new GameImpl();

    // Ensure basic state shape and set PRE_GAME phase
    try {
      game.state = game.state || {};
      game.state.phase = "PRE_GAME";
      if (opts.startingState && typeof opts.startingState === "object") {
        // merge in but do not overwrite phase unless explicitly provided in startingState
        const incoming = { ...opts.startingState };
        if (typeof incoming.phase === "undefined") delete incoming.phase;
        game.state = { ...game.state, ...incoming };
        // ensure phase remains PRE_GAME unless startingState explicitly set it
        if (typeof opts.startingState.phase === "undefined") game.state.phase = "PRE_GAME";
      }
    } catch (e) {
      // best-effort
      console.warn("GameManager.createGame: failed to initialize state.phase", e);
      game.state = game.state || {};
      game.state.phase = "PRE_GAME";
    }

    // Stabilize common helpers expected by server code
    try {
      // ensure basic seq property exists for appendEvent semantics
      if (typeof game.seq === "undefined") game.seq = 0;
      // optional life/players shapes to avoid UI errors
      game.state.players = game.state.players || [];
      game.state.zones = game.state.zones || {};
    } catch (e) {
      /* noop */
    }

    this.games.set(id, game);
    return game;
  }

  // Get a game by id, or undefined if not present
  getGame(gameId: string): any | undefined {
    return this.games.get(gameId);
  }

  // Ensure a game exists (create if missing) and return it.
  ensureGame(gameId: string): any {
    let g = this.games.get(gameId);
    if (g) return g;
    // Try to create a new Game and store it under the provided id
    if (!GameImpl) {
      throw new Error("Game implementation not found. Update import path in server/src/GameManager.ts");
    }
    // instantiate and attach
    const game: any = new GameImpl();
    try {
      game.state = game.state || {};
      game.state.phase = "PRE_GAME";
      if (typeof game.seq === "undefined") game.seq = 0;
      game.state.players = game.state.players || [];
      game.state.zones = game.state.zones || {};
    } catch (e) {
      console.warn("GameManager.ensureGame: failed to init game.state", e);
      game.state = game.state || {};
      game.state.phase = "PRE_GAME";
    }
    this.games.set(gameId, game);
    return game;
  }

  // Reset a game: call underlying reset(preservePlayers) if available, then set phase = PRE_GAME.
  resetGame(gameId: string, preservePlayers = true): any {
    const game = this.ensureGame(gameId);
    try {
      if (typeof game.reset === "function") {
        game.reset(preservePlayers);
      } else {
        // best-effort: reset core shapes
        game.state = game.state || {};
        if (preservePlayers && Array.isArray(game.state.players)) {
          const players = game.state.players;
          game.state = { players, zones: {}, commandZone: {}, phase: "PRE_GAME" };
        } else {
          game.state = { players: [], zones: {}, commandZone: {}, phase: "PRE_GAME" };
        }
      }
    } catch (e) {
      console.warn("GameManager.resetGame: underlying reset failed", e);
      // best-effort continue to set phase
      game.state = game.state || {};
    }

    // Ensure authoritative phase is PRE_GAME after reset
    try {
      game.state = game.state || {};
      game.state.phase = "PRE_GAME";
    } catch (e) {
      console.warn("GameManager.resetGame: failed to set PRE_GAME phase", e);
    }

    // Ensure seq property preserved/inited
    try {
      if (typeof game.seq === "undefined") game.seq = 0;
    } catch (e) {
      // ignore
    }

    return game;
  }

  // Remove a game instance
  deleteGame(gameId: string): boolean {
    return this.games.delete(gameId);
  }

  // For debugging: clear all games
  clearAllGames(): void {
    this.games.clear();
  }
}

export const GameManager = new GameManagerClass();
export default GameManager;