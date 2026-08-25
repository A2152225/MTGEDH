/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: registerInteractionHandlers socket handler for
 * requestGraveyardView.
 *
 * Public entry symbols: handleGraveyardViewRequest.
 */
import type { Server, Socket } from "socket.io";
import { ensureGame } from "../util";

// Get graveyard contents for viewing
export async function handleGraveyardViewRequest(
  io: Server,
  socket: Socket,
  payload?: { gameId?: unknown; targetPlayerId?: unknown },
): Promise<void> {
    const gameId = payload?.gameId;
    const targetPlayerId = payload?.targetPlayerId;
  const pid = socket.data.playerId as string | undefined;
  if (!pid) return;

  if (!gameId || typeof gameId !== 'string') return;
  if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
    socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
    return;
  }

  const game = ensureGame(gameId);
  const targetPid = typeof targetPlayerId === 'string' && targetPlayerId ? targetPlayerId : pid;
  const zones = (game.state as any)?.zones?.[targetPid];
  
  if (!zones) {
    socket.emit("graveyardView", { gameId, playerId: targetPid, cards: [] });
    return;
  }
  
  const graveyard = Array.isArray(zones.graveyard) ? zones.graveyard : [];
  
  socket.emit("graveyardView", {
    gameId,
    playerId: targetPid,
    cards: graveyard,
  });
}
