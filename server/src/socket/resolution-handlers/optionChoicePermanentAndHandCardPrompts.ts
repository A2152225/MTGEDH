/**
 * socket/resolution-handlers/optionChoicePermanentAndHandCardPrompts.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleOptionChoiceResponse).
 * Cluster moved: the three OPTION_CHOICE prompts that pick a card or permanent the player already
 * owns - `moveChosenHandCardToLibraryChoice` (put the chosen card from hand on the top or bottom of
 * the library), `sacrificeAnotherPermanentForBenefitChoice` at its `ask` stage (decline, report that
 * there is nothing else to sacrifice, or queue the TARGET_SELECTION that picks the sacrifice) and
 * `attachEquipmentToPermanentChoice` (decline, report that the player controls no Equipment, or
 * queue the TARGET_SELECTION that picks which Equipment attaches to the already-chosen permanent).
 * Public entry symbols: handleMoveChosenHandCardToLibraryChoice,
 * handleSacrificeAnotherPermanentForBenefitAskChoice, handleAttachEquipmentToPermanentChoice.
 *
 * Every branch always returned, including the sacrifice prompt's unmatched-stage fallthrough, so
 * each call site is `await handler(...); return;`. The TARGET_SELECTION sides of the latter two live
 * in `targetSelectionSacrificeFollowupHandlers.ts` and `targetSelectionTapCostAndAttachHandlers.ts`.
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

/** "Put a card from your hand on the top/bottom of your library." */
export async function handleMoveChosenHandCardToLibraryChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = response.playerId;

  const chosenCardId = extractOptionChoiceSelectionId(response.selections);
  const controllerId = String(stepData.moveChosenHandCardToLibraryController || playerId);
  const sourceName = String(stepData.moveChosenHandCardToLibrarySourceName || step.sourceName || 'Ability');
  const sourceId = String(stepData.moveChosenHandCardToLibrarySourceId || step.sourceId || '').trim();
  const position = String(stepData.moveChosenHandCardToLibraryPosition || 'top').toLowerCase() === 'bottom'
    ? 'bottom'
    : 'top';
  if (!chosenCardId) {
    debugWarn(2, `[Resolution] moveChosenHandCardToLibraryChoice: missing selection`);
    return;
  }

  const state = game.state || {};
  const zones = (state.zones = state.zones || {});
  const z = (zones[controllerId] = zones[controllerId] || {
    hand: [],
    handCount: 0,
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
  });
  z.hand = z.hand || [];

  const idx = (z.hand as any[]).findIndex((c: any) => String(c?.id) === String(chosenCardId));
  if (idx < 0) {
    debugWarn(2, `[Resolution] moveChosenHandCardToLibraryChoice: selected card not in hand`);
    return;
  }

  const [card] = (z.hand as any[]).splice(idx, 1);

  const lib = (game as any).libraries?.get?.(controllerId) || (z.library as any[]) || [];
  if (position === 'bottom') {
    lib.push({ ...card, zone: 'library' });
  } else {
    lib.unshift({ ...card, zone: 'library' });
  }
  if ((game as any).libraries?.set) {
    (game as any).libraries.set(controllerId, lib);
  } else {
    z.library = lib;
  }

  z.handCount = (z.hand as any[]).length;
  z.libraryCount = lib.length;

  try {
    await appendEvent(gameId, (game as any).seq || 0, 'moveChosenHandCardToLibraryChoiceResolve', {
      playerId,
      controllerId,
      sourceId: sourceId || undefined,
      sourceName,
      resolvedStepId: String(step.id || '').trim() || undefined,
      chosenCardId: String(chosenCardId || ''),
      position,
      movedCardSnapshot: { ...card, zone: 'library' },
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(moveChosenHandCardToLibraryChoiceResolve) failed:', err);
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${sourceName}: ${getPlayerName(game, controllerId)} put a card from their hand on the ${position} of their library.`,
    ts: Date.now(),
  });

  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }
}

/** "You may sacrifice another permanent. If you do, <benefit>." - the ask half. */
export async function handleSacrificeAnotherPermanentForBenefitAskChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = extractOptionChoiceSelectionId(response.selections) || 'dont';
  const stage = String(stepData.sacrificeAnotherPermanentForBenefitStage || '');
  const controllerId = String(stepData.sacrificeAnotherPermanentForBenefitController || playerId);
  const lifeGain = Number(stepData.sacrificeAnotherPermanentForBenefitLifeGain || 0);
  const drawCount = Number(stepData.sacrificeAnotherPermanentForBenefitDrawCount || 0);
  const sourceName = String(stepData.sacrificeAnotherPermanentForBenefitSourceName || step.sourceName || 'Ability');
  const sourcePermanentId = stepData.sacrificeAnotherPermanentForBenefitSourcePermanentId as string | undefined;

  if (stage === 'ask') {
    if (choiceId !== 'sac') {
      try {
        await appendEvent(gameId, (game as any).seq || 0, 'sacrificeAnotherPermanentForBenefitChoiceResolve', {
          playerId,
          controllerId,
          sourceId: String(sourcePermanentId || step.sourceId || '').trim() || undefined,
          sourceName,
          resolvedStepId: String(step.id || '').trim() || undefined,
          choice: 'decline',
          sourcePermanentId: sourcePermanentId || undefined,
          lifeGain,
          drawCount,
        });
      } catch (err) {
        debugWarn(1, '[Resolution] appendEvent(sacrificeAnotherPermanentForBenefitChoiceResolve) failed:', err);
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} chose not to sacrifice a permanent.`,
        ts: Date.now(),
      });
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      return;
    }

    const battlefield = game.state?.battlefield || [];
    const valid = battlefield
      .filter((p: any) => p && String(p.controller) === controllerId)
      .filter((p: any) => !sourcePermanentId || String(p.id) !== String(sourcePermanentId))
      .map((p: any) => ({
        id: p.id,
        label: p.card?.name || 'Permanent',
        description: p.card?.type_line || 'permanent',
        imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
      }));

    if (valid.length === 0) {
      try {
        await appendEvent(gameId, (game as any).seq || 0, 'sacrificeAnotherPermanentForBenefitChoiceResolve', {
          playerId,
          controllerId,
          sourceId: String(sourcePermanentId || step.sourceId || '').trim() || undefined,
          sourceName,
          resolvedStepId: String(step.id || '').trim() || undefined,
          choice: 'no_valid_permanent',
          sourcePermanentId: sourcePermanentId || undefined,
          lifeGain,
          drawCount,
        });
      } catch (err) {
        debugWarn(1, '[Resolution] appendEvent(sacrificeAnotherPermanentForBenefitChoiceResolve) failed:', err);
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} has no other permanent to sacrifice.`,
        ts: Date.now(),
      });
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      return;
    }

    const queuedStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: controllerId as PlayerID,
      description: `Choose a permanent to sacrifice`,
      mandatory: true,
      sourceId: sourcePermanentId,
      sourceName,
      validTargets: valid,
      targetTypes: ['sacrifice_target'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'a permanent you control',
      sacrificeAnotherPermanentForBenefitChoice: true,
      sacrificeAnotherPermanentForBenefitStage: 'select_sacrifice',
      sacrificeAnotherPermanentForBenefitController: controllerId,
      sacrificeAnotherPermanentForBenefitSourceName: sourceName,
      sacrificeAnotherPermanentForBenefitSourcePermanentId: sourcePermanentId,
      sacrificeAnotherPermanentForBenefitLifeGain: lifeGain,
      sacrificeAnotherPermanentForBenefitDrawCount: drawCount,
    } as any);

    try {
      await appendEvent(gameId, (game as any).seq || 0, 'sacrificeAnotherPermanentForBenefitChoiceResolve', {
        playerId,
        controllerId,
        sourceId: String(sourcePermanentId || step.sourceId || '').trim() || undefined,
        sourceName,
        resolvedStepId: String(step.id || '').trim() || undefined,
        choice: 'sacrifice',
        sourcePermanentId: sourcePermanentId || undefined,
        lifeGain,
        drawCount,
        validTargetIds: valid.map((target: any) => String(target?.id || '').trim()).filter(Boolean),
        queuedResolutionStep: queuedStep,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(sacrificeAnotherPermanentForBenefitChoiceResolve) failed:', err);
    }

    appendQueuedResolutionPromptEvent(game, gameId, {
      playerId: controllerId,
      sourceId: String(sourcePermanentId || '').trim(),
      queuedResolutionStep: queuedStep,
    });

    return;
  }
}

/** "You may attach an Equipment you control to <target permanent>." */
export async function handleAttachEquipmentToPermanentChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = extractOptionChoiceSelectionId(response.selections);
  const controllerId = (stepData.attachEquipmentToPermanentController as string | undefined) || playerId;
  const targetPermanentId = stepData.attachEquipmentToPermanentTargetPermanentId as string | undefined;
  const sourceName = String(stepData.attachEquipmentToPermanentSourceName || step.sourceName || 'Ability');
  const targetName = String(stepData.attachEquipmentToPermanentTargetName || 'the permanent');

  if (!targetPermanentId) return;

  if (!choiceId || choiceId === 'decline') {
    try {
      await appendEvent(gameId, (game as any).seq || 0, 'attachEquipmentToPermanentChoiceResolve', {
        playerId,
        controllerId,
        sourceId: String(step.sourceId || targetPermanentId || '').trim() || undefined,
        sourceName,
        resolvedStepId: String(step.id || '').trim() || undefined,
        choice: 'decline',
        targetPermanentId,
        targetName,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(attachEquipmentToPermanentChoiceResolve) failed:', err);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} chose not to attach an Equipment.`,
      ts: Date.now(),
    });
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    return;
  }

  const battlefield = game.state?.battlefield || [];
  const validEquipment = battlefield
    .filter((p: any) => p && p.controller === controllerId)
    .filter((p: any) => String(p.card?.type_line || '').toLowerCase().includes('equipment'))
    .map((p: any) => ({
      id: p.id,
      label: p.card?.name || 'Equipment',
      description: p.card?.type_line || '',
      imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
    }));

  if (validEquipment.length === 0) {
    try {
      await appendEvent(gameId, (game as any).seq || 0, 'attachEquipmentToPermanentChoiceResolve', {
        playerId,
        controllerId,
        sourceId: String(step.sourceId || targetPermanentId || '').trim() || undefined,
        sourceName,
        resolvedStepId: String(step.id || '').trim() || undefined,
        choice: 'no_equipment',
        targetPermanentId,
        targetName,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(attachEquipmentToPermanentChoiceResolve) failed:', err);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} controls no Equipment to attach.`,
      ts: Date.now(),
    });
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    return;
  }

  const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.TARGET_SELECTION,
    playerId: controllerId as PlayerID,
    description: `Choose an Equipment you control to attach`,
    mandatory: true,
    sourceName,
    validTargets: validEquipment,
    targetTypes: ['equipment'],
    minTargets: 1,
    maxTargets: 1,
    targetDescription: 'Equipment you control',
    attachEquipmentToPermanentSelectEquipment: true,
    attachEquipmentToPermanentTargetPermanentId: targetPermanentId,
    attachEquipmentToPermanentController: controllerId,
    attachEquipmentToPermanentSourceName: sourceName,
    attachEquipmentToPermanentTargetName: targetName,
  } as any);

  try {
    await appendEvent(gameId, (game as any).seq || 0, 'attachEquipmentToPermanentChoiceResolve', {
      playerId,
      controllerId,
      sourceId: String(step.sourceId || targetPermanentId || '').trim() || undefined,
      sourceName,
      resolvedStepId: String(step.id || '').trim() || undefined,
      choice: 'attach',
      targetPermanentId,
      targetName,
      queuedResolutionStepId: String(queuedResolutionStep.id || '').trim() || undefined,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(attachEquipmentToPermanentChoiceResolve) failed:', err);
  }

  appendQueuedResolutionPromptEvent(game, gameId, {
    playerId: controllerId,
    sourceId: String(targetPermanentId || '').trim(),
    queuedResolutionStep,
  });
}
