import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame } from "./util";
import { appendEvent } from "../db";
import type { PlayerID } from "../../shared/src";

/**
 * Handler for commander selection.
 *
 * Accepts payloads shaped as:
 *  - { gameId, commanderNames: string[] }
 *  - { gameId, names: string[] }
 *  - { gameId, commanderNames: string[], commanderIds: string[] }
 *
 * Backwards-compatible: will accept either `commanderNames` or `names` keys from the client.
 */
export function registerCommanderHandlers(io: Server, socket: Socket) {
  socket.on(
    "setCommander",
    async (payload: {
      gameId: string;
      commanderNames?: string[] | string;
      names?: string[] | string;
      commanderIds?: string[];
      colorIdentity?: ("W" | "U" | "B" | "R" | "G")[];
    }) => {
      try {
        const pid: PlayerID = socket.data.playerId;
        if (!pid || socket.data.spectator) return;

        const game = ensureGame(payload.gameId);
        if (!game) return;

        // Support multiple payload shapes (commanderNames, names or single string)
        let names: string[] = [];
        if (Array.isArray(payload.commanderNames)) names = payload.commanderNames.slice();
        else if (Array.isArray(payload.names)) names = payload.names.slice();
        else if (typeof payload.commanderNames === "string") names = [payload.commanderNames];
        else if (typeof payload.names === "string") names = [payload.names];

        const ids = Array.isArray(payload.commanderIds) ? payload.commanderIds.slice() : [];

        // Call authoritative state API. game.setCommander is expected to handle:
        // - placing commander ids/names into command zone
        // - removing the chosen commander card(s) from the library/zones if present
        // - preserving taxById and other bookkeeping
        try {
          // If client sent commanderIds prefer them, otherwise pass empty array and let server map names -> ids
          await game.setCommander(pid, names, ids, payload.colorIdentity);
        } catch (err) {
          // If state-level setCommander threw, still append event to persist attempt and rethrow/log
          console.error("setCommander failed in game state:", err);
          // Proceed to append event and broadcast best-effort
        }

        appendEvent(payload.gameId, game.seq, "setCommander", {
          playerId: pid,
          commanderNames: names,
          commanderIds: ids
        });

        // If player was flagged for pending opening draw (import triggered), perform shuffle+draw
        // pendingInitialDraw is a Set<PlayerID> created/managed during deck import flow
        // (ensureGame returns InMemoryGame which exposes pendingInitialDraw or equivalent)
        // Some modular state implementations have flagPendingOpeningDraw; we use presence on game object.
        try {
          // many implementations expose pendingInitialDraw as a Set on the InMemoryGame; guard for presence
          const pendingSet = (game as any).pendingInitialDraw as Set<PlayerID> | undefined;
          if (pendingSet && pendingSet.has(pid)) {
            // remove chosen commander(s) already handled by game.setCommander; now shuffle and draw
            game.shuffleLibrary(pid);
            appendEvent(payload.gameId, game.seq, "shuffleLibrary", { playerId: pid });
            game.drawCards(pid, 7);
            appendEvent(payload.gameId, game.seq, "drawCards", { playerId: pid, count: 7 });
            pendingSet.delete(pid);
          }
        } catch (err) {
          console.error("Error while handling pending opening draw after setCommander:", err);
        }

        // Broadcast authoritative updated view
        broadcastGame(io, game, payload.gameId);
      } catch (err) {
        console.error("Error in setCommander socket handler:", err);
        // best-effort: emit error to requesting socket only
        socket.emit("error", { message: "Failed to set commander" });
      }
    }
  );
}