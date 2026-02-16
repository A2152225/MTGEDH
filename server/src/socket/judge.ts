import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, appendGameEvent } from "./util";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import { ResolutionQueueManager, ResolutionStepType } from "../state/resolution/index.js";

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
    timeout?: NodeJS.Timeout | null;
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
    .filter((p) => !p.spectator && !p.isSpectator)
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

function cancelJudgeConfirmResolutionSteps(gameId: string, confirmId: string) {
  try {
    const queue = ResolutionQueueManager.getQueue(gameId);
    const ids = queue.steps
      .filter(
        (s) =>
          (s as any)?.judgeConfirm === true &&
          String((s as any)?.confirmId || "") === String(confirmId)
      )
      .map((s) => s.id);
    for (const id of ids) {
      ResolutionQueueManager.cancelStep(gameId, id);
    }
  } catch (err) {
    debugWarn(1, "cancelJudgeConfirmResolutionSteps failed", err);
  }
}

function enqueueJudgeConfirmToResolutionQueue(
  gameId: string,
  confirmId: string,
  requesterId: string,
  voters: string[],
  responses: Record<string, "yes" | "no" | "pending">,
  timeoutMs: number
) {
  try {
    for (const pid of voters) {
      // Requester is auto-yes in the legacy flow.
      if (pid === requesterId) continue;

      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, pid as any)
        .find(
          (s) =>
            (s as any)?.judgeConfirm === true &&
            String((s as any)?.confirmId || "") === String(confirmId)
        );
      if (existing) continue;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: pid as any,
        sourceName: "Judge Vote",
        description: `Approve player ${requesterId} as judge?`,
        mandatory: true,
        timeoutMs,
        options: [
          { id: "accept", label: "Approve" },
          { id: "decline", label: "Reject" },
        ],
        minSelections: 1,
        maxSelections: 1,

        judgeConfirm: true,
        kind: "judge",
        confirmId,
        initiator: requesterId,
        voters,
        responses,
      } as any);
    }
  } catch (err) {
    debugWarn(1, "enqueueJudgeConfirmToResolutionQueue failed", err);
  }
}

export function handleJudgeConfirmVote(
  io: Server,
  game: any,
  gameId: string,
  confirmId: string,
  voterId: string,
  accept: boolean
) {
  try {
    if (!game) return;
    const jr = getJudgeRuntime(game);
    const vote = jr.currentVote;
    if (!vote || vote.confirmId !== confirmId) return;
    if (!vote.voters.includes(voterId)) return;

    const prev = vote.responses[voterId];
    if (prev !== "pending") return;

    vote.responses[voterId] = accept ? "yes" : "no";

    io.to(gameId).emit("judgeConfirmUpdate", {
      gameId,
      confirmId,
      responses: vote.responses,
    });

    const anyNo = Object.values(vote.responses).includes("no");
    if (anyNo) {
      const version = computeAndMaybeBumpPlayerVersion(game);
      jr.bannedRequesters.set(vote.requesterId, version);

      if (vote.timeout) {
        try {
          clearTimeout(vote.timeout);
        } catch {
          // ignore
        }
      }

      jr.currentVote = undefined;
      cancelJudgeConfirmResolutionSteps(gameId, confirmId);

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

    const allYes = Object.values(vote.responses).every((v) => v === "yes");
    if (!allYes) return;

    // Success: grant judge role
    jr.judgeId = vote.requesterId;

    if (vote.timeout) {
      try {
        clearTimeout(vote.timeout);
      } catch {
        // ignore
      }
    }

    jr.currentVote = undefined;
    cancelJudgeConfirmResolutionSteps(gameId, confirmId);

    appendGameEvent(game, gameId, "judgeGranted", {
      judgeId: vote.requesterId,
    });

    io.to(gameId).emit("judgeConfirmed", {
      gameId,
      confirmId,
      judgeId: vote.requesterId,
    });

    // Tag judge role on sockets for this player in this game
    try {
      const judgeId = vote.requesterId;
      for (const [, s] of io.of("/").sockets) {
        try {
          if (s.data?.gameId === gameId && s.data?.playerId === judgeId) {
            (s.data as any).role = "judge";
          }
        } catch {
          // ignore per-socket errors
        }
      }
    } catch (e) {
      debugWarn(1, "Failed to tag judge role on sockets:", e);
    }

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `Player ${vote.requesterId} is now acting as judge (full visibility).`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === "function") {
      try {
        (game as any).bumpSeq();
      } catch {
        // ignore
      }
    }

    broadcastGame(io, game, gameId);
  } catch (err: any) {
    debugError(1, "handleJudgeConfirmVote failed:", err);
  }
}

/**
 * Register judge-related socket handlers.
 *
 * Flow:
 * - Client sends "requestJudge" (triggered via /judge in chat).
 * - Server checks ban conditions and starts a unanimous vote among active players.
 * - Emits:
 *   - (prompt is now via Resolution Queue OPTION_CHOICE)
 *   - "judgeConfirmUpdate"
 *   - "judgeCancelled"
 *   - "judgeConfirmed"
 */
export function registerJudgeHandlers(io: Server, socket: Socket) {
  // Request to become judge, typically from /judge chat command
  socket.on("requestJudge", (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;
    try {
      if (!gameId || typeof gameId !== 'string') return;
      if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
        socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
        return;
      }

      const game = ensureGame(gameId);
      const requesterId = socket.data.playerId;
      const spectator = !!(
        (socket.data as any)?.spectator || (socket.data as any)?.isSpectator
      );

      if (!game || !requesterId) return;

      // NOTE: spectators ARE allowed to request judge now.
      // We only restrict who votes (active non-spectator players), not who can ask.
      const jr = getJudgeRuntime(game);

      // If there is already a judge and it's this requester, reject.
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
        timeout: null,
      };

      // System chat: announce judge vote
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `Player ${requesterId} has requested to become judge. All active players must approve.`,
        ts: Date.now(),
      });

      // Prompt voters via Resolution Queue (per-player OPTION_CHOICE)
      const VOTE_TIMEOUT_MS = 60_000;
      enqueueJudgeConfirmToResolutionQueue(
        gameId,
        confirmId,
        requesterId,
        voters,
        responses,
        VOTE_TIMEOUT_MS
      );

      // Server-side timeout so votes don't hang indefinitely.
      jr.currentVote.timeout = setTimeout(() => {
        try {
          const game2 = ensureGame(gameId);
          if (!game2) return;
          const jr2 = getJudgeRuntime(game2);
          const v2 = jr2.currentVote;
          if (!v2 || v2.confirmId !== confirmId) return;

          jr2.currentVote = undefined;
          cancelJudgeConfirmResolutionSteps(gameId, confirmId);

          io.to(gameId).emit("judgeCancelled", {
            gameId,
            confirmId,
            reason: "Judge request timed out.",
          });

          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `Judge request for player ${requesterId} timed out.`,
            ts: Date.now(),
          });
        } catch (e) {
          debugWarn(1, "judge vote timeout handler failed", e);
        }
      }, VOTE_TIMEOUT_MS);
    } catch (err: any) {
      debugError(1, "requestJudge handler failed:", err);
      socket.emit("error", {
        code: "JUDGE_REQUEST_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });
}
