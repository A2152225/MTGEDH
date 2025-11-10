import type { Server, Socket } from "socket.io";
import { fetchCardByExactNameStrict } from "../services/scryfall";
import { ensureGame, broadcastGame } from "./util";
import { appendEvent } from "../db";

export function registerCommanderHandlers(io: Server, socket: Socket) {
  socket.on("setCommander", async ({ gameId, commanderNames }) => {
    const playerId = socket.data.playerId;
    const game = ensureGame(gameId);
    if (!playerId || !game) return;

    const ids = [];
    for (const name of commanderNames) {
      try {
        const card = await fetchCardByExactNameStrict(name);
        ids.push(card.id);
      } catch {
        // Ignore not found
      }
    }

    game.applyEvent({ type: "setCommander", playerId, commanderNames, commanderIds: ids });
    appendEvent(gameId, game.seq, "setCommander", { playerId, commanderNames, commanderIds: ids });
    broadcastGame(io, game, gameId);
  });
}