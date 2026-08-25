/**
 * socket/resolution-handlers/optionChoiceChoosePlayerPrompts.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleOptionChoiceResponse).
 * Cluster moved: the two OPTION_CHOICE prompts whose selection is a *player* who then gets the real
 * prompt - `choosePlayerForTwoPileSplitChoice` (queue the TWO_PILE_SPLIT for the chosen opponent,
 * forwarding every choosePileFromSplit* rider so the later pick knows what to do with each pile) and
 * `choosePlayerForLookedAtCardsChoice` (queue the destination OPTION_CHOICE over the looked-at cards
 * for the chosen player).
 * Public entry symbols: handleChoosePlayerForTwoPileSplitChoice,
 * handleChoosePlayerForLookedAtCardsChoice.
 *
 * The prompts these queue are handled by `optionChoiceLookedAtCardsAndPileHandlers.ts`.
 * Both branches always returned, so each call site is `await handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { debugWarn } from "../../utils/debug.js";
import { appendQueuedResolutionPromptEvent } from "../resolutionCloneQueuedPromptUtils.js";
import { getPlayerName } from "../util.js";
import { extractOptionChoiceSelectionId } from "./resolutionOptionChoiceSelectionIds.js";

/** "Choose an opponent. That player separates the cards into two piles." */
export async function handleChoosePlayerForTwoPileSplitChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = response.playerId;

  const chosenOpponentId = extractOptionChoiceSelectionId(response.selections);
  const controllerId = String(stepData.choosePlayerForTwoPileSplitController || playerId);
  const sourceName = String(stepData.choosePlayerForTwoPileSplitSourceName || step.sourceName || 'Ability');
  const items: any[] = Array.isArray(stepData.choosePlayerForTwoPileSplitItems) ? stepData.choosePlayerForTwoPileSplitItems : [];

  if (!chosenOpponentId) {
    debugWarn(2, `[Resolution] choosePlayerForTwoPileSplitChoice: missing player choice`);
    return;
  }

  const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.TWO_PILE_SPLIT,
    playerId: chosenOpponentId as PlayerID,
    description: String(stepData.choosePlayerForTwoPileSplitDescription || `${sourceName}: Separate the items into two piles`),
    mandatory: true,
    sourceName,
    items,
    minPerPile: Number(stepData.choosePlayerForTwoPileSplitMinPerPile || 0),
    choosePileFromSplitChoice: stepData.choosePileFromSplitChoice,
    choosePileFromSplitChooserPlayerId: stepData.choosePileFromSplitChooserPlayerId,
    choosePileFromSplitSourceName: stepData.choosePileFromSplitSourceName,
    choosePileFromSplitItems: stepData.choosePileFromSplitItems,
    choosePileFromSplitOriginalOrder: stepData.choosePileFromSplitOriginalOrder,
    choosePileFromSplitChosenAction: stepData.choosePileFromSplitChosenAction,
    choosePileFromSplitChosenDestination: stepData.choosePileFromSplitChosenDestination,
    choosePileFromSplitOtherDestination: stepData.choosePileFromSplitOtherDestination,
    choosePileFromSplitMovePlayerId: stepData.choosePileFromSplitMovePlayerId,
    choosePileFromSplitTargetPlayerId: stepData.choosePileFromSplitTargetPlayerId,
    choosePileFromSplitChoiceDescription: stepData.choosePileFromSplitChoiceDescription,
    choosePileFromSplitChatMessage: stepData.choosePileFromSplitChatMessage,
    choosePileFromSplitSplitMessage: `${sourceName}: ${getPlayerName(game, chosenOpponentId)} separated the cards into two piles.`,
  } as any);

  try {
    await appendEvent(gameId, (game as any).seq || 0, 'choosePlayerForTwoPileSplitChoiceResolve', {
      playerId,
      controllerId,
      sourceId: String(step.sourceId || '').trim() || undefined,
      sourceName,
      resolvedStepId: String(step.id || '').trim() || undefined,
      chosenOpponentId,
      itemIds: items.map((item: any) => String(item?.id || '').trim()).filter(Boolean),
      queuedResolutionStep,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(choosePlayerForTwoPileSplitChoiceResolve) failed:', err);
  }

  appendQueuedResolutionPromptEvent(game, gameId, {
    playerId: chosenOpponentId,
    sourceId: String(step.sourceId || '').trim(),
    queuedResolutionStep,
  });

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${sourceName}: ${getPlayerName(game, controllerId)} chose ${getPlayerName(game, chosenOpponentId)} to separate the piles.`,
    ts: Date.now(),
  });
}

/** "Choose a player. That player chooses one of the looked-at cards." */
export async function handleChoosePlayerForLookedAtCardsChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = response.playerId;

  const chosenPlayerId = extractOptionChoiceSelectionId(response.selections);
  const controllerId = String(stepData.choosePlayerForLookedAtCardsController || playerId);
  const sourceName = String(stepData.choosePlayerForLookedAtCardsSourceName || step.sourceName || 'Ability');
  const lookedAtCards: any[] = Array.isArray(stepData.choosePlayerForLookedAtCardsOptions)
    ? stepData.choosePlayerForLookedAtCardsOptions
    : [];
  if (!chosenPlayerId || lookedAtCards.length === 0) {
    debugWarn(2, `[Resolution] choosePlayerForLookedAtCardsChoice: invalid player choice or missing cards`);
    return;
  }

  const controllerName = getPlayerName(game, controllerId);
  const options = lookedAtCards.map((c: any) => ({
    id: c.id,
    label: c.name || 'Unknown',
    description: c.type_line,
    imageUrl: c.image_uris?.normal || c.image_uris?.art_crop || c.image_uris?.small,
  }));

  const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: chosenPlayerId,
    description: String(stepData.choosePlayerForLookedAtCardsDescription || `${sourceName}: Choose a card`),
    mandatory: true,
    sourceName,
    options,
    minSelections: 1,
    maxSelections: 1,
    chooseLookedAtCardsDestinationChoice: true,
    chooseLookedAtCardsDestinationController: stepData.choosePlayerForLookedAtCardsDestinationController,
    chooseLookedAtCardsDestinationSourceName: stepData.choosePlayerForLookedAtCardsDestinationSourceName,
    chooseLookedAtCardsDestinationTopCardIds: stepData.choosePlayerForLookedAtCardsDestinationTopCardIds,
    chooseLookedAtCardsDestinationChosenZone: stepData.choosePlayerForLookedAtCardsDestinationChosenZone,
    chooseLookedAtCardsDestinationOtherZone: stepData.choosePlayerForLookedAtCardsDestinationOtherZone,
    chooseLookedAtCardsDestinationOtherCardPatch: stepData.choosePlayerForLookedAtCardsDestinationOtherCardPatch,
  } as any);

  try {
    await appendEvent(gameId, (game as any).seq || 0, 'choosePlayerForLookedAtCardsChoiceResolve', {
      playerId,
      controllerId,
      sourceId: String(step.sourceId || '').trim() || undefined,
      sourceName,
      resolvedStepId: String(step.id || '').trim() || undefined,
      chosenPlayerId,
      queuedResolutionStep,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(choosePlayerForLookedAtCardsChoiceResolve) failed:', err);
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${sourceName}: ${controllerName} revealed ${options.map(o => o.label).join(' and ')}.`,
    ts: Date.now(),
  });

  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }
}
