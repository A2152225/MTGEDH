import type { Server, Socket } from "socket.io";
import {
  ensureGame,
  appendGameEvent,
  broadcastGame,
  getOrInitManaPool,
  validateAndConsumeManaCostFromPool,
} from "./util";
import { GameStep } from "../../../shared/src";
import { debug, debugWarn, debugError } from "../utils/debug.js";

/**
 * Payload:
 *  { gameId: string, action?: 'endTurn' | 'cleanup' | 'skipSteps', skipSteps?: string[] }
 *
 * action:
 *  - 'endTurn' (default): exile stack then immediately nextTurn()
 *  - 'cleanup': exile stack then set step = CLEANUP (client / nextStep may advance)
 *  - 'skipSteps': exile stack then remove any scheduled steps named in skipSteps (string names)
 */
export default function registerSundialHandlers(io: Server, socket: Socket) {
  socket.on("sundialActivate", async (payload: { gameId?: string; action?: string; skipSteps?: string[] }) => {
    try {
      const { gameId, action = "endTurn", skipSteps } = payload || ({} as any);
      if (!gameId) {
        socket.emit("error", { code: "SUNDIAL", message: "Missing gameId" });
        return;
      }

        if (action !== "endTurn") {
          socket.emit?.("error", { code: "INVALID_ACTION", message: "Unsupported action." });
          return;
        }

      if ((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) {
        socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
        return;
      }

      if (!(socket as any)?.rooms?.has?.(gameId)) {
        socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
        return;
      }

      const playerId = (socket.data && (socket.data as any).playerId) as string | undefined;
      if (!playerId) {
        socket.emit("error", { code: "SUNDIAL", message: "Not authenticated" });
        return;
      }

      const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
      if (socketIsSpectator) {
        socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' });
        return;
      }

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("error", { code: "SUNDIAL", message: "Game not found" });
        return;
      }

      const players = (game.state as any)?.players;
      const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === playerId) : undefined;
      if (!seated || seated.isSpectator || seated.spectator) {
        socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' });
        return;
      }

      // Strict permission: the player must control an untapped battlefield permanent named
      // "Sundial of the Infinite" and have priority to activate it.
      const bf = (game.state && (game.state as any).battlefield) || [];
      const nameMatches = (n?: string) =>
        typeof n === "string" && n.toLowerCase().includes("sundial of the infinite");

      let sundialPerm: any | undefined;
      try {
        if (Array.isArray(bf)) {
          sundialPerm = bf.find(
            (perm: any) => perm && perm.controller === playerId && nameMatches(perm.card?.name)
          );
        }
      } catch (err) {
        debugWarn(1, "sundialActivate: permission check failed shape test", err);
      }

      if (!sundialPerm) {
        socket.emit?.("error", { code: "NOT_AUTHORIZED", message: "Not authorized." });
        return;
      }

      if ((sundialPerm as any).tapped) {
        socket.emit?.("error", { code: "INVALID_ACTION", message: "Sundial is tapped." });
        return;
      }

      const statePriority = (game.state as any)?.priority;
      if (!statePriority || String(statePriority) !== String(playerId)) {
        socket.emit?.("error", { code: "INVALID_ACTION", message: "You don't have priority." });
        return;
      }

      // Pay {1} from floating mana pool and tap the Sundial.
      const pool = getOrInitManaPool(game.state as any, String(playerId));
      const payment = validateAndConsumeManaCostFromPool(pool as any, "{1}", { logPrefix: "[sundialActivate]" });
      if (payment.ok === false) {
        socket.emit?.("error", { code: "INVALID_ACTION", message: payment.error });
        return;
      }

      try {
        (sundialPerm as any).tapped = true;
      } catch {
        // best-effort
      }

      if (typeof (game as any).bumpSeq === "function") {
        try {
          (game as any).bumpSeq();
        } catch {
          // ignore
        }
      }

      // Perform exiling of the stack
      let exiledCount = 0;
      try {
        if (typeof (game as any).exileStack === "function") {
          exiledCount = (game as any).exileStack(playerId);
        } else {
          debugWarn(2, "sundialActivate: exileStack not available on game object");
        }
      } catch (err) {
        debugWarn(2, "sundialActivate: exileStack threw", err);
      }

      // End the turn
      try {
        game.nextTurn();
      } catch (err) {
        debugWarn(1, "sundialActivate: nextTurn failed", err);
      }

      // Persist the activation
      try {
        appendGameEvent(game, gameId, "sundialActivated", {
          by: playerId,
          exiled: exiledCount,
          action,
          skipSteps,
          paid: "{1}",
          tapped: true,
        });
      } catch (err) {
        debugWarn(1, "sundialActivate: appendGameEvent failed", err);
      }

      // Broadcast updated state
      broadcastGame(io, game, gameId);
    } catch (err) {
      debugError(1, "sundialActivate handler error:", err);
      socket.emit("error", { code: "SUNDIAL", message: (err && (err as Error).message) || "Sundial activation failed" });
    }
  });
}


