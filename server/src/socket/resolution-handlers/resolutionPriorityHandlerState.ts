/**
 * socket/resolution-handlers/resolutionPriorityHandlerState.ts
 *
 * Origin parent: server/src/socket/resolution.ts (module-level priority-handler bindings).
 * Shared mutable IO handle used by initializePriorityResolutionHandler and
 * scheduleResolutionStepTimeoutForGame. Must not import resolution.ts.
 */

import type { Server } from "socket.io";

export const priorityResolutionHandlerState: {
  initialized: boolean;
  io: Server | null;
} = {
  initialized: false,
  io: null,
};
