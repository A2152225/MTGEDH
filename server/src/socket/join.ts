import type { Server, Socket } from "socket.io";
import { randomBytes } from "crypto";
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
 *
 * Added: per-game join queue to serialize join processing and avoid race-created duplicate roster entries.
 * Change: when a forcedFixedPlayerId is present we DO NOT call game.join(...) so reconnects cannot be
 *         overridden by custom join implementations that create new players.
 */

/* --- Helpers --- */
function safeParticipants(game: any) {
  try {
    if (!game) return [];
    if (typeof game.participants === "function") return game.participants();
    if (Array.isArray((game as any).participantsList))
      return (game as any).participantsList;
    return game.state && Array.isArray(game.state.players)
      ? game.state.players.map((p: any) => ({
          playerId: p.id,
          socketId: (p as any).socketId ?? undefined,
          spectator: !!p.spectator,
        }))
      : [];
  } catch {
    return [];
  }
}

function defaultPlayerZones() {
  return {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
  };
}

/** Find a roster entry by display name (case-insensitive, trimmed) */
function findPlayerByName(game: any, name?: string) {
  if (!name) return undefined;
  try {
    const nm = String(name).trim().toLowerCase();
    if (!game || !game.state || !Array.isArray(game.state.players))
      return undefined;
    return (game.state.players as any[]).find(
      (p) => String(p?.name || "").trim().toLowerCase() === nm
    );
  } catch {
    return undefined;
  }
}

/** Find a roster entry by seatToken */
function findPlayerBySeatToken(game: any, token?: string) {
  if (!token) return undefined;
  try {
    if (!game || !game.state || !Array.isArray(game.state.players))
      return undefined;
    return (game.state.players as any[]).find(
      (p) => p?.seatToken && String(p.seatToken) === String(token)
    );
  } catch {
    return undefined;
  }
}

/** Generate a short seat token */
function makeSeatToken() {
  return randomBytes(6).toString("hex"); // 12 hex chars, reasonably unique for local use
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
        z.handCount =
          typeof z.handCount === "number"
            ? z.handCount
            : Array.isArray(z.hand)
            ? z.hand.length
            : 0;
        z.library = Array.isArray(z.library) ? z.library : [];
        z.libraryCount =
          typeof z.libraryCount === "number"
            ? z.libraryCount
            : Array.isArray(z.library)
            ? z.library.length
            : 0;
        z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
        z.graveyardCount =
          typeof z.graveyardCount === "number"
            ? z.graveyardCount
            : Array.isArray(z.graveyard)
            ? z.graveyard.length
            : 0;
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
    const players = Array.isArray(view.players)
      ? view.players
      : game &&
        game.state &&
        Array.isArray(game.state.players)
      ? game.state.players
      : [];
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
            dst.hand = Array.isArray(dst.hand)
              ? dst.hand
              : Array.isArray(src.hand)
              ? src.hand
              : [];
            dst.handCount =
              typeof dst.handCount === "number"
                ? dst.handCount
                : Array.isArray(dst.hand)
                ? dst.hand.length
                : 0;
            dst.library = Array.isArray(dst.library)
              ? dst.library
              : Array.isArray(src.library)
              ? src.library
              : [];
            dst.libraryCount =
              typeof dst.libraryCount === "number"
                ? dst.libraryCount
                : Array.isArray(dst.library)
                ? dst.library.length
                : 0;
            dst.graveyard = Array.isArray(dst.graveyard)
              ? dst.graveyard
              : Array.isArray(src.graveyard)
              ? src.graveyard
              : [];
            dst.graveyardCount =
              typeof dst.graveyardCount === "number"
                ? dst.graveyardCount
                : Array.isArray(dst.graveyard)
                ? dst.graveyard.length
                : 0;
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
/**
 * Compact, env-gated state debug logger.
 * Avoids dumping the entire deck; logs summary + first/last library card only.
 */
function logStateDebug(prefix: string, gameId: string, view: any) {
  try {
    const enabled = process.env.DEBUG_STATE === "1";
    if (!enabled) return;

    const playerIds = Array.isArray(view?.players)
      ? view.players.map((p: any) => p?.id ?? p?.playerId)
      : [];
    const zoneKeys = view?.zones ? Object.keys(view.zones) : [];

    const firstPid = playerIds[0];
    const z = firstPid && view?.zones ? view.zones[firstPid] : null;
    const handCount =
      typeof z?.handCount === "number"
        ? z.handCount
        : Array.isArray(z?.hand)
        ? z.hand.length
        : 0;
    const libraryCount =
      typeof z?.libraryCount === "number"
        ? z.libraryCount
        : Array.isArray(z?.library)
        ? z.library.length
        : 0;

    const lib = z && Array.isArray(z.library) ? z.library : [];
    const firstLib = lib[0];
    const lastLib =
      lib.length > 1 ? lib[lib.length - 1] : lib.length === 1 ? lib[0] : null;

    console.log(
      `[STATE_DEBUG] ${prefix} gameId=${gameId} players=[${playerIds.join(
        ","
      )}] zones=[${zoneKeys.join(
        ","
      )}] handCount=${handCount} libraryCount=${libraryCount}`
    );
    console.log(`[STATE_DEBUG] ${prefix} librarySample gameId=${gameId}`, {
      firstLibraryCard: firstLib
        ? {
            id: firstLib.id,
            name: firstLib.name,
            type_line: firstLib.type_line,
          }
        : null,
      lastLibraryCard: lastLib
        ? {
            id: lastLib.id,
            name: lastLib.name,
            type_line: lastLib.type_line,
          }
        : null,
    });
  } catch {
    // non-fatal
  }
}

/* --- Join queue to serialize join handling per game --- */
const joinQueues = new Map<string, Promise<void>>();

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
      // Serialize handling for this gameId by chaining onto the per-game promise tail.
      const tail = joinQueues.get(gameId) || Promise.resolve();
      const myTask = tail
        .then(async () => {
          try {
            const game = ensureGame(gameId);
            if (!game) {
              try {
                socket.emit("error", {
                  code: "GAME_NOT_FOUND",
                  message: "Game not found.",
                });
              } catch {}
              return;
            }

            // Debug: log incoming join payload when enabled
            if (process.env.DEBUG_STATE === "1") {
              console.log("joinGame incoming payload:", {
                socketId: socket.id,
                gameId,
                playerName,
                spectator,
                seatToken,
                fixedPlayerId,
              });
            }

            // Try reattach by seatToken first (strong preference).
            let forcedFixedPlayerId = fixedPlayerId;
            let resolvedToken: string | undefined = undefined;
            if (!forcedFixedPlayerId && seatToken) {
              const byToken = findPlayerBySeatToken(game, seatToken);
              if (byToken && byToken.id) {
                forcedFixedPlayerId = byToken.id;
                resolvedToken = byToken.seatToken;
                if (process.env.DEBUG_STATE === "1")
                  console.log(
                    `joinGame: resolved via seatToken -> playerId=${forcedFixedPlayerId}`
                  );
              }
            }

            // If no forced id and a player name exists, require explicit client choice (no auto-create)
            if (!forcedFixedPlayerId && playerName) {
              const existing =
                game.state && Array.isArray(game.state.players)
                  ? (game.state.players as any[]).find(
                      (p) =>
                        String(p?.name || "").trim().toLowerCase() ===
                        String(playerName).trim().toLowerCase()
                    )
                  : undefined;

              if (existing && existing.id) {
                const participants = safeParticipants(game);
                const isConnected = participants.some(
                  (pp: any) => pp.playerId === existing.id
                );

                if (process.env.DEBUG_STATE === "1")
                  console.log(
                    `joinGame: name exists -> prompting nameInUse (playerId=${existing.id}, connected=${isConnected})`
                  );
                socket.emit("nameInUse", {
                  gameId,
                  playerName,
                  options: [
                    { action: "reconnect", fixedPlayerId: existing.id },
                    { action: "newName" },
                    { action: "cancel" },
                  ],
                  meta: { isConnected: Boolean(isConnected) },
                });
                return;
              }
            }

            // Ensure RNG seed exists. Be defensive against missing methods or throws.
            try {
              let hasSeed = false;
              try {
                if (typeof (game as any).hasRngSeed === "function") {
                  hasSeed = Boolean((game as any).hasRngSeed());
                } else {
                  hasSeed = !!(
                    (game.state && (game.state as any).rngSeed) ||
                    (game as any)._rngSeed
                  );
                }
              } catch {
                hasSeed = false;
              }

              if (!hasSeed) {
                const seed =
                  (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
                try {
                  if (typeof (game as any).seedRng === "function") {
                    try {
                      (game as any).seedRng(seed);
                    } catch (e) {
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
                  console.warn(
                    "joinGame: failed to set rng seed on game instance (continuing):",
                    e
                  );
                }

                try {
                  await appendEvent(
                    gameId,
                    (game as any).seq || 0,
                    "rngSeed",
                    { seed }
                  );
                } catch (err) {
                  console.warn(
                    "joinGame: appendEvent rngSeed failed (continuing):",
                    err
                  );
                }
              }
            } catch (e) {
              console.warn(
                "joinGame: rng seed detection failed (continuing):",
                e
              );
            }

            // Perform join using game.join() when available; otherwise fallback.
            // IMPORTANT: if we have a forcedFixedPlayerId (reconnect intent), DO NOT call game.join
            // because some implementations may create a new player despite the fixed id. Use the
            // server's deterministic fallback reattach/create logic instead.
            let playerId: string = "";
            let added = false;

            const shouldCallGameJoin =
              typeof (game as any).join === "function" && !forcedFixedPlayerId;
            if (shouldCallGameJoin) {
              try {
                const res = (game as any).join(
                  socket.id,
                  playerName,
                  Boolean(spectator),
                  forcedFixedPlayerId ?? undefined,
                  seatToken
                );
                playerId =
                  res?.playerId || (Array.isArray(res) ? res[0] : undefined) || "";
                added = Boolean(res?.added) || false;
                resolvedToken =
                  resolvedToken || res?.seatToken || res?.seat || undefined;
                if (process.env.DEBUG_STATE === "1")
                  console.log("joinGame: game.join returned", {
                    playerId,
                    added,
                    resolvedToken,
                  });
              } catch (err) {
                console.warn(
                  "joinGame: game.join threw (continuing to fallback):",
                  err
                );
              }
            } else {
              if (forcedFixedPlayerId && process.env.DEBUG_STATE === "1") {
                console.log(
                  "joinGame: skipping game.join because forcedFixedPlayerId present; falling back to server reattach logic"
                );
              }
            }

            // Helper: rebind engine-level participants to the current socket if possible
            function rebindEngineParticipant(gameObj: any, pid: string, sid: string) {
              try {
                if (typeof gameObj.participants === "function") {
                  const parts = gameObj.participants();
                  const target = parts.find((pp: any) => pp.playerId === pid);
                  if (target) {
                    target.socketId = sid;
                  }
                }
              } catch {
                // non-fatal
              }
            }

            // Fallback / safe reattach/create (serialized — no races now)
            if (!playerId) {
              // 1) forcedFixedPlayerId => reuse existing or create with that id (very rare)
              if (forcedFixedPlayerId) {
                playerId = forcedFixedPlayerId;
                try {
                  game.state = game.state || {};
                  game.state.players = game.state.players || [];
                  const playerObj = (game.state.players as any[]).find(
                    (p) => p.id === playerId
                  );
                  if (playerObj) {
                    playerObj.socketId = socket.id;
                    if (!playerObj.seatToken)
                      playerObj.seatToken = resolvedToken || makeSeatToken();
                    resolvedToken = resolvedToken || playerObj.seatToken;
                    added = false;
                    if (process.env.DEBUG_STATE === "1")
                      console.log(
                        `joinGame: reused forcedFixedPlayerId ${playerId}`
                      );
                  } else {
                    // unexpected: create one with forced id
                    const token = resolvedToken || makeSeatToken();
                    const newP: any = {
                      id: playerId,
                      name: playerName,
                      spectator: Boolean(spectator),
                      seatToken: token,
                      socketId: socket.id,
                    };
                    game.state.players.push(newP);
                    resolvedToken = token;
                    added = true;
                    if (process.env.DEBUG_STATE === "1")
                      console.log(
                        `joinGame: created player for forcedFixedPlayerId ${playerId}`
                      );
                  }

                  // Rebind engine participants to this socketId
                  rebindEngineParticipant(game, playerId, socket.id);
                } catch (e) {
                  console.warn(
                    "joinGame: forcedFixedPlayerId fallback failed:",
                    e
                  );
                }
              } else {
                // 2) seatToken reattach (if present)
                if (seatToken) {
                  const byToken = findPlayerBySeatToken(game, seatToken);
                  if (byToken && byToken.id) {
                    playerId = byToken.id;
                    try {
                      byToken.socketId = socket.id;
                      resolvedToken = byToken.seatToken;
                    } catch {}
                    added = false;
                    if (process.env.DEBUG_STATE === "1")
                      console.log(
                        `joinGame: reattached by seatToken -> ${playerId}`
                      );
                    // Rebind engine participants
                    rebindEngineParticipant(game, playerId, socket.id);
                  }
                }
              }
            }

            // 3) reuse by name if disconnected (otherwise nameInUse would have returned earlier)
            if (!playerId && playerName) {
              const existingByName = findPlayerByName(game, playerName);
              if (existingByName && existingByName.id) {
                const participants = safeParticipants(game);
                const isConnected = participants.some(
                  (pp: any) => pp.playerId === existingByName.id
                );
                if (isConnected) {
                  socket.emit("nameInUse", {
                    gameId,
                    playerName,
                    options: [
                      { action: "reconnect", fixedPlayerId: existingByName.id },
                      { action: "newName" },
                      { action: "cancel" },
                    ],
                    meta: { isConnected: true },
                  });
                  return;
                } else {
                  playerId = existingByName.id;
                  try {
                    existingByName.socketId = socket.id;
                    if (!existingByName.seatToken)
                      existingByName.seatToken = makeSeatToken();
                    resolvedToken =
                      resolvedToken || existingByName.seatToken;
                  } catch {}
                  added = false;
                  if (process.env.DEBUG_STATE === "1")
                    console.log(
                      `joinGame: reused disconnected name -> ${playerId}`
                    );
                  // Rebind engine participants
                  rebindEngineParticipant(game, playerId, socket.id);
                }
              }
            }

            // 4) final re-checks and create new player if still no id
            if (!playerId) {
              // last-chance seatToken re-check
              if (seatToken) {
                const byToken2 = findPlayerBySeatToken(game, seatToken);
                if (byToken2 && byToken2.id) {
                  playerId = byToken2.id;
                  added = false;
                  try {
                    byToken2.socketId = socket.id;
                    resolvedToken = byToken2.seatToken;
                  } catch {}
                  if (process.env.DEBUG_STATE === "1")
                    console.log(
                      `joinGame: last-chance reattach by seatToken -> ${playerId}`
                    );
                  // Rebind engine participants
                  rebindEngineParticipant(game, playerId, socket.id);
                }
              }
            }

            if (!playerId) {
              if (playerName) {
                const existing = findPlayerByName(game, playerName);
                if (existing && existing.id) {
                  const participants = safeParticipants(game);
                  const isConnected = participants.some(
                    (pp: any) => pp.playerId === existing.id
                  );
                  socket.emit("nameInUse", {
                    gameId,
                    playerName,
                    options: [
                      { action: "reconnect", fixedPlayerId: existing.id },
                      { action: "newName" },
                      { action: "cancel" },
                    ],
                    meta: { isConnected: Boolean(isConnected) },
                  });
                  return;
                }
              }

              // create new
              const newId = `p_${Math.random().toString(36).slice(2, 9)}`;
              const tokenToUse = seatToken || makeSeatToken();
              const playerObj: any = {
                id: newId,
                name: playerName,
                spectator: Boolean(spectator),
                seatToken: tokenToUse,
                socketId: socket.id,
              };
              game.state = game.state || {};
              game.state.players = game.state.players || [];
              game.state.players.push(playerObj);
              playerId = newId;
              resolvedToken = tokenToUse;
              added = true;
              if (process.env.DEBUG_STATE === "1")
                console.log(
                  `joinGame: created new player ${playerId} (name=${playerName})`
                );
              // Rebind engine participants (in case engine inspects state.players)
              rebindEngineParticipant(game, playerId, socket.id);
            }

            // Ensure server-side zones for players exist
            try {
              ensureStateZonesForPlayers(game);
            } catch (e) {
              /* ignore */
            }

            // Session metadata + socket room
            try {
              socket.data = {
                gameId,
                playerId,
                spectator: Boolean(spectator),
              };
            } catch {}
            try {
              socket.join(gameId);
            } catch {}

            // Build view (viewFor or raw)
            let rawView: any;
            try {
              if (typeof (game as any).viewFor === "function") {
                rawView = (game as any).viewFor(
                  playerId,
                  Boolean(spectator)
                );
              } else {
                rawView = game.state;
              }
            } catch (e) {
              console.warn(
                "joinGame: viewFor failed, falling back to raw state",
                e
              );
              rawView = game.state;
            }

            const view = normalizeViewForEmit(rawView, game);

            // Debug log
            logStateDebug("EMIT_JOIN_STATE", gameId, view);

            // Emit joined (include seatToken)
            try {
              socket.emit("joined", {
                gameId,
                you: playerId,
                seatToken: resolvedToken,
              });
            } catch (e) {
              console.warn("joinGame: emit joined failed", e);
            }
            try {
              socket.emit("state", {
                gameId,
                view,
                seq: (game as any).seq || 0,
              });
            } catch (e) {
              console.warn("joinGame: emit state failed", e);
            }

            // Persist join event if new
            if (!spectator && added) {
              try {
                await appendEvent(
                  gameId,
                  (game as any).seq || 0,
                  "join",
                  {
                    playerId,
                    name: playerName,
                    seat:
                      view.players?.find(
                        (p: any) => p.id === playerId
                      )?.seat,
                    seatToken: resolvedToken,
                  }
                );
              } catch (dbError) {
                console.error(
                  `joinGame database error for game ${gameId}:`,
                  dbError
                );
                try {
                  socket.emit("error", {
                    code: "DB_ERROR",
                    message: "Failed to log the player join event.",
                  });
                } catch {}
              }

              try {
                socket.to(gameId).emit("stateDiff", {
                  gameId,
                  diff:
                    typeof computeDiff === "function"
                      ? computeDiff(undefined, view, (game as any).seq || 0)
                      : { full: view },
                });
                schedulePriorityTimeout(io, game, gameId);
              } catch (e) {
                console.warn("joinGame: emit stateDiff failed", e);
                try {
                  io.to(gameId).emit("state", {
                    gameId,
                    view,
                    seq: (game as any).seq || 0,
                  });
                } catch {}
              }
            } else {
              try {
                schedulePriorityTimeout(io, game, gameId);
              } catch {}
            }
          } catch (err: any) {
            console.error(`joinGame error for socket ${socket.id}:`, err);
            try {
              socket.emit("error", {
                code: "JOIN_FAILED",
                message: String(err?.message || err),
              });
            } catch {}
          }
        })
        .catch((e) => {
          // swallow to keep chain healthy
          if (process.env.DEBUG_STATE === "1")
            console.warn("join queue task error:", e);
        });

      // put myTask onto the tail for this gameId so subsequent joins queue behind it
      joinQueues.set(gameId, myTask);
      // await the task so the socket handler completes after our serialized work
      await myTask;
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
        rawView =
          typeof (game as any).viewFor === "function"
            ? (game as any).viewFor(
                playerId,
                Boolean(socket.data?.spectator)
              )
            : game.state;
      } catch (e) {
        console.warn(
          "requestState: viewFor failed, falling back to raw state",
          e
        );
        rawView = game.state;
      }
      try {
        ensureStateZonesForPlayers(game);
      } catch {}
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