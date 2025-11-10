import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame } from "./util";
import { appendEvent } from "../db";
import type { PlayerID } from "../../shared/src";

export function registerCommanderHandlers(io: Server, socket: Socket) {
  socket.on("setCommander", async ({ gameId, commanderNames }) => {
    const pid: PlayerID = socket.data.playerId;
    if (!pid || socket.data.spectator) return;
    const game = ensureGame(gameId);

    // Set the chosen commander(s)
    await game.setCommander(pid, commanderNames, []);
    appendEvent(gameId, game.seq, "setCommander", {
      playerId: pid,
      commanderNames,
      commanderIds: [],
    });

    // Opening hand draw after selecting commander
    if (game.pendingInitialDraw && game.pendingInitialDraw.has(pid)) {
      game.shuffleLibrary(pid);
      appendEvent(gameId, game.seq, "shuffleLibrary", { playerId: pid });
      game.drawCards(pid, 7);
      appendEvent(gameId, game.seq, "drawCards", { playerId: pid, count: 7 });
      game.pendingInitialDraw.delete(pid);
      broadcastGame(io, game, gameId);
    } else {
      broadcastGame(io, game, gameId);
    }
  });
}