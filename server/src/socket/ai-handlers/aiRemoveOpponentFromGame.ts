/**
 * Origin parent: server/src/socket/ai-handlers/aiRegisterHandlers.ts
 *
 * Cluster moved: pre-game remove of a seated AI opponent (removeAIFromGame).
 *
 * Public entry symbols: removeAIOpponentFromExistingGame.
 * Leaf must not import ai.ts or ai-handlers/index.ts.
 */
import type { Server } from "socket.io";
import { debug, debugWarn } from "../../utils/debug.js";
import { removeLeavingPlayerGameObjects } from "../../state/modules/playerLeavingGame.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { tryAutoStartGameFromPreGame } from "../pregame-auto-start.js";
import { appendGameEvent } from "../util-handlers/appendGameEvent.js";
import { broadcastGame } from "../util.js";
import { unregisterAIPlayer } from "./aiPlayerRegistry.js";

export type RemoveAIOpponentFromGameResult =
  | { ok: true; aiPlayerId: string; aiName: string }
  | { ok: false; code: string; message: string };

function isPreGamePhase(game: any): boolean {
  const phaseStr = String(game?.state?.phase || "").toUpperCase().trim().replace(/[-\s]/g, "_");
  return phaseStr === "" || phaseStr === "PRE_GAME" || phaseStr === "PREGAME";
}

function getActivePlayers(game: any): any[] {
  return (game?.state?.players || []).filter(
    (p: any) => p && !p.spectator && !p.isSpectator,
  );
}

function allPlayersKeptHands(game: any): boolean {
  const mulliganState = (game?.state as any)?.mulliganState || {};
  const active = getActivePlayers(game);
  if (active.length === 0) return false;
  for (const player of active) {
    const playerMulliganState = mulliganState[player.id];
    if (!playerMulliganState?.hasKeptHand) return false;
    if (Number(playerMulliganState.pendingBottomCount || 0) > 0) return false;
  }
  return true;
}

function scrubRemovedAiBookkeeping(game: any, aiPlayerId: string): void {
  const state = game?.state || {};
  if (state.mulliganState && typeof state.mulliganState === "object") {
    delete state.mulliganState[aiPlayerId];
  }
  if (state.commandZone && typeof state.commandZone === "object") {
    delete state.commandZone[aiPlayerId];
  }
  if ((game as any).commandZone && typeof (game as any).commandZone === "object") {
    delete (game as any).commandZone[aiPlayerId];
  }
  if (state.aiDeckProfiles && typeof state.aiDeckProfiles === "object") {
    delete state.aiDeckProfiles[aiPlayerId];
  }
  if (state.landsPlayedThisTurn && typeof state.landsPlayedThisTurn === "object") {
    delete state.landsPlayedThisTurn[aiPlayerId];
  }
  if (Array.isArray(state.turnOrder)) {
    state.turnOrder = state.turnOrder.filter((id: unknown) => String(id) !== aiPlayerId);
  }
  if (String(state.turnPlayer || "") === aiPlayerId) {
    const next = getActivePlayers(game)[0];
    state.turnPlayer = next?.id || "";
  }
  if (String(state.startingPlayerId || "") === aiPlayerId) {
    delete state.startingPlayerId;
    delete state.startingPlayer;
  }
  const energy = (game as any).energy || state.energy;
  if (energy && typeof energy === "object") delete energy[aiPlayerId];
}

/**
 * Drop a seated AI opponent from a pre-game table so the host can change
 * decks by remove-and-re-add. Persists `removePlayer` for resume/replay.
 */
export async function removeAIOpponentFromExistingGame(
  io: Server,
  game: any,
  gameId: string,
  aiPlayerId: string,
): Promise<RemoveAIOpponentFromGameResult> {
  if (!isPreGamePhase(game) || (game.state as any)?._pregameAutoStartInProgress) {
    return {
      ok: false,
      code: "AI_NOT_PREGAME",
      message: "AI opponents can only be removed during pre-game, before the game starts.",
    };
  }
  if (allPlayersKeptHands(game)) {
    return {
      ok: false,
      code: "AI_HANDS_LOCKED",
      message: "Cannot remove AI after every player has kept their hand. Unlock a hand first.",
    };
  }

  const target = getActivePlayers(game).find((p: any) => String(p?.id || "") === aiPlayerId);
  if (!target || target.isAI !== true) {
    return {
      ok: false,
      code: "AI_NOT_FOUND",
      message: "That seat is not an AI opponent.",
    };
  }

  const aiName = String(target.name || "AI Opponent");

  unregisterAIPlayer(gameId, aiPlayerId);
  try {
    ResolutionQueueManager.clearStepsForPlayer(gameId, aiPlayerId as any);
  } catch (err) {
    debugWarn(1, "[AI] Failed to clear resolution steps for removed AI:", err);
  }
  try {
    removeLeavingPlayerGameObjects(game.state, aiPlayerId, { gameId });
  } catch (err) {
    debugWarn(1, "[AI] Failed to clean objects for removed AI:", err);
  }

  appendGameEvent(game, gameId, "removePlayer", { playerId: aiPlayerId });
  if (Array.isArray(game.state?.players) && game.state.players.some((p: any) => p?.id === aiPlayerId)) {
    game.state.players = game.state.players.filter((p: any) => p?.id !== aiPlayerId);
  }
  scrubRemovedAiBookkeeping(game, aiPlayerId);

  try {
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${aiName} was removed from the table.`,
      ts: Date.now(),
    });
  } catch {
    /* best-effort */
  }

  broadcastGame(io, game, gameId);
  debug(1, "[AI] Removed AI opponent from pre-game table:", { gameId, aiPlayerId, aiName });

  try {
    await tryAutoStartGameFromPreGame(io, game, gameId, "removeAIFromGame");
  } catch (err) {
    debugWarn(1, "[AI] tryAutoStart after removing AI failed:", err);
  }

  return { ok: true, aiPlayerId, aiName };
}
