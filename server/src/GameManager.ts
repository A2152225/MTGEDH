/**
 * server/src/GameManager.ts
 *
 * Robust GameManager for in-memory game instances.
 *
 * Improvements over previous version:
 * - Attempt multiple require() paths to find the project's Game implementation.
 * - If Game implementation isn't found, fall back to createInitialGameState (the existing in-memory wrapper).
 * - Always initialize game.state.phase = "PRE_GAME" on creation/reset (option B requested earlier).
 * - Keep stable shapes (seq, players, zones) so sockets and saved-event replay work.
 */

import { randomUUID } from "crypto";
import type { Server } from "socket.io";

// Try to import createInitialGameState as an explicit fallback (used by socket util)
let createInitialGameState: any = null;
try {
  // prefer the project's state factory used elsewhere
  // path relative to server/src/GameManager.ts
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  createInitialGameState = require("./state")?.createInitialGameState || require("./state/index")?.createInitialGameState;
} catch (e) {
  // not fatal; we'll attempt to proceed without it
  createInitialGameState = null;
}

/**
 * Try to locate a Game implementation by trying several common paths.
 * Returns the constructor or null if not found.
 */
function tryLoadGameImpl(): any | null {
  const candidates = [
    "./game",
    "./Game",
    "./game/index",
    "./Game/index",
    "../game",
    "../game/index",
    "../Game",
    "../Game/index",
    "./state/game",
    "./state/Game",
  ];
  for (const p of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(p);
      if (!mod) continue;
      // Prefer named exports Game, otherwise default, otherwise module itself
      if (mod.Game) return mod.Game;
      if (mod.default) return mod.default;
      return mod;
    } catch (e) {
      // ignore, try next
    }
  }
  return null;
}

let GameImpl: any = tryLoadGameImpl();

export type CreateGameOptions = {
  id?: string;
  startingState?: any;
};

class GameManagerClass {
  private games: Map<string, any> = new Map();

  listGameIds(): string[] {
    return Array.from(this.games.keys());
  }

  private initBasicShapes(game: any, opts?: CreateGameOptions) {
    try {
      game.state = game.state || {};
      // prefer uppercase canonical stored phase
      game.state.phase = (opts && opts.startingState && typeof opts.startingState.phase !== "undefined")
        ? opts.startingState.phase
        : "PRE_GAME";
      // merge incoming startingState but avoid overwriting phase unless explicitly provided
      if (opts && opts.startingState && typeof opts.startingState === "object") {
        const incoming = { ...opts.startingState };
        if (typeof incoming.phase === "undefined") delete incoming.phase;
        game.state = { ...game.state, ...incoming };
        if (typeof opts.startingState.phase === "undefined") game.state.phase = "PRE_GAME";
      }
    } catch (e) {
      console.warn("GameManager.initBasicShapes: failed to set phase", e);
      game.state = game.state || {};
      game.state.phase = "PRE_GAME";
    }

    try {
      if (typeof game.seq === "undefined") game.seq = 0;
      game.state.players = game.state.players || [];
      game.state.zones = game.state.zones || {};
      game.state.commandZone = game.state.commandZone || {};
      // ensure life object exists
      game.state.life = game.state.life || {};
    } catch (e) {
      // best-effort
    }
  }

  createGame(opts: CreateGameOptions = {}): any {
    const id = opts.id || `g_${randomUUID()}`;
    if (this.games.has(id)) {
      throw new Error(`Game ${id} already exists`);
    }

    let game: any;
    if (GameImpl) {
      try {
        game = new GameImpl();
      } catch (e) {
        console.warn("GameManager.createGame: GameImpl construction failed, falling back to createInitialGameState", e);
        game = null;
      }
    } else {
      game = null;
    }

    if (!game) {
      if (createInitialGameState) {
        try {
          game = createInitialGameState(id);
        } catch (e) {
          console.warn("GameManager.createGame: createInitialGameState failed", e);
          game = { state: {}, seq: 0 };
        }
      } else {
        // minimal fallback wrapper
        game = { state: {}, seq: 0 };
      }
    }

    // initialize canonical shapes and phase
    this.initBasicShapes(game, opts);

    this.games.set(id, game);
    return game;
  }

  getGame(gameId: string): any | undefined {
    return this.games.get(gameId);
  }

  ensureGame(gameId: string): any {
    let g = this.games.get(gameId);
    if (g) return g;

    // If GameImpl available, instantiate a Game and store under provided id if possible.
    let game: any = null;
    if (GameImpl) {
      try {
        game = new GameImpl();
      } catch (e) {
        console.warn("GameManager.ensureGame: GameImpl construction failed, falling back to createInitialGameState", e);
        game = null;
      }
    }

    if (!game) {
      if (createInitialGameState) {
        try {
          game = createInitialGameState(gameId);
        } catch (e) {
          console.warn("GameManager.ensureGame: createInitialGameState failed, creating minimal wrapper", e);
          game = { state: {}, seq: 0 };
        }
      } else {
        // final fallback
        game = { state: {}, seq: 0 };
      }
    }

    // Ensure canonical phase and shapes
    this.initBasicShapes(game);

    this.games.set(gameId, game);
    return game;
  }

  resetGame(gameId: string, preservePlayers = true): any {
    const game = this.ensureGame(gameId);
    try {
      if (typeof game.reset === "function") {
        game.reset(preservePlayers);
      } else {
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
      game.state = game.state || {};
    }

    try { game.state.phase = "PRE_GAME"; } catch (e) { /* ignore */ }
    try { if (typeof game.seq === "undefined") game.seq = 0; } catch (e) { /* ignore */ }
    return game;
  }

  deleteGame(gameId: string): boolean {
    return this.games.delete(gameId);
  }

  clearAllGames(): void {
    this.games.clear();
  }
}

export const GameManager = new GameManagerClass();
export default GameManager;