import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, schedulePriorityTimeout } from "./util";
import { appendEvent } from "../db";
import { computeDiff } from "../utils/diff";
import { games } from "./socket";

export function registerJoinHandlers(io: Server, socket: Socket) {
  socket.on("joinGame", ({ gameId, playerName, spectator, seatToken }) => {
    const game = ensureGame(gameId);

    if (!game.hasRngSeed()) {
      const seed = (Date.now() ^ Math.random()) >>> 0;
      game.seedRng(seed);
      appendEvent(gameId, game.seq, "rngSeed", { seed });
    }

    const { playerId, added, seatToken: resolvedToken } = game.join(
      socket.id,
      playerName,
      Boolean(spectator),
      undefined,
      seatToken
    );

    socket.data = { gameId, playerId, spectator };
    socket.join(gameId);
    socket.emit("joined", { gameId, you: playerId, seatToken: resolvedToken });

    const view = game.viewFor(playerId, Boolean(spectator));
    socket.emit("state", { gameId, view, seq: game.seq });

    if (!spectator && added) {
      appendEvent(gameId, game.seq, "join", {
        playerId,
        name: playerName,
        seat: view.players.find((p) => p.id === playerId)?.seat,
        seatToken: resolvedToken,
      });
    }

    socket.to(gameId).emit("stateDiff", { gameId, diff: computeDiff(undefined, view, game.seq) });
    schedulePriorityTimeout(io, game, gameId);
  });

  socket.on("requestState", ({ gameId }) => {
    const game = games.get(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return;

    const view = game.viewFor(playerId, Boolean(socket.data.spectator));
    socket.emit("state", { gameId, view, seq: game.seq });
    schedulePriorityTimeout(io, game, gameId);
  });
}