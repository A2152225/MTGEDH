/**
 * OPTION_CHOICE handler for the demonstrate prompt queued after the spell is stacked.
 * Public: tryHandleDemonstrateChoice.
 */
import type { Server } from "socket.io";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import {
  parseDemonstrateOpponentChoice,
  stampOnCastKeywordFlags,
} from "../../state/modules/onCastKeywordPrompts.js";
import { copyStackItemForOnCastKeyword } from "../../state/modules/onCastKeywordsAfterStack.js";
import { extractOptionChoiceSelectionId } from "./resolutionOptionChoiceSelectionIds.js";
import { broadcastGame } from "../util.js";

export async function tryHandleDemonstrateChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const stepData = step as any;
  if (stepData?.demonstratePrompt !== true && String(stepData?.additionalCostKeyword || '') !== 'demonstrate') {
    return false;
  }
  const choiceId = String(extractOptionChoiceSelectionId(response.selections) || 'decline');
  const opponentId = parseDemonstrateOpponentChoice(choiceId);
  const playerId = String(response.playerId);
  const stackItemId = String(stepData.sourceId || '');
  const stack: any[] = Array.isArray(game?.state?.stack) ? game.state.stack : [];
  const item = stack.find((entry: any) => entry && String(entry.id || '') === stackItemId) || null;
  if (!item) {
    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }
  if (!opponentId) {
    stampOnCastKeywordFlags(item, { demonstrateResolved: true, demonstratePaid: false });
  } else {
    stampOnCastKeywordFlags(item, {
      demonstrateResolved: true,
      demonstratePaid: true,
      demonstrateOpponentId: opponentId,
    });
    copyStackItemForOnCastKeyword(game, gameId, item, playerId, 'DemonstrateYou');
    copyStackItemForOnCastKeyword(game, gameId, item, opponentId, 'DemonstrateOpponent');
  }
  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastGame(io, game, gameId);
  return true;
}
