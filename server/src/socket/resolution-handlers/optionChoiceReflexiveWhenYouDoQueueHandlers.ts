/**
 * socket/resolution-handlers/optionChoiceReflexiveWhenYouDoQueueHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleOptionChoiceResponse).
 * Cluster moved: the three reflexive "when you do" ask prompts whose only job is to queue the
 * follow-up selection step (the cost itself is paid by that later step, not here) -
 * `reflexiveGraveyardExileWhenYouDo` (queues a GRAVEYARD_SELECTION),
 * `reflexiveDiscardWhenYouDo` (queues a DISCARD_SELECTION, carrying the after-discard draw riders)
 * and `sacrificeWhenYouDo` (queues a TARGET_SELECTION over the matching permanents).
 * Public entry symbols: handleReflexiveGraveyardExileWhenYouDo, handleReflexiveDiscardWhenYouDo,
 * handleSacrificeWhenYouDoAskChoice.
 *
 * Each branch declines with a chat line when the player says no or cannot pay, otherwise queues and
 * persists the follow-up prompt. Every path returned, so each call site is `handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import {
  cardMatchesReflexiveGraveyardExileType,
  formatReflexiveGraveyardExileLabel,
  permanentMatchesReflexiveSacrificeType,
} from "../../state/modules/reflexive-triggers.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { uid } from "../../state/utils.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { appendQueuedResolutionPromptEvent } from "../resolutionCloneQueuedPromptUtils.js";
import { getResolutionSourcePermanentSnapshot } from "../resolutionKeywordChoiceHandlers.js";
import { getPlayerName } from "../util.js";
import { extractOptionChoiceSelectionId } from "./resolutionOptionChoiceSelectionIds.js";

/** "You may exile a card from your graveyard. When you do, ..." */
export function handleReflexiveGraveyardExileWhenYouDo(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = extractOptionChoiceSelectionId(response.selections);
  const stage = String(stepData.reflexiveGraveyardExileWhenYouDoStage || '');
  const controllerId = String(stepData.reflexiveGraveyardExileWhenYouDoController || playerId);
  const sourceName = String(stepData.reflexiveGraveyardExileWhenYouDoSourceName || step.sourceName || 'Ability');
  const sourcePermanentId = String(stepData.reflexiveGraveyardExileWhenYouDoSourcePermanentId || step.sourceId || '').trim();
  const sourcePermanentSnapshot = getResolutionSourcePermanentSnapshot(game, stepData, sourcePermanentId || undefined);
  const exileCount = Math.max(1, Math.floor(Number(stepData.reflexiveGraveyardExileWhenYouDoCount || 1)));
  const cardType = String(stepData.reflexiveGraveyardExileWhenYouDoCardType || '').replace(/\s+/g, ' ').trim() || undefined;
  const followupDescription = String(stepData.reflexiveGraveyardExileWhenYouDoFollowupDescription || '').trim();

  if (stage === 'ask') {
    if (!choiceId || choiceId === 'decline' || choiceId === 'dont') {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} chose not to exile a card from their graveyard.`,
        ts: Date.now(),
      });
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      return;
    }

    const zones = game.state?.zones?.[controllerId];
    const graveyard: any[] = Array.isArray(zones?.graveyard) ? zones.graveyard : [];
    const validTargets = graveyard
      .filter((card: any) => cardMatchesReflexiveGraveyardExileType(card, cardType))
      .map((card: any) => ({
        id: String(card?.id || ''),
        name: String(card?.name || card?.id || 'Card'),
        typeLine: String(card?.type_line || ''),
        manaCost: String(card?.mana_cost || ''),
        imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
        zoneOwnerId: controllerId,
      }))
      .filter((target: any) => Boolean(target.id));

    if (validTargets.length < exileCount) {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} does not have enough matching cards in their graveyard.`,
        ts: Date.now(),
      });
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      return;
    }

    const exileLabel = formatReflexiveGraveyardExileLabel(exileCount, cardType);
    const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.GRAVEYARD_SELECTION,
      playerId: controllerId as PlayerID,
      sourceId: sourcePermanentId || undefined,
      sourceName,
      effectId: String(step.id || sourcePermanentId || uid('reflexive_graveyard_exile')),
      cardName: sourceName,
      title: `${sourceName} - Exile from graveyard`,
      description: `${sourceName}: Exile ${exileLabel} from your graveyard`,
      mandatory: true,
      targetPlayerId: controllerId,
      minTargets: exileCount,
      maxTargets: exileCount,
      destination: 'exile',
      validTargets,
      reflexiveGraveyardExileWhenYouDo: true,
      reflexiveGraveyardExileWhenYouDoStage: 'select_exile',
      reflexiveGraveyardExileWhenYouDoCount: exileCount,
      reflexiveGraveyardExileWhenYouDoCardType: cardType || undefined,
      reflexiveGraveyardExileWhenYouDoController: controllerId,
      reflexiveGraveyardExileWhenYouDoSourceName: sourceName,
      reflexiveGraveyardExileWhenYouDoSourcePermanentId: sourcePermanentId || undefined,
      reflexiveGraveyardExileWhenYouDoFollowupDescription: followupDescription,
      ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
    } as any);

    appendQueuedResolutionPromptEvent(game, gameId, {
      playerId: controllerId,
      sourceId: sourcePermanentId,
      queuedResolutionStep,
    });
  }
}

/** "You may discard a card. When you do, ..." */
export function handleReflexiveDiscardWhenYouDo(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = extractOptionChoiceSelectionId(response.selections);
  const stage = String(stepData.reflexiveDiscardWhenYouDoStage || '');
  const controllerId = String(stepData.reflexiveDiscardWhenYouDoController || playerId);
  const sourceName = String(stepData.reflexiveDiscardWhenYouDoSourceName || step.sourceName || 'Ability');
  const sourcePermanentId = String(stepData.reflexiveDiscardWhenYouDoSourcePermanentId || step.sourceId || '').trim();
  const sourcePermanentSnapshot = getResolutionSourcePermanentSnapshot(game, stepData, sourcePermanentId || undefined);
  const discardCount = Math.max(1, Math.floor(Number(stepData.reflexiveDiscardWhenYouDoCount || 1)));
  const followupDescription = String(stepData.reflexiveDiscardWhenYouDoFollowupDescription || '').trim();

  if (stage === 'ask') {
    if (!choiceId || choiceId === 'decline' || choiceId === 'dont') {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} chose not to discard.`,
        ts: Date.now(),
      });
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      return;
    }

    const zones = game.state?.zones?.[controllerId];
    const hand: any[] = Array.isArray(zones?.hand) ? zones.hand : [];
    if (hand.length < discardCount) {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} has no card to discard.`,
        ts: Date.now(),
      });
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      return;
    }

    const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId: controllerId as PlayerID,
      description: `${sourceName}: Discard ${discardCount} card${discardCount === 1 ? '' : 's'}`,
      mandatory: true,
      sourceId: sourcePermanentId || undefined,
      sourceName,
      discardCount,
      destination: 'graveyard',
      hand: hand.map((card: any) => ({
        id: card.id,
        name: card.name,
        type_line: card.type_line,
        oracle_text: card.oracle_text,
        image_uris: card.image_uris,
        mana_cost: card.mana_cost,
        cmc: card.cmc,
        colors: card.colors,
      })),
      reflexiveDiscardWhenYouDo: true,
      reflexiveDiscardWhenYouDoStage: 'select_discard',
      reflexiveDiscardWhenYouDoCount: discardCount,
      reflexiveDiscardWhenYouDoController: controllerId,
      reflexiveDiscardWhenYouDoSourceName: sourceName,
      reflexiveDiscardWhenYouDoSourcePermanentId: sourcePermanentId || undefined,
      reflexiveDiscardWhenYouDoFollowupDescription: followupDescription,
      ...(Number(stepData.afterDiscardDrawCount) > 0 || /^draw a card\b/i.test(followupDescription)
        ? { afterDiscardDrawCount: Math.max(1, Number(stepData.afterDiscardDrawCount) || 1) }
        : null),
      ...(Number(stepData.afterDiscardDrawCountIfDiscardedLand) > 0
        ? { afterDiscardDrawCountIfDiscardedLand: Number(stepData.afterDiscardDrawCountIfDiscardedLand) }
        : /if a land card was discarded this way/i.test(followupDescription)
          ? { afterDiscardDrawCountIfDiscardedLand: 1 }
          : null),
      ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
    } as any);

    appendQueuedResolutionPromptEvent(game, gameId, {
      playerId: controllerId,
      sourceId: sourcePermanentId,
      queuedResolutionStep,
    });
  }
}

/** "You may sacrifice a <Subtype>. When you do, ..." */
export function handleSacrificeWhenYouDoAskChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = extractOptionChoiceSelectionId(response.selections);
  const stage = String(stepData.sacrificeWhenYouDoStage || '');
  const controllerId = (stepData.sacrificeWhenYouDoController as string | undefined) || playerId;
  const subtype = String(stepData.sacrificeWhenYouDoSubtype || '').trim();
  const damage = Number(stepData.sacrificeWhenYouDoDamage || 0);
  const lifeGain = Number(stepData.sacrificeWhenYouDoLifeGain || 0);
  const sourceName = String(stepData.sacrificeWhenYouDoSourceName || step.sourceName || 'Ability');
  const sourcePermanentId = stepData.sacrificeWhenYouDoSourcePermanentId as string | undefined;
  const sourcePermanentSnapshot = getResolutionSourcePermanentSnapshot(game, stepData, sourcePermanentId || undefined);
  const followupDescription = String(stepData.sacrificeWhenYouDoFollowupDescription || stepData.sacrificeWhenYouDoFollowupEffect || '').trim();
  const followupTargetDescription = String(stepData.sacrificeWhenYouDoTargetDescription || '').trim();

  if (stage === 'ask') {
    if (!choiceId || choiceId === 'decline' || choiceId === 'dont') {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} chose not to sacrifice a ${subtype}.`,
        ts: Date.now(),
      });
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      return;
    }

    const battlefield = game.state?.battlefield || [];
    const validSacrifices = battlefield
      .filter((p: any) => permanentMatchesReflexiveSacrificeType(p, controllerId, subtype, sourcePermanentId))
      .map((p: any) => ({
        id: p.id,
        label: p.card?.name || 'Permanent',
        description: p.card?.type_line || '',
        imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
      }));

    if (validSacrifices.length === 0) {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} has no ${subtype} to sacrifice.`,
        ts: Date.now(),
      });
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      return;
    }

    const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: controllerId as PlayerID,
      description: `Choose a ${subtype} to sacrifice`,
      mandatory: true,
      sourceId: sourcePermanentId,
      sourceName,
      validTargets: validSacrifices,
      targetTypes: ['sacrifice_target'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: `${subtype} you control`,
      sacrificeWhenYouDo: true,
      sacrificeWhenYouDoStage: 'select_sacrifice',
      sacrificeWhenYouDoSubtype: subtype,
      sacrificeWhenYouDoDamage: damage,
      sacrificeWhenYouDoLifeGain: lifeGain,
      sacrificeWhenYouDoController: controllerId,
      sacrificeWhenYouDoSourceName: sourceName,
      sacrificeWhenYouDoSourcePermanentId: sourcePermanentId,
      ...(followupDescription ? { sacrificeWhenYouDoFollowupDescription: followupDescription } : null),
      ...(followupTargetDescription ? { sacrificeWhenYouDoTargetDescription: followupTargetDescription } : null),
      ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
    } as any);

    appendQueuedResolutionPromptEvent(game, gameId, {
      playerId: controllerId,
      sourceId: String(sourcePermanentId || '').trim(),
      queuedResolutionStep: queuedResolutionStep,
    });
  }
}
