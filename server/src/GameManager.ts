/**
 * server/src/GameManager.ts
 *
 * Robust GameManager:
 * - Prefer the project's Game implementation if present (tries multiple candidate paths).
 * - Prefer createInitialGameState(...) factory if present as a high-fidelity fallback.
 * - Otherwise provide a MinimalGameAdapter that implements the common APIs used by sockets
 *   (hasRngSeed, seedRng, join, viewFor, participants, reset, shuffleLibrary, drawCards, etc.)
 *
 * Also: schedule background persistence of a minimal games row when creating/ensuring a game so
 * appendEvent (which relies on a FK to games.game_id) will not fail even if DB init timing races.
 */

import { randomUUID } from "crypto";
import { createInitialGameState } from "./state/index.js";
import { createGameIfNotExists, getEvents } from "./db"; // NEW: import getEvents for replay
import { createRulesBridge, type RulesBridge } from "./rules-bridge.js";

type PersistOptions = { gameId: string; format?: string; startingLife?: number };

function schedulePersistGamesRow(opts: PersistOptions) {
  // Non-blocking background attempt to persist a games row. Retries a few times if DB isn't ready yet.
  const maxAttempts = 8;
  const intervalMs = 200;

  let attempts = 0;
  const tryPersist = async () => {
    attempts++;
    try {
      // dynamic import so we don't cause circular imports / module instance duplication
      const dbmod = await import("./db");
      // Prefer exported createGameIfNotExists if present
      if (dbmod && typeof (dbmod as any).createGameIfNotExists === "function") {
        try {
          (dbmod as any).createGameIfNotExists(
            opts.gameId,
            opts.format ?? "commander",
            opts.startingLife ?? 40
          );
          return; // success
        } catch (e: any) {
          // If DB not initialized, createGameIfNotExists will throw; we'll retry below.
          if (
            e &&
            String(e.message || "").includes("DB not initialized") &&
            attempts < maxAttempts
          ) {
            setTimeout(tryPersist, intervalMs);
            return;
          }
          // Otherwise try fallback below.
        }
      }

      // If dbmod exports a db handle (better-sqlite3 style), attempt insert-or-ignore
      const possibleDb =
        (dbmod as any)?.db ||
        (dbmod as any)?.default?.db ||
        (dbmod as any)?.default ||
        dbmod;
      if (possibleDb && typeof possibleDb.prepare === "function") {
        try {
          possibleDb
            .prepare(
              "INSERT OR IGNORE INTO games (game_id, format, starting_life, created_at) VALUES (?, ?, ?, ?)"
            )
            .run(
              opts.gameId,
              opts.format ?? "commander",
              opts.startingLife ?? 40,
              Date.now()
            );
          return; // success
        } catch (e) {
          // fall through to retry
        }
      }

      // As a last attempt, if the module exposes exec, try that
      if (dbmod && typeof (dbmod as any).exec === "function") {
        try {
          const fmt = (opts.format ?? "commander").replace(/'/g, "''");
          const life = opts.startingLife ?? 40;
          (dbmod as any).exec(
            `INSERT OR IGNORE INTO games (game_id, format, starting_life, created_at) VALUES ('${String(
              opts.gameId
            ).replace(/'/g, "''")}', '${fmt}', ${
              life | 0
            }, ${Date.now()})`
          );
          return;
        } catch (e) {
          // fall through
        }
      }

      // If we reach here and haven't persisted, retry if attempts remain
      if (attempts < maxAttempts) setTimeout(tryPersist, intervalMs);
    } catch (err) {
      // dynamic import may fail early if file not present; retry up to limit
      if (attempts < maxAttempts) setTimeout(tryPersist, intervalMs);
    }
  };

  // start attempts asynchronously
  setTimeout(tryPersist, 0);
}

// createInitialGameState is now directly imported at the top of the file
// No need for dynamic loading - just use the imported function directly

/* Simple mulberry32 RNG used by many state modules when seedRng not implemented */
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
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
  _fallbackLibraries?: Record<string, any[]>; // Fallback library storage (not in zones)

  constructor(id?: string) {
    this.id = id || `g_${randomUUID()}`;
    this.state = {
      players: [],
      zones: {},
      commandZone: {},
      phase: "pre_game",
      format: "commander",
      startingLife: 40,
      priority: null,
      stack: [],
    };
    this.seq = 0;
    this._rngSeed = undefined;
    this._rng = undefined;
    this._fallbackLibraries = {};
  }

  // RNG API
  hasRngSeed() {
    return !!this._rngSeed || !!this.state?.rngSeed;
  }
  seedRng(seed: number) {
    this._rngSeed = seed >>> 0;
    this._rng = mulberry32(this._rngSeed);
    try {
      this.state.rngSeed = this._rngSeed;
    } catch {}
    this.bumpSeq();
  }
  rng() {
    if (this._rng) return this._rng();
    return Math.random();
  }

  // Minimal seq bump helper (used by some modules)
  bumpSeq() {
    try {
      this.seq = typeof this.seq === "number" ? this.seq + 1 : 1;
    } catch {}
  }

  // Join API - conservative fallback
  join(
    socketId: string,
    playerName: string,
    spectator = false,
    _opts?: any,
    seatToken?: string,
    fixedPlayerId?: string
  ) {
    const pid =
      fixedPlayerId || `p_${Math.random().toString(36).slice(2, 9)}`;
    this.state.players = this.state.players || [];
    const exists = this.state.players.find((p: any) => p.id === pid);
    if (!exists) {
      this.state.players.push({
        id: pid,
        name: playerName,
        spectator: Boolean(spectator),
      });
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
    return (this.state.players || []).map((p: any) => ({
      playerId: p.id,
      socketId: undefined,
      spectator: !!p.spectator,
    }));
  }

  // Reset
  reset(preservePlayers = true) {
    if (preservePlayers) {
      const players = Array.isArray(this.state.players)
        ? this.state.players.slice()
        : [];
      this.state = {
        players,
        zones: {},
        commandZone: {},
        phase: "pre_game",
        format: this.state.format || "commander",
        startingLife: this.state.startingLife || 40,
      };
    } else {
      this.state = {
        players: [],
        zones: {},
        commandZone: {},
        phase: "pre_game",
        format: this.state.format || "commander",
        startingLife: this.state.startingLife || 40,
      };
    }
    this.bumpSeq();
  }

  // Shallow hook for deck import resolution
  // Note: For proper games, ctx.libraries Map is the authoritative source.
  // This fallback stores only libraryCount in zones, not the full library array.
  importDeckResolved(playerId: string, cards: any[]) {
    this.state.zones = this.state.zones || {};
    this.state.zones[playerId] = this.state.zones[playerId] || {
      hand: [],
      handCount: 0,
      libraryCount: 0,
      graveyard: [],
    };
    // Store the library in a private property for the fallback draw implementation
    // but don't duplicate it in zones
    this._fallbackLibraries = this._fallbackLibraries || {};
    this._fallbackLibraries[playerId] = cards.map((c: any) => ({
      ...c,
      zone: "library",
    }));
    this.state.zones[playerId].libraryCount = this._fallbackLibraries[playerId].length;
    this.bumpSeq();
  }

  // Shuffle / draw simple implementations for fallback flows
  shuffleLibrary(playerId: string) {
    try {
      const lib = this._fallbackLibraries?.[playerId];
      if (!lib || !Array.isArray(lib)) return;
      // Fisher-Yates
      for (let i = lib.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [lib[i], lib[j]] = [lib[j], lib[i]];
      }
      this.bumpSeq();
    } catch (e) {
      /* ignore */
    }
  }
  drawCards(playerId: string, count: number) {
    try {
      const z = (this.state.zones || {})[playerId];
      if (!z) return;
      z.hand = z.hand || [];
      const lib = this._fallbackLibraries?.[playerId];
      while (count-- > 0 && lib && lib.length > 0) {
        const c = lib.shift();
        z.hand.push(c);
      }
      z.handCount = z.hand.length;
      z.libraryCount = lib ? lib.length : 0;
      this.bumpSeq();
    } catch (e) {
      /* ignore */
    }
  }

  toJSON() {
    return { id: this.id, state: this.state, seq: this.seq };
  }
}

/* GameManager implementation */
export type CreateGameOptions = { id?: string; startingState?: any };

class GameManagerClass {
  private games: Map<string, any> = new Map();
  private rulesBridges: Map<string, RulesBridge> = new Map();
  private ioServer: any = null;

  /**
   * Set the Socket.IO server instance for rules engine integration
   */
  setIOServer(io: any): void {
    this.ioServer = io;
  }

  /**
   * Get the Socket.IO server instance
   */
  getIOServer(): any {
    return this.ioServer;
  }

  /**
   * Get the count of active (non-spectator) player connections for a game.
   * Uses Socket.IO's room adapter to count connected sockets.
   * @param gameId The game ID to check
   * @returns Number of active player connections (0 if no IO server or no room)
   */
  getActiveConnectionsCount(gameId: string): number {
    if (!this.ioServer) return 0;
    
    try {
      const room = this.ioServer.sockets.adapter.rooms.get(gameId);
      if (!room) return 0;
      
      let count = 0;
      for (const socketId of room) {
        const socket = this.ioServer.sockets.sockets.get(socketId);
        // Only count non-spectator players
        if (socket && socket.data.playerId && !socket.data.spectator) {
          count++;
        }
      }
      return count;
    } catch (e) {
      console.warn(`[GameManager] getActiveConnectionsCount failed for ${gameId}:`, e);
      return 0;
    }
  }

  /**
   * Get the RulesBridge for a specific game
   */
  getRulesBridge(gameId: string): RulesBridge | undefined {
    return this.rulesBridges.get(gameId);
  }

  listGameIds(): string[] {
    return Array.from(this.games.keys());
  }

  private initBasicShapes(game: any, opts?: CreateGameOptions) {
    try {
      game.state = game.state || {};
      game.state.phase =
        opts &&
        opts.startingState &&
        typeof opts.startingState.phase !== "undefined"
          ? opts.startingState.phase
          : "pre_game";
      if (opts && opts.startingState && typeof opts.startingState === "object") {
        const incoming = { ...opts.startingState };
        if (typeof incoming.phase === "undefined") delete incoming.phase;
        game.state = { ...game.state, ...incoming };
        if (typeof opts.startingState.phase === "undefined")
          game.state.phase = "pre_game";
      }
    } catch (e) {
      game.state = game.state || {};
      game.state.phase = "pre_game";
    }

    try {
      if (typeof game.seq === "undefined") game.seq = 0;
      game.state.players = game.state.players || [];
      game.state.zones = game.state.zones || {};
      game.state.commandZone = game.state.commandZone || {};
    } catch (e) {
      /* ignore */
    }
  }

  createGame(opts: CreateGameOptions = {}): any {
    const id = opts.id || `g_${randomUUID()}`;
    if (this.games.has(id)) throw new Error(`Game ${id} already exists`);

    let game: any = null;

    // Always prefer createInitialGameState for commander games to get full engine support
    try {
      game = createInitialGameState(id);
      console.log(
        `[GameManager] Created game ${id} using full rules engine (createInitialGameState)`
      );
    } catch (e) {
      console.warn(
        `[GameManager] createInitialGameState failed for ${id}, falling back to MinimalGameAdapter:`,
        e
      );
      game = new MinimalGameAdapter(id);
    }

    this.initBasicShapes(game, opts);
    this.games.set(id, game);

    // Synchronous persistence of games row so /api/games sees it immediately
    try {
      const fmt =
        game.state?.format ??
        (opts.startingState && opts.startingState.format) ??
        "commander";
      const life =
        typeof game.state?.startingLife === "number"
          ? game.state.startingLife
          : opts.startingState &&
            typeof opts.startingState.startingLife === "number"
          ? opts.startingState.startingLife
          : 40;
      createGameIfNotExists(id, fmt, life);
    } catch (e) {
      console.warn(
        "[GameManager] createGame: createGameIfNotExists failed (non-fatal)",
        e
      );
    }

    // Background persistence remains as an additional safety net
    try {
      const fmt =
        game.state?.format ??
        (opts.startingState && opts.startingState.format) ??
        "commander";
      const life =
        typeof game.state?.startingLife === "number"
          ? game.state.startingLife
          : opts.startingState &&
            typeof opts.startingState.startingLife === "number"
          ? opts.startingState.startingLife
          : 40;
      schedulePersistGamesRow({ gameId: id, format: fmt, startingLife: life });
    } catch (e) {
      /* non-fatal */
    }

    return game;
  }

  getGame(gameId: string): any | undefined {
    return this.games.get(gameId);
  }

  ensureGame(gameId: string): any {
    let g = this.games.get(gameId);
    if (g) return g;

    let game: any = null;

    // Always use createInitialGameState for commander games to get full engine support
    try {
      game = createInitialGameState(gameId);
      console.log(
        `[GameManager] Ensured game ${gameId} using full rules engine (createInitialGameState)`
      );
    } catch (e) {
      console.warn(
        `[GameManager] createInitialGameState failed for ${gameId}, falling back to MinimalGameAdapter:`,
        e
      );
      game = new MinimalGameAdapter(gameId);
    }

    this.initBasicShapes(game);

    // NEW: replay persisted events into a fresh game instance for this gameId
    try {
      const events = getEvents(gameId);
      if (Array.isArray(events) && events.length > 0) {
        if (typeof game.replay === "function") {
          // getEvents returns { type, payload }, but replay expects full GameEvent objects.
          // If payload exists, spread it into the event object.
          const replayEvents = events.map((e: any) =>
            e && e.type
              ? e.payload && typeof e.payload === "object"
                ? { type: e.type, ...(e.payload as any) }
                : { type: e.type }
          : e
          );
          try {
            game.replay(replayEvents as any);
            console.info(
              "[GameManager] ensureGame: replayed persisted events",
              {
                gameId,
                count: replayEvents.length,
              }
            );
          } catch (replayErr) {
            console.warn(
              "[GameManager] ensureGame: replay failed (non-fatal)",
              replayErr
            );
          }
        } else {
          console.warn(
            "[GameManager] ensureGame: game.replay is not a function; skipping event replay",
            { gameId }
          );
        }
      }
    } catch (e) {
      console.warn(
        "[GameManager] ensureGame: getEvents/replay failed (non-fatal)",
        e
      );
    }

    this.games.set(gameId, game);

    // Initialize RulesBridge for rules engine integration
    if (this.ioServer && !this.rulesBridges.has(gameId)) {
      try {
        const bridge = createRulesBridge(gameId, this.ioServer);
        bridge.initialize(game.state);
        this.rulesBridges.set(gameId, bridge);
        console.log(`[GameManager] RulesBridge initialized for game ${gameId}`);
      } catch (e) {
        console.warn(`[GameManager] RulesBridge initialization failed for ${gameId}:`, e);
      }
    }

    // Synchronous persistence so game shows up in /api/games immediately
    try {
      const fmt = game.state?.format ?? "commander";
      const life =
        typeof game.state?.startingLife === "number"
          ? game.state.startingLife
          : 40;
      createGameIfNotExists(gameId, fmt, life);
    } catch (e) {
      console.warn(
        "[GameManager] ensureGame: createGameIfNotExists failed (non-fatal)",
        e
      );
    }

    // Background persistence remains as an additional safety net
    try {
      const fmt = game.state?.format ?? "commander";
      const life =
        typeof game.state?.startingLife === "number"
          ? game.state.startingLife
          : 40;
      schedulePersistGamesRow({ gameId, format: fmt, startingLife: life });
    } catch (e) {
      /* non-fatal */
    }

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
          game.state = {
            players,
            zones: {},
            commandZone: {},
            phase: "pre_game",
          };
        } else {
          game.state = {
            players: [],
            zones: {},
            commandZone: {},
            phase: "pre_game",
          };
        }
      }
    } catch (e) {
      console.warn("GameManager.resetGame: underlying reset failed", e);
      game.state = game.state || {};
    }
    try {
      game.state.phase = "pre_game";
    } catch (e) {
      /* ignore */
    }
    try {
      if (typeof game.seq === "undefined") game.seq = 0;
    } catch (e) {
      /* ignore */
    }
    return game;
  }

  deleteGame(gameId: string): boolean {
    // also remove persisted row? intentionally don't delete DB row here to preserve event history.
    return this.games.delete(gameId);
  }

  clearAllGames(): void {
    this.games.clear();
  }
}

export const GameManager = new GameManagerClass();
export default GameManager;