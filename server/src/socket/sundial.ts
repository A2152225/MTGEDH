import type { Server, Socket } from "socket.io";
import { ensureGame, appendGameEvent, broadcastGame } from "./util";
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

      const playerId = (socket.data && (socket.data as any).playerId) as string | undefined;
      if (!playerId) {
        socket.emit("error", { code: "SUNDIAL", message: "Not authenticated" });
        return;
      }

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("error", { code: "SUNDIAL", message: "Game not found" });
        return;
      }

      // Looser permission: accept if player controls a battlefield permanent named 'sundial'
      // OR has a commander/hand/graveyard card with 'sundial' in name (case-insensitive).
      const bf = (game.state && (game.state as any).battlefield) || [];
      const zones = (game as any).state?.zones || {};
      const cz = (game as any).state?.commandZone || {};

      const nameMatches = (n?: string) => (typeof n === "string" && n.toLowerCase().includes("sundial"));

      let allowed = false;

      try {
        // battlefield control
        if (Array.isArray(bf) && bf.some((perm: any) => perm.controller === playerId && nameMatches(perm.card?.name))) allowed = true;

        // commander in command zone
        const czInfo = cz[playerId];
        if (!allowed && czInfo && Array.isArray(czInfo.commanderCards) && czInfo.commanderCards.some((c: any) => nameMatches(c.name))) allowed = true;

        // hand / graveyard / other zones (loose permission)
        const playerZones = zones[playerId] || {};
        if (!allowed && Array.isArray(playerZones.hand) && playerZones.hand.some((c: any) => nameMatches(c?.name))) allowed = true;
        if (!allowed && Array.isArray(playerZones.graveyard) && playerZones.graveyard.some((c: any) => nameMatches(c?.name))) allowed = true;
      } catch (err) {
        // defensive: do not fail permission check on unexpected shapes
        debugWarn(1, "sundialActivate: permisssion check failed shape test", err);
      }

      if (!allowed) {
        // Looser fallback: allow if the caller is an active player (optionally), else deny.
        // Here we choose to allow activations from any joined player (loose mode) but still log this.
        // If you prefer stricter: set allowed = false and reject.
        debugWarn(2, `sundialActivate: ${playerId} did not match strict sundial ownership, allowing in loose mode.`);
        allowed = true;
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

      // Handle requested action
      try {
        if (action === "endTurn") {
          game.nextTurn();
        } else if (action === "cleanup") {
          try {
            // set state.step to CLEANUP and bump seq via nextStep to roll to nextTurn on next invocation
            (game.state as any).step = GameStep.CLEANUP as any;
            // optional: call game.nextStep() here to immediately roll to nextTurn
            // game.nextStep();
            // we'll persist a note
          } catch (err) {
            debugWarn(1, "sundialActivate cleanup: failed to set CLEANUP", err);
          }
        } else if (action === "skipSteps" && Array.isArray(skipSteps) && skipSteps.length) {
          try {
            // ask game wrapper to remove scheduled steps (string list)
            if (typeof (game as any).removeScheduledSteps === "function") {
              const removed = (game as any).removeScheduledSteps(skipSteps);
              debug(2, "sundialActivate removed scheduled steps count:", removed);
            } else {
              // Fallback: clear all scheduled steps if fine-grained removal not available
              if (typeof (game as any).clearScheduledSteps === "function") (game as any).clearScheduledSteps();
            }
          } catch (err) {
            debugWarn(1, "sundialActivate skipSteps failed", err);
          }
        } else {
          // unknown action: log
          debugWarn(2, "sundialActivate: unknown action", action);
        }
      } catch (err) {
        debugWarn(1, "sundialActivate: action handling failed", err);
      }

      // Persist the activation
      try {
        appendGameEvent(game, gameId, "sundialActivated", { by: playerId, exiled: exiledCount, action, skipSteps });
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


