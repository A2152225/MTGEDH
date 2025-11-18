import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, schedulePriorityTimeout } from "./util";
import { appendEvent } from "../db";
import { computeDiff } from "../utils/diff";
import { games } from "./socket";

/**
 * Register join handlers.
 * Defensive and resilient:
 *  - tolerates Game implementations that lack hasRngSeed/seedRng/viewFor/join,
 *  - persists rngSeed best-effort and continues on DB write failures,
 *  - normalizes emitted view so view.zones[playerId] exists for every player,
 *  - ensures in-memory game.state.zones is updated for newly-added players so other modules don't see undefined.
 */

/* --- Helpers --- */
function safeParticipants(game: any) {
  try {
    if (!game) return [];
    if (typeof game.participants === "function") return game.participants();
    if (Array.isArray((game as any).participantsList)) return (game as any).participantsList;
    return (game.state && Array.isArray(game.state.players)) ? game.state.players.map((p: any) => ({ playerId: p.id, socketId: undefined, spectator: !!p.spectator })) : [];
  } catch {
    return [];
  }
}

function defaultPlayerZones() {
  return { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0 };
}

/**
 * Ensure the authoritative in-memory game.state.zones has entries for all players
 * This prevents other modules from reading undefined for zones[playerId].
 */
function ensureStateZonesForPlayers(game: any) {
  try {
    if (!game) return;
    game.state = game.state || {};
    game.state.players = game.state.players || [];
    game.state.zones = game.state.zones || {};
    for (const p of game.state.players) {
      const pid = p?.id ?? p?.playerId;
      if (!pid) continue;
      if (!game.state.zones[pid]) game.state.zones[pid] = defaultPlayerZones();
      else {
        // ensure counts/arrays exist
        const z = game.state.zones[pid];
        z.hand = Array.isArray(z.hand) ? z.hand : [];
        z.handCount = typeof z.handCount === "number" ? z.handCount : (Array.isArray(z.hand) ? z.hand.length : 0);
        z.library = Array.isArray(z.library) ? z.library : [];
        z.libraryCount = typeof z.libraryCount === "number" ? z.libraryCount : (Array.isArray(z.library) ? z.library.length : 0);
        z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
        z.graveyardCount = typeof z.graveyardCount === "number" ? z.graveyardCount : (Array.isArray(z.graveyard) ? z.graveyard.length : 0);
      }
    }
  } catch (e) {
    // non-fatal; best-effort
    console.warn("ensureStateZonesForPlayers failed:", e);
  }
}

/**
 * Normalize a view object before emitting to clients. Also mirrors per-player zone defaults
 * back into game.state.zones when possible so server-side code sees consistent shape.
 */
function normalizeViewForEmit(rawView: any, game: any) {
  try {
    const view = rawView || {};
    view.zones = view.zones || {};
    const players =
      Array.isArray(view.players)
        ? view.players
        : (game && game.state && Array.isArray(game.state.players) ? game.state.players : []);
    for (const p of players) {
      const pid = p?.id ?? p?.playerId;
      if (!pid) continue;
      view.zones[pid] = view.zones[pid] ?? defaultPlayerZones();
    }

    // Also ensure authoritative game.state.zones is populated so other server modules don't see undefined
    try {
      if (game && game.state) {
        game.state.zones = game.state.zones || {};
        for (const pid of Object.keys(view.zones)) {
          if (!game.state.zones[pid]) game.state.zones[pid] = view.zones[pid];
          else {
            // merge minimal shape without clobbering existing data
            const src = view.zones[pid];
            const dst = game.state.zones[pid];
            dst.hand = Array.isArray(dst.hand) ? dst.hand : (Array.isArray(src.hand) ? src.hand : []);
            dst.handCount = typeof dst.handCount === "number" ? dst.handCount : (Array.isArray(dst.hand) ? dst.hand.length : 0);
            dst.library = Array.isArray(dst.library) ? dst.library : (Array.isArray(src.library) ? src.library : []);
            dst.libraryCount = typeof dst.libraryCount === "number" ? dst.libraryCount : (Array.isArray(dst.library) ? dst.library.length : 0);
            dst.graveyard = Array.isArray(dst.graveyard) ? dst.graveyard : (Array.isArray(src.graveyard) ? src.graveyard : []);
            dst.graveyardCount = typeof dst.graveyardCount === "number" ? dst.graveyardCount : (Array.isArray(dst.graveyard) ? dst.graveyard.length : 0);
          }
        }
      }
    } catch (e) {
      // swallow; normalization already done for emit
    }

    return view;
  } catch (e) {
    console.warn("normalizeViewForEmit failed:", e);
    return rawView || {};
  }
}

/* --- Debug logging (env-gated) --- */
function logStateDebug(prefix: string, gameId: string, view: any) {
  try {
    const enabled = process.env.DEBUG_STATE === "1";
    if (!enabled) return;
    const playerIds = (Array.isArray(view?.players) ? view.players.map((p: any) => p?.id ?? p?.playerId) : []);
    const zoneKeys = view?.zones ? Object.keys(view.zones) : [];
    console.log(`[STATE_DEBUG] ${prefix} gameId=${gameId} players=[${playerIds.join(",")}] zones=[${zoneKeys.join(",")}] seq=${view?.seq ?? "-"}`);
    // print full payload for diagnosis (verbose)
    try {
      console.log(`[STATE_DEBUG] FULL ${prefix} gameId=${gameId} view=`, JSON.stringify(view));
    } catch (e) {
      console.log(`[STATE_DEBUG] FULL ${prefix} gameId=${gameId} view (stringify failed)`, view);
    }
  } catch (e) {
    // non-fatal
  }
}

/* --- Handlers --- */
export function registerJoinHandlers(io: Server, socket: Socket) {
  // Join a game
  socket.on(
    "joinGame",
    async ({
      gameId,
      playerName,
      spectator,
      seatToken,
      fixedPlayerId,
    }: {
      gameId: string;
      playerName: string;
      spectator?: boolean;
      seatToken?: string;
      fixedPlayerId?: string;
    }) => {
      try {
        const game = ensureGame(gameId);
        if (!game) {
          socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found." });
          return;
        }

        // If a non-empty playerName is provided and no fixedPlayerId was provided,
        // check for an existing player with that name who is already connected.
        if (!fixedPlayerId && playerName) {
          const existing =
            game.state && Array.isArray(game.state.players)
              ? (game.state.players as any[]).find((p) => String(p?.name || "").trim().toLowerCase() === String(playerName).trim().toLowerCase())
              : undefined;

          if (existing && existing.id) {
            const participants = safeParticipants(game);
            const isConnected = participants.some((pp: any) => pp.playerId === existing.id);
            if (isConnected) {
              socket.emit("nameInUse", {
                gameId,
                playerName,
                options: [
                  { action: "reconnect", fixedPlayerId: existing.id },
                  { action: "newName" },
                  { action: "cancel" },
                ],
              });
              return;
            }
          }
        }

        // Ensure RNG seed exists. Be defensive against missing methods or throws.
        try {
          let hasSeed = false;
          try {
            if (typeof (game as any).hasRngSeed === "function") {
              hasSeed = Boolean((game as any).hasRngSeed());
            } else {
              hasSeed = !!((game.state && (game.state as any).rngSeed) || (game as any)._rngSeed);
            }
          } catch {
            hasSeed = false;
          }

          if (!hasSeed) {
            const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
            // Apply seed to game instance if possible; otherwise attach to state as fallback.
            try {
              if (typeof (game as any).seedRng === "function") {
                try {
                  (game as any).seedRng(seed);
                } catch (e) {
                  // fallback to state property if seedRng throws
                  game.state = game.state || {};
                  (game.state as any).rngSeed = seed;
                  (game as any)._rngSeed = seed;
                }
              } else {
                game.state = game.state || {};
                (game.state as any).rngSeed = seed;
                (game as any)._rngSeed = seed;
              }
            } catch (e) {
              console.warn("joinGame: failed to set rng seed on game instance (continuing):", e);
            }

            // Persist rngSeed event best-effort; don't block join on DB failures
            try {
              await appendEvent(gameId, (game as any).seq || 0, "rngSeed", { seed });
            } catch (err) {
              console.warn("joinGame: appendEvent rngSeed failed (continuing):", err);
            }
          }
        } catch (e) {
          console.warn("joinGame: rng seed detection failed (continuing):", e);
        }

        // Perform join using game.join() when available; otherwise apply a minimal fallback.
        let playerId: string = "";
        let added = false;
        let resolvedToken: string | undefined = undefined;

        if (typeof (game as any).join === "function") {
          try {
            // Try calling the expected signature. Many implementations return { playerId, added, seatToken }.
            const res = (game as any).join(socket.id, playerName, Boolean(spectator), fixedPlayerId, seatToken);
            playerId = res?.playerId || (Array.isArray(res) ? res[0] : undefined) || "";
            added = Boolean(res?.added) || false;
            resolvedToken = res?.seatToken || res?.seat || undefined;

            // If join returned nothing useful, fall back to adding a player into state directly.
            if (!playerId) {
              game.state = game.state || {};
              game.state.players = game.state.players || [];
              playerId = fixedPlayerId || `p_${Math.random().toString(36).slice(2, 9)}`;
              if (!game.state.players.find((p: any) => p.id === playerId)) {
                game.state.players.push({ id: playerId, name: playerName, spectator: Boolean(spectator) });
                added = true;
              }
            }
          } catch (err) {
            console.warn("joinGame: game.join threw, falling back to simple join:", err);
            playerId = fixedPlayerId || `p_${Math.random().toString(36).slice(2, 9)}`;
            game.state = game.state || {};
            game.state.players = game.state.players || [];
            if (!game.state.players.find((p: any) => p.id === playerId)) {
              game.state.players.push({ id: playerId, name: playerName, spectator: Boolean(spectator) });
              added = true;
            }
          }
        } else {
          // Minimal fallback join behavior for simple in-memory wrappers
          playerId = fixedPlayerId || `p_${Math.random().toString(36).slice(2, 9)}`;
          game.state = game.state || {};
          game.state.players = game.state.players || [];
          if (!game.state.players.find((p: any) => p.id === playerId)) {
            game.state.players.push({ id: playerId, name: playerName, spectator: Boolean(spectator) });
            added = true;
          }
        }

        // Ensure server-side zones for players exist (so modules reading game.state.zones don't get undefined)
        try {
          ensureStateZonesForPlayers(game);
        } catch (e) {
          // non-fatal
        }

        // Attach session metadata to socket and join socket.io room
        try {
          socket.data = { gameId, playerId, spectator: Boolean(spectator) };
        } catch {
          // older socket.io may not allow data assign — ignore
        }
        try {
          socket.join(gameId);
        } catch (e) {
          // non-fatal
        }

        // Build view for this player (use viewFor if available)
        let rawView: any;
        try {
          if (typeof (game as any).viewFor === "function") {
            rawView = (game as any).viewFor(playerId, Boolean(spectator));
          } else {
            rawView = game.state;
          }
        } catch (e) {
          console.warn("joinGame: viewFor failed, falling back to raw state", e);
          rawView = game.state;
        }

        const view = normalizeViewForEmit(rawView, game);

        // Debug log
        logStateDebug("EMIT_JOIN_STATE", gameId, view);

        // Send initial joined ack and state to the connecting socket
        try {
          socket.emit("joined", { gameId, you: playerId, seatToken: resolvedToken });
        } catch (e) {
          console.warn("joinGame: emit joined failed", e);
        }

        try {
          socket.emit("state", { gameId, view, seq: (game as any).seq || 0 });
        } catch (e) {
          console.warn("joinGame: emit state failed", e);
        }

        // Log join event to persistent event log if DB append available (best-effort)
        if (!spectator && added) {
          try {
            await appendEvent(gameId, (game as any).seq || 0, "join", {
              playerId,
              name: playerName,
              seat: view.players?.find((p: any) => p.id === playerId)?.seat,
              seatToken: resolvedToken,
            });
          } catch (dbError) {
            console.error(`joinGame database error for game ${gameId}:`, dbError);
            try {
              socket.emit("error", {
                code: "DB_ERROR",
                message: "Failed to log the player join event.",
              });
            } catch {}
            // continue — don't return; we already informed client of join
          }

          // Notify other participants with a stateDiff if computeDiff available
          try {
            socket.to(gameId).emit("stateDiff", {
              gameId,
              diff: typeof computeDiff === "function" ? computeDiff(undefined, view, (game as any).seq || 0) : { full: view },
            });
          } catch (e) {
            console.warn("joinGame: emit stateDiff failed", e);
            try {
              // fallback broadcast entire state
              io.to(gameId).emit("state", { gameId, view, seq: (game as any).seq || 0 });
            } catch {}
          }

          // schedule priority timer for game if relevant
          try {
            schedulePriorityTimeout(io, game, gameId);
          } catch (e) {
            console.warn("joinGame: schedulePriorityTimeout failed", e);
          }
        }
      } catch (err: any) {
        console.error(`joinGame error for socket ${socket.id}:`, err);
        try {
          socket.emit("error", { code: "JOIN_FAILED", message: String(err?.message || err) });
        } catch {}
      }
    }
  );
  // Request state refresh
  socket.on("requestState", ({ gameId }: { gameId: string }) => {
    try {
      const game = games.get(gameId);
      const playerId = socket.data?.playerId;
      if (!game || !playerId) return;

      let rawView: any;
      try {
        rawView = typeof (game as any).viewFor === "function" ? (game as any).viewFor(playerId, Boolean(socket.data?.spectator)) : game.state;
      } catch (e) {
        console.warn("requestState: viewFor failed, falling back to raw state", e);
        rawView = game.state;
      }
      // Also ensure in-memory state shape is healthy before emitting
      try { ensureStateZonesForPlayers(game); } catch {}
      const view = normalizeViewForEmit(rawView, game);

      // Debug log
      logStateDebug("EMIT_REQUESTED_STATE", gameId, view);

      socket.emit("state", { gameId, view, seq: (game as any).seq || 0 });
      schedulePriorityTimeout(io, game, gameId);
    } catch (e) {
      console.warn("requestState handler failed:", e);
    }
  });
}