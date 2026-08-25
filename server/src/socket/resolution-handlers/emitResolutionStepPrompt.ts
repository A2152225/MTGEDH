/**
 * socket/resolution-handlers/emitResolutionStepPrompt.ts
 *
 * Origin parent: server/src/socket/resolution.ts (registerResolutionHandlers).
 * Cluster moved: emitResolutionStepPrompt.
 * Public entry symbols: emitResolutionStepPrompt.
 *
 * Must not import resolution.ts.
 */

import type { Socket } from "socket.io";
import type { ResolutionStep } from "../../state/resolution/index.js";
import { isLoopShortcutBroadcastSuppressed } from "../loopShortcutSustain.js";
import { ensureGame } from "../util.js";
import { sanitizeStepForClient } from "./sanitizeStepForClient.js";

/**
 * Sanitize a resolution step for sending to the client
 * Removes internal data and formats for client consumption
 */
export function emitResolutionStepPrompt(socket: Socket, gameId: string, step: ResolutionStep): void {
  try {
    const game = ensureGame(gameId);
    if (isLoopShortcutBroadcastSuppressed(game)) return;
  } catch {
    // continue
  }
  socket.emit("resolutionStepPrompt", {
    gameId,
    step: sanitizeStepForClient(gameId, step),
  });
}
