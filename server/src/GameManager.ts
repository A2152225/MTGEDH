/**
 * server/src/GameManager.ts
 *
 * Robust GameManager:
 * - Prefer the project's Game implementation if present (tries multiple candidate paths).
 * - Prefer createInitialGameState(...) factory if present as a high-fidelity fallback.
 * - Otherwise provide a MinimalGameAdapter that implements the common APIs used by sockets
 *   (hasRngSeed, seedRng, join, viewFor, participants, reset, shuffleLibrary, drawCards, etc.)
 *
 * This ensures server socket handlers (join/import/etc.) won't throw when GameImpl is missing.
 */

import { randomUUID } from "crypto";
import type { Server } from "socket.io";

// Try to load createInitialGameState (preferred fallback)
let createInitialGameState: any = null;
try {
  // try likely locations
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const m = require("./state") || require("./state/index");
  createInitialGameState = m?.createInitialGameState || null;
} catch (e) {
  createInitialGameState = null;
}

/** Try to load the project's Game implementation from multiple candidate paths. */
function tryLoadGameImpl(): any | null {
  const candidates = [
    "./game",
    "./Game",
    "./game/index",
    "./Game/index",
    "./state/game",
    "../game",
    "../Game",
  ];
  for (const p of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(p);
      if (!mod) continue;
      if (mod.Game) return mod.Game;
      if (mod.default) return mod.default;
      return mod;
    } catch (e) {
      // ignore and continue
    }
  }
  return null;
}

let GameImpl: any = tryLoadGameImpl();

/* Simple mulberry32 RNG used by many state modules when seedRng not implemented */
function mulberry32(seed: number) {
  return function () {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Minimal adapter providing the common game API expected by sockets */
class MinimalGameAdapter {
  id: string;
  state: any;
  seq: number;
  _rngSeed?: number;
  _rng?: () => number;

  constructor(id?: string) {
    this.id = id || `g_${randomUUID()}`;
    this.state = {
      players: [],
      zones: {},
      commandZone: {},
      phase: "PRE_GAME",
      format: "commander",
      startingLife: 40,
      priority: null,
      stack: [],
    };
    this.seq = 0;
    this._rngSeed = null;
    this._rng = null;
  }

  // RNG API
  hasRngSeed() {
    return !!this._rngSeed || !!this.state?.rngSeed;
  }
  seedRng(seed: number) {
    this._rngSeed = seed >>> 0;
    this._rng = mulberry32(this._rngSeed);
    try { this.state.rngSeed = this._rngSeed; } catch {}
    this.bumpSeq();
  }
  rng() {
    if (this._rng) return this._rng();
    return Math.random();
  }

  // Minimal seq bump helper (used by some modules)
  bumpSeq() {
    try { this.seq = (typeof this.seq === "number" ? this.seq + 1 : 1); } catch {}
  }

  // Join API - conservative fallback
  join(socketId: string, playerName: string, spectator = false, _opts?: any, seatToken?: string, fixedPlayerId?: string) {
    const pid = fixedPlayerId || `p_${Math.random().toString(36).slice(2, 9)}`;
    this.state.players = this.state.players || [];
    const exists = this.state.players.find((p: any) => p.id === pid);
    if (!exists) {
      this.state.players.push({ id: pid, name: playerName, spectator: Boolean(spectator) });
      // no seat management in adapter
      this.bumpSeq();
      return { playerId: pid, added: true, seatToken };
    }
    return { playerId: pid, added: false, seatToken };
  }

  // View for player - conservative: return full state (server will filter)
  viewFor(_playerId: string, _spectator?: boolean) {
    return this.state;
  }

  // Participants list fallback (used to find socket ids); returns simple mapping without socketId
  participants() {
    return (this.state.players || []).map((p: any) => ({ playerId: p.id, socketId: undefined, spectator: !!p.spectator }));
  }

  // Reset
  reset(preservePlayers = true) {
    if (preservePlayers) {
      const players = Array.isArray(this.state.players) ? this.state.players.slice() : [];
      this.state = { players, zones: {}, commandZone: {}, phase: "PRE_GAME", format: this.state.format || "commander", startingLife: this.state.startingLife || 40 };
    } else {
      this.state = { players: [], zones: {}, commandZone: {}, phase: "PRE_GAME", format: this.state.format || "commander", startingLife: this.state.startingLife || 40 };
    }
    this.bumpSeq();
  }

  // Shallow hook for deck import resolution (no-op)
  importDeckResolved(playerId: string, cards: any[]) {
    // Place cards into the initiator's library array (authoritative for UI)
    this.state.zones = this.state.zones || {};
    this.state.zones[playerId] = this.state.zones[playerId] || { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [] };
    this.state.zones[playerId].library = cards.map((c: any) => ({ ...c, zone: "library" }));
    this.state.zones[playerId].libraryCount = (this.state.zones[playerId].library || []).length;
    this.bumpSeq();
  }

  // Shuffle / draw simple implementations for fallback flows
  shuffleLibrary(playerId: string) {
    try {
      const z = (this.state.zones || {})[playerId];
      if (!z || !Array.isArray(z.library)) return;
      // Fisher-Yates
      for (let i = z.library.length - 1; i > 0; i--) {
        const j = Math.floor((this.rng()) * (i + 1));
        [z.library[i], z.library[j]] = [z.library[j], z.library[i]];
      }
      this.bumpSeq();
    } catch (e) { /* ignore */ }
  }
  drawCards(playerId: string, count: number) {
    try {
      const z = (this.state.zones || {})[playerId];
      if (!z) return;
      z.hand = z.hand || [];
      while (count-- > 0 && z.library && z.library.length > 0) {
        const c = z.library.shift();
        z.hand.push(c);
      }
      z.handCount = z.hand.length;
      z.libraryCount = z.library ? z.library.length : 0;
      this.bumpSeq();
    } catch (e) { /* ignore */ }
  }

  // Minimal helper for tests / debug
  toJSON() { return { id: this.id, state: this.state, seq: this.seq }; }
}

/* GameManager implementation */
export type CreateGameOptions = { id?: string; startingState?: any };

class GameManagerClass {
  private games: Map<string, any> = new Map();

  listGameIds(): string[] {
    return Array.from(this.games.keys());
  }

  private initBasicShapes(game: any, opts?: CreateGameOptions) {
    try {
      game.state = game.state || {};
      game.state.phase = (opts && opts.startingState && typeof opts.startingState.phase !== "undefined")
        ? opts.startingState.phase
        : "PRE_GAME";
      if (opts && opts.startingState && typeof opts.startingState === "object") {
        const incoming = { ...opts.startingState };
        if (typeof incoming.phase === "undefined") delete incoming.phase;
        game.state = { ...game.state, ...incoming };
        if (typeof opts.startingState.phase === "undefined") game.state.phase = "PRE_GAME";
      }
    } catch (e) {
      game.state = game.state || {};
      game.state.phase = "PRE_GAME";
    }

    try {
      if (typeof game.seq === "undefined") game.seq = 0;
      game.state.players = game.state.players || [];
      game.state.zones = game.state.zones || {};
      game.state.commandZone = game.state.commandZone || {};
    } catch (e) { /* ignore */ }
  }

  createGame(opts: CreateGameOptions = {}): any {
    const id = opts.id || `g_${randomUUID()}`;
    if (this.games.has(id)) throw new Error(`Game ${id} already exists`);

    let game: any = null;

    // Prefer real Game impl
    if (GameImpl) {
      try { game = new GameImpl(); } catch (e) { game = null; }
    }

    // Next prefer createInitialGameState factory
    if (!game && createInitialGameState) {
      try { game = createInitialGameState(id); } catch (e) { game = null; }
    }

    // Final fallback: minimal adapter
    if (!game) game = new MinimalGameAdapter(id);

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

    let game: any = null;
    if (GameImpl) {
      try { game = new GameImpl(); } catch (e) { game = null; }
    }
    if (!game && createInitialGameState) {
      try { game = createInitialGameState(gameId); } catch (e) { game = null; }
    }
    if (!game) {
      // create a minimal adapter that implements the common API
      game = new MinimalGameAdapter(gameId);
    }

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