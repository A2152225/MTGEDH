/**
 * socket/resolution-handlers/panglacialSearchCastHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (library-search Panglacial Wurm cast).
 * Cluster moved: handlePanglacialWurmSearchCast.
 * Public entry symbols: handlePanglacialWurmSearchCast.
 *
 * Must not import resolution.ts.
 */

import type { Server, Socket } from "socket.io";
import { ResolutionQueueManager, type ResolutionStep } from "../../state/resolution/index.js";
import { isTrueLibrarySearchStep } from "../resolutionLibrarySearchHandlers.js";
import { requestCastSpellForSocket } from "../game-actions.js";
import { broadcastGame } from "../util.js";
import { PANGLACIAL_WURM_NAME, restoreLibrarySearchStep } from "./panglacialSearchCastUtils.js";
import { sanitizeStepForClient } from "./sanitizeStepForClient.js";

export async function handlePanglacialWurmSearchCast(
  io: Server,
  socket: Socket,
  game: any,
  gameId: string,
  step: ResolutionStep,
  playerId: string,
  cardId: string,
): Promise<void> {
  const searchStep = step as any;
  if (!isTrueLibrarySearchStep(searchStep)) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'This search does not allow casting Panglacial Wurm.' });
    return;
  }

  const library = Array.isArray((game as any).libraries?.get(playerId))
    ? ((game as any).libraries.get(playerId) as any[])
    : (Array.isArray((game as any)?.state?.zones?.[playerId]?.library)
      ? ((game as any).state.zones[playerId].library as any[])
      : []);

  const panglacialCard = library.find((card: any) =>
    String(card?.id || '') === String(cardId) && String(card?.name || '').trim().toLowerCase() === PANGLACIAL_WURM_NAME
  );

  if (!panglacialCard) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Panglacial Wurm is not in your library.' });
    return;
  }

  const queue = ResolutionQueueManager.getQueue(gameId);
  const existingIndex = queue.steps.findIndex((entry: any) => String(entry?.id || '') === String(step.id));
  if (existingIndex < 0) {
    socket.emit('error', { code: 'STEP_NOT_FOUND', message: 'Resolution step not found' });
    return;
  }

  const [suspendedStep] = queue.steps.splice(existingIndex, 1);
  if ((queue as any).activeStep && String((queue as any).activeStep.id || '') === String(step.id)) {
    (queue as any).activeStep = undefined;
  }

  await requestCastSpellForSocket(
    io,
    socket,
    {
      gameId,
      cardId,
      fromZone: 'library',
    },
    {
      skipPriorityCheck: true,
      librarySearchStepToResume: suspendedStep,
    },
  );

  const nextPendingStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any)[0] as any;
  if (!nextPendingStep) {
    restoreLibrarySearchStep(gameId, suspendedStep);
    socket.emit('resolutionStepPrompt', {
      gameId,
      step: sanitizeStepForClient(gameId, suspendedStep),
    });
    return;
  }

  socket.emit('resolutionStepPrompt', {
    gameId,
    step: sanitizeStepForClient(gameId, nextPendingStep),
  });
  broadcastGame(io, game, gameId);
}
