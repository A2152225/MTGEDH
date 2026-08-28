/**
 * Origin parent: server/src/socket/ai-handlers/aiGameFlowHandlers.ts
 *
 * Cluster moved: persist + broadcast the same keepHand bookkeeping humans use,
 * so a pre-game AI keep survives resume and shows up in client mulliganState.
 *
 * Public entry symbols: commitAIKeepHand.
 * Leaf must not import ai.ts or ai-handlers/index.ts.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { appendEvent } from "../../db/index.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { tryAutoStartGameFromPreGame } from "../pregame-auto-start.js";
import { getPlayerName } from "../util-handlers/getPlayerName.js";
import { broadcastGame } from "../util.js";

export async function commitAIKeepHand(
  io: Server,
  game: any,
  gameId: string,
  playerId: PlayerID,
  mulligansTaken: number,
  reason: string,
): Promise<void> {
  (game.state as any).mulliganState = (game.state as any).mulliganState || {};
  (game.state as any).mulliganState[playerId] = {
    hasKeptHand: true,
    mulligansTaken,
    pendingBottomCount: 0,
    pendingBottomStepId: null,
  };

  if (typeof (game as any).bumpSeq === "function") {
    (game as any).bumpSeq();
  }

  try {
    await appendEvent(gameId, (game as any).seq || 0, "keepHand", {
      playerId,
      mulligansTaken,
      isAI: true,
    });
  } catch (e) {
    debugWarn(1, "[AI] Failed to persist keepHand event:", e);
  }

  try {
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, playerId)} keeps their hand.`,
      ts: Date.now(),
    });
  } catch {
    /* best-effort */
  }

  debug(1, "[AI] AI is ready to start game (hand kept)", { gameId, playerId, reason });
  broadcastGame(io, game, gameId);
  await tryAutoStartGameFromPreGame(io, game, gameId, reason);
}
