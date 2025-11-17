import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, schedulePriorityTimeout } from "./util";
import { appendEvent } from "../db";
import { computeDiff } from "../utils/diff";
import { games } from "./socket";

/**
 * Register handlers for players joining a game.
 *
 * Robustness:
 * - tolerate Game implementations that don't implement hasRngSeed/seedRng by
 *   falling back to storing rng seed on game.state.rngSeed and game._rngSeed.
 * - tolerate Game implementations that don't implement join() or viewFor()
 *   by using conservative fallbacks so the join flow doesn't throw.
 */
export function registerJoinHandlers(io: Server, socket: Socket) {
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

        // Ensure RNG seed exists. Different Game implementations may expose hasRngSeed/seedRng,
        // others may not — be defensive.
        const seed = ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) as number;

        let hasSeed = false;
        try {
          if (typeof (game as any).hasRngSeed === "function") {
            try {
              hasSeed = Boolean((game as any).hasRngSeed());
            } catch (e) {
              // treat as no seed if method throws
              hasSeed = false;
            }
          } else {
            // Fallback: check canonical state fields used elsewhere
            hasSeed = !!((game.state && (game.state as any).rngSeed) || (game as any)._rngSeed);
          }
        } catch (e) {
          hasSeed = false;
        }

        if (!hasSeed) {
          // Persist rngSeed event for replay (best-effort)
          try {
            await appendEvent(gameId, game.seq, "rngSeed", { seed });
          } catch (err) {
            console.warn("joinGame: appendEvent rngSeed failed (continuing):", err);
          }

          // Apply seed into the game instance if it exposes seedRng, otherwise set on state
          try {
            if (typeof (game as any).seedRng === "function") {
              try {
                (game as any).seedRng(seed);
              } catch (e) {
                console.warn("joinGame: game.seedRng threw, falling back to state set", e);
                game.state = game.state || {};
                (game.state as any).rngSeed = seed;
                (game as any)._rngSeed = seed;
              }
            } else {
              // fallback: attach to state so later logic can observe it
              game.state = game.state || {};
              (game.state as any).rngSeed = seed;
              (game as any)._rngSeed = seed;
            }
          } catch (e) {
            console.warn("joinGame: setting fallback rngSeed failed", e);
          }
        }

        // Perform join using game.join() when available; otherwise apply a minimal fallback.
        let playerId: string;
        let added = false;
        let resolvedToken: string | undefined = undefined;

        if (typeof (game as any).join === "function") {
          try {
            // call the game's join method (some implementations return { playerId, added, seatToken })
            const res = (game as any).join(
              socket.id,
              playerName,
              Boolean(spectator),
              undefined,
              seatToken,
              fixedPlayerId
            );
            // support both object and array-like returns
            playerId = res?.playerId || (Array.isArray(res) ? res[0] : undefined);
            added = Boolean(res?.added ?? res?.added === undefined ? res?.added : res?.added);
            resolvedToken = res?.seatToken || res?.seat;
            if (!playerId) {
              // fallback: try to read from game.state.players last entry
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
          // minimal fallback join behavior for simple in-memory wrappers
          playerId = fixedPlayerId || `p_${Math.random().toString(36).slice(2, 9)}`;
          game.state = game.state || {};
          game.state.players = game.state.players || [];
          if (!game.state.players.find((p: any) => p.id === playerId)) {
            game.state.players.push({ id: playerId, name: playerName, spectator: Boolean(spectator) });
            added = true;
          }
        }

        // Attach session metadata to socket and join socket.io room
        try {
          socket.data = { gameId, playerId, spectator: Boolean(spectator) };
        } catch (e) {
          // older socket.io may not allow data assign — ignore
        }
        try { socket.join(gameId); } catch (e) { /* ignore */ }

        // Build view for this player (use viewFor if available)
        let view: any;
        try {
          if (typeof (game as any).viewFor === "function") {
            view = (game as any).viewFor(playerId, Boolean(spectator));
          } else {
            // conservative: expose entire state (server-side must filter hidden info elsewhere)
            view = game.state;
          }
        } catch (e) {
          console.warn("joinGame: viewFor failed, falling back to raw state", e);
          view = game.state;
        }

        // Send initial joined ack and state to the connecting socket
        try {
          const ack = { gameId, you: playerId, seatToken: resolvedToken };
          socket.emit("joined", ack);
        } catch (e) {
          console.warn("joinGame: emit joined failed", e);
        }

        try {
          socket.emit("state", { gameId, view, seq: (game as any).seq || 0 });
        } catch (e) {
          console.warn("joinGame: emit state failed", e);
        }

        // Log join event to persistent event log if DB append available
        try {
          await appendEvent(gameId, (game as any).seq, "join", {
            playerId,
            name: playerName,
            seat: view?.players?.find((p: any) => p.id === playerId)?.seat,
            seatToken: resolvedToken,
          });
        } catch (dbError) {
          console.error(`joinGame database error for game ${gameId}:`, dbError);
          try { socket.emit("error", { code: "DB_ERROR", message: "Failed to log the player join event." }); } catch {}
        }

        // Notify other participants with a stateDiff if computeDiff available
        try {
          socket.to(gameId).emit("stateDiff", {
            gameId,
            diff: typeof computeDiff === "function" ? computeDiff(undefined, view, (game as any).seq || 0) : { full: view },
          });
        } catch (e) {
          console.warn("joinGame: emit stateDiff failed", e);
        }

        // schedule priority timer for game if relevant
        try {
          schedulePriorityTimeout(io, game, gameId);
        } catch (e) {
          console.warn("joinGame: schedulePriorityTimeout failed", e);
        }
      } catch (err: any) {
        console.error(`joinGame error for socket ${socket.id}:`, err);
        try { socket.emit("error", { code: "JOIN_FAILED", message: String(err?.message || err) }); } catch {}
      }
    }
  );
}