/**
 * socket/resolution-handlers/optionChoiceCastFromGraveyardPrompts.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleOptionChoiceResponse).
 * Cluster moved: the two generic "you may play / cast that card from your graveyard" OPTION_CHOICE
 * prompts - `playFromGraveyardCardId` (routes a land through handlePlayLandRequest and anything else
 * through requestCastSpellForSocket) and `castFromGraveyardCardId` (always a cast). Both persist a
 * castFromGraveyardPromptResolve event whether the player accepted or declined.
 * Public entry symbols: handlePlayFromGraveyardPromptChoice, handleCastFromGraveyardPromptChoice.
 *
 * The private `appendCastFromGraveyardPromptResolveEvent` helper came along; these were its only
 * callers. Both branches always returned, so each call site is `await handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import type {
  ResolutionStep,
  ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debugWarn } from "../../utils/debug.js";
import { handlePlayLandRequest, requestCastSpellForSocket } from "../game-actions.js";
import { emitToPlayer } from "../util.js";
import { extractOptionChoiceSelectionId } from "./resolutionOptionChoiceSelectionIds.js";

function appendCastFromGraveyardPromptResolveEvent(
  gameId: string,
  game: any,
  payload: Record<string, unknown>
): void {
  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'castFromGraveyardPromptResolve', payload);
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(castFromGraveyardPromptResolve) failed:', err);
  }
}

/** Generic: "You may play <that card> from your graveyard." */
export async function handlePlayFromGraveyardPromptChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = extractOptionChoiceSelectionId(response.selections) || 'decline';
  const graveyardCardId = String(stepData.playFromGraveyardCardId);
  const zones = game.state?.zones?.[playerId];
  const graveyard = Array.isArray(zones?.graveyard) ? zones.graveyard : [];
  const cardIndex = graveyard.findIndex((c: any) => c?.id === graveyardCardId);

  if (choiceId === 'play') {
    const cardSnapshot = stepData.playFromGraveyardCard;
    const typeLine = String(cardSnapshot?.type_line || cardSnapshot?.typeLine || '').toLowerCase();
    const isLandCard = /\bland\b/.test(typeLine);

    if (!zones || !Array.isArray(zones.graveyard)) {
      debugWarn(2, `[Resolution] Play-from-graveyard: No graveyard found for player ${playerId}`);
    } else if (cardIndex === -1) {
      debugWarn(2, `[Resolution] Play-from-graveyard: Card ${graveyardCardId} not found in graveyard`);
    } else if (isLandCard) {
      const fakeSocket: any = {
        data: { playerId, spectator: false, gameId },
        rooms: new Set([gameId]),
        emit: (event: string, payload: unknown) => {
          emitToPlayer(io, playerId as any, event as any, payload);
        },
      };

      handlePlayLandRequest(io, fakeSocket, {
        gameId,
        cardId: graveyardCardId,
        fromZone: 'graveyard',
        bypassGraveyardPermissionCheck: true,
      });
    } else {
      const castWithoutPayingManaCost = stepData.playFromGraveyardWithoutPayingManaCost === true;
      const exileAfterResolution = stepData.playFromGraveyardExileAfterResolution === true
        || stepData.playFromGraveyardCard?.exileAfterResolution === true;
      const fakeSocket: any = {
        data: { playerId, spectator: false },
        emit: (event: string, payload: unknown) => {
          emitToPlayer(io, playerId as any, event as any, payload);
        },
      };

      await requestCastSpellForSocket(
        io,
        fakeSocket,
        { gameId, cardId: graveyardCardId, fromZone: 'graveyard' },
        {
          skipPriorityCheck: true,
          forcedAlternateCostId: castWithoutPayingManaCost ? 'free' : undefined,
          castWithoutPayingManaCost,
          exileAfterResolution,
          ignoreTimingRestrictions: true,
        }
      );
    }
  }

  appendCastFromGraveyardPromptResolveEvent(gameId, game, {
    playerId,
    sourceId: String((step as any).sourceId || '').trim(),
    resolvedStepId: String((step as any).id || '').trim(),
    cardId: graveyardCardId,
    choice: choiceId === 'play' ? 'play' : 'decline',
  });

  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }
}

/** Generic: "You may cast <that card> from your graveyard." */
export async function handleCastFromGraveyardPromptChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = extractOptionChoiceSelectionId(response.selections) || 'decline';
  const graveyardCardId = String(stepData.castFromGraveyardCardId);
  const zones = game.state?.zones?.[playerId];
  const graveyard = Array.isArray(zones?.graveyard) ? zones.graveyard : [];
  const cardIndex = graveyard.findIndex((c: any) => c?.id === graveyardCardId);

  if (choiceId === 'cast') {
    const castWithoutPayingManaCost = stepData.castFromGraveyardWithoutPayingManaCost === true;
    const exileAfterResolution = stepData.castFromGraveyardExileAfterResolution === true
      || stepData.castFromGraveyardCard?.exileAfterResolution === true;
    if (!zones || !Array.isArray(zones.graveyard)) {
      debugWarn(2, `[Resolution] Cast-from-graveyard: No graveyard found for player ${playerId}`);
    } else if (cardIndex === -1) {
      debugWarn(2, `[Resolution] Cast-from-graveyard: Card ${graveyardCardId} not found in graveyard`);
    } else {
      const fakeSocket: any = {
        data: { playerId, spectator: false },
        emit: (event: string, payload: unknown) => {
          emitToPlayer(io, playerId as any, event as any, payload);
        },
      };

      await requestCastSpellForSocket(
        io,
        fakeSocket,
        { gameId, cardId: graveyardCardId, fromZone: 'graveyard' },
        {
          skipPriorityCheck: true,
          forcedAlternateCostId: castWithoutPayingManaCost ? 'free' : undefined,
          castWithoutPayingManaCost,
          exileAfterResolution,
          ignoreTimingRestrictions: true,
        }
      );
    }
  }

  appendCastFromGraveyardPromptResolveEvent(gameId, game, {
    playerId,
    sourceId: String((step as any).sourceId || '').trim(),
    resolvedStepId: String((step as any).id || '').trim(),
    cardId: graveyardCardId,
    choice: choiceId === 'cast' ? 'cast' : 'decline',
  });

  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }
}
