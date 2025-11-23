import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, appendGameEvent } from "./util";

/**
 * Judge voting metadata stored on the game object (runtime only).
 */
interface JudgeRuntimeState {
  // Current judge player id (if any)
  judgeId?: string | null;
  // Banned requesters for the current player-set version
  bannedRequesters: Map<string, number>;
  // Monotonic version of the active-player set; bump when players join/leave or change inactive status.
  playerVersion: number;
  // Ongoing judge vote
  currentVote?: {
    confirmId: string;
    requesterId: string;
    voters: string[];
    responses: Record<string, "yes" | "no" | "pending">;
  };
}

/**
 * Ensure the game object has a runtime judge state attached.
 */
function getJudgeRuntime(game: any): JudgeRuntimeState {
  if (!game._judgeRuntime) {
    game._judgeRuntime = {
      judgeId: null,
      bannedRequesters: new Map<string, number>(),
      playerVersion: 0,
      currentVote: undefined,
    } as JudgeRuntimeState;
  }
  return game._judgeRuntime as JudgeRuntimeState;
}

/**
 * Compute the current list of active playerIds (non-spectator, not inactive).
 */
function activePlayerIds(game: any): string[] {
  const playersArr: any[] = Array.isArray(game.state?.players)
    ? game.state.players
    : [];
  const inactiveSet: Set<string> =
    (game.ctx && game.ctx.inactive) || new Set<string>();

  return playersArr
    .filter((p) => !p.spectator)
    .map((p) => p.id)
    .filter((id: string) => !inactiveSet.has(id));
}

/**
 * Increment the "playerVersion" when we know the active player set changed.
 * For now, we expect callers to bump this manually (e.g., on join/leave/reset),
 * but we also provide a best-effort fallback here when computing active players.
 */
function computeAndMaybeBumpPlayerVersion(game: any): number {
  const jr = getJudgeRuntime(game);
  const active = activePlayerIds(game).sort();
  const key = active.join(",");
  if (game._lastActivePlayersKey !== key) {
    game._lastActivePlayersKey = key;
    jr.playerVersion = (jr.playerVersion || 0) + 1;
  }
  return jr.playerVersion;
}

/**
 * Register judge-related socket handlers.
 *
 * Flow:
 * - Client sends "requestJudge" (triggered via /judge in chat).
 * - Server checks ban conditions and starts a unanimous vote among active players.
 * - Emits:
 *   - "judgeConfirmRequest"
 *   - "judgeConfirmUpdate"
 *   - "judgeCancelled"
 *   - "judgeConfirmed"
 */
export function registerJudgeHandlers(io: Server, socket: Socket) {
  // Request to become judge, typically from /judge chat command
  socket.on("requestJudge", ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const requesterId = socket.data.playerId;
      const spectator = socket.data.spectator;

      if (!game || !requesterId) return;

      // Spectators can't become judge via /judge, they must be players.
      if (spectator) {
        socket.emit("error", {
          code: "JUDGE_REQUEST_SPECTATOR",
          message: "Only players can request judge role.",
        });
        return;
      }

      const jr = getJudgeRuntime(game);

      // If there is already a judge, reject.
      if (jr.judgeId && jr.judgeId === requesterId) {
        socket.emit("error", {
          code: "JUDGE_ALREADY",
          message: "You are already the judge for this game.",
        });
        return;
      }

      // Compute active players and update version if changed
      const version = computeAndMaybeBumpPlayerVersion(game);
      const active = activePlayerIds(game);

      // Require at least 2 active players (judge doesn't make sense alone).
      if (active.length <= 1) {
        socket.emit("error", {
          code: "JUDGE_REQUEST_TOO_FEW",
          message: "Judge role requires more than one active player.",
        });
        return;
      }

      // Check if requester is banned for this playerVersion.
      const banVersion = jr.bannedRequesters.get(requesterId);
      if (banVersion !== undefined && banVersion === version) {
        socket.emit("error", {
          code: "JUDGE_REQUEST_BANNED",
          message:
            "Your previous judge request was rejected. You must wait until the active players change before trying again.",
        });
        return;
      }

      // If a vote is already in progress, reject new request.
      if (jr.currentVote) {
        socket.emit("error", {
          code: "JUDGE_REQUEST_PENDING",
          message: "A judge vote is already in progress.",
        });
        return;
      }

      // Prepare vote
      const confirmId = `judge_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}`;

      const voters = active.slice(); // all active players must vote
      const responses: Record<string, "yes" | "no" | "pending"> = {};
      for (const pid of voters) {
        responses[pid] = pid === requesterId ? "yes" : "pending";
      }

      jr.currentVote = {
        confirmId,
        requesterId,
        voters,
        responses,
      };

      // System chat: announce judge vote
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `Player ${requesterId} has requested to become judge. All active players must approve.`,
        ts: Date.now(),
      });

      // Emit request to all active players (reuse confirm-like payload)
      io.to(gameId).emit("judgeConfirmRequest", {
        gameId,
        confirmId,
        kind: "judge",
        initiator: requesterId,
        players: voters,
        responses,
      });
    } catch (err: any) {
      console.error("requestJudge handler failed:", err);
      socket.emit("error", {
        code: "JUDGE_REQUEST_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Player responds to judge vote
  socket.on(
    "judgeConfirmResponse",
    ({ gameId, confirmId, accept }: { gameId: string; confirmId: string; accept: boolean }) => {
      try {
        const game = ensureGame(gameId);
        const playerId = socket.data.playerId;
        if (!game || !playerId) return;

        const jr = getJudgeRuntime(game);
        const vote = jr.currentVote;
        if (!vote || vote.confirmId !== confirmId) {
          // stale / no-op
          return;
        }

        if (!vote.voters.includes(playerId)) {
          // Not a voter
          return;
        }

        const prev = vote.responses[playerId];
        if (prev !== "pending") {
          // Already voted
          return;
        }

        vote.responses[playerId] = accept ? "yes" : "no";

        // Broadcast update
        io.to(gameId).emit("judgeConfirmUpdate", {
          gameId,
          confirmId,
          responses: vote.responses,
        });

        // If any "no" → fail immediately
        const anyNo = Object.values(vote.responses).includes("no");
        if (anyNo) {
          // Mark requester as banned for current playerVersion
          const version = computeAndMaybeBumpPlayerVersion(game);
          jr.bannedRequesters.set(vote.requesterId, version);

          // Clear vote
          jr.currentVote = undefined;

          io.to(gameId).emit("judgeCancelled", {
            gameId,
            confirmId,
            reason: "Judge request was rejected by at least one player.",
          });

          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `Judge request for player ${vote.requesterId} was rejected.`,
            ts: Date.now(),
          });

          return;
        }

        // See if all are "yes"
        const allYes = Object.values(vote.responses).every((v) => v === "yes");
        if (!allYes) {
          return;
        }

        // Success: grant judge role
        jr.judgeId = vote.requesterId;
        jr.currentVote = undefined;

        // Optionally record engine-level event
        appendGameEvent(game, gameId, "judgeGranted", {
          judgeId: vote.requesterId,
        });

        // Broadcast judgeConfirmed
        io.to(gameId).emit("judgeConfirmed", {
          gameId,
          confirmId,
          judgeId: vote.requesterId,
        });

        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `Player ${vote.requesterId} is now acting as judge (full visibility).`,
          ts: Date.now(),
        });

        // Ensure sequence bumped before broadcast
        if (typeof (game as any).bumpSeq === "function") {
          try {
            (game as any).bumpSeq();
          } catch {
            /* ignore */
          }
        }

        broadcastGame(io, game, gameId);
      } catch (err: any) {
        console.error("judgeConfirmResponse handler failed:", err);
        socket.emit("error", {
          code: "JUDGE_CONFIRM_ERROR",
          message: err?.message ?? String(err),
        });
      }
    }
  );
}