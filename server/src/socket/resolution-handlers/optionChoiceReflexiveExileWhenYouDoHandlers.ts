/**
 * socket/resolution-handlers/optionChoiceReflexiveExileWhenYouDoHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleOptionChoiceResponse).
 * Cluster moved: the two reflexive "when you do" prompts that move cards themselves and then push the
 * reflexive trigger onto the stack in the same pass - `reflexiveBoundGraveyardSelfExileWhenYouDo`
 * (exile the one bound card from whichever graveyard still holds it) and
 * `reflexiveExileToOwnersGraveyardWhenYouDo` (ask, queue the multi-select, then move the chosen
 * opponent-owned exile cards into their owners' graveyards).
 * Public entry symbols: handleReflexiveBoundGraveyardSelfExileWhenYouDo,
 * handleReflexiveExileToOwnersGraveyardWhenYouDo.
 *
 * Both branches always returned, including their unmatched-stage fallthrough, so each call site is
 * `await handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import { pushCardToPlayerGraveyardWithReplacements } from "../../state/modules/graveyardEntryUtils.js";
import {
  collectOpponentOwnedExileCardTargets,
  formatReflexiveExileToOwnersGraveyardLabel,
  materializeReflexiveSourceText,
} from "../../state/modules/reflexive-triggers.js";
import { recordCardLeftGraveyardThisTurn } from "../../state/modules/turn-tracking.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { uid } from "../../state/utils.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { debugWarn } from "../../utils/debug.js";
import { inferFollowupTargetMetadata } from "../resolutionDiscardTriggerUtils.js";
import {
  buildTriggeredAbilitySourceContext,
  getResolutionSourcePermanentSnapshot,
} from "../resolutionKeywordChoiceHandlers.js";
import { appendQueuedResolutionPromptEvent } from "../resolutionCloneQueuedPromptUtils.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "../util.js";
import { extractOptionChoiceSelectionId } from "./resolutionOptionChoiceSelectionIds.js";

/** "You may exile <that bound card> from a graveyard. When you do, ..." */
export function handleReflexiveBoundGraveyardSelfExileWhenYouDo(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = extractOptionChoiceSelectionId(response.selections);
  const stage = String(stepData.reflexiveBoundGraveyardSelfExileWhenYouDoStage || '');
  const controllerId = String(stepData.reflexiveBoundGraveyardSelfExileWhenYouDoController || playerId);
  const sourceName = String(stepData.reflexiveBoundGraveyardSelfExileWhenYouDoSourceName || step.sourceName || 'Ability');
  const sourcePermanentId = String(stepData.reflexiveBoundGraveyardSelfExileWhenYouDoSourcePermanentId || step.sourceId || '').trim();
  const boundCardId = String(stepData.reflexiveBoundGraveyardSelfExileWhenYouDoBoundCardId || '').trim();
  const boundOwnerId = String(stepData.reflexiveBoundGraveyardSelfExileWhenYouDoBoundOwnerId || controllerId).trim();
  const boundCardName = String(stepData.reflexiveBoundGraveyardSelfExileWhenYouDoBoundCardName || 'that card').trim() || 'that card';
  const followupDescription = String(stepData.reflexiveBoundGraveyardSelfExileWhenYouDoFollowupDescription || '').trim();

  if (stage === 'ask') {
    if (!choiceId || choiceId === 'decline' || choiceId === 'dont') {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} chose not to exile ${boundCardName}.`,
        ts: Date.now(),
      });
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      return;
    }

    const zones = game.state?.zones || {};
    const ownerIds = boundOwnerId ? [boundOwnerId, ...Object.keys(zones).filter((ownerId) => String(ownerId) !== boundOwnerId)] : Object.keys(zones);
    let zoneOwnerId = '';
    let cardIndex = -1;
    let graveyard: any[] = [];
    for (const ownerId of ownerIds) {
      const candidateGraveyard = Array.isArray(zones?.[ownerId]?.graveyard) ? zones[ownerId].graveyard : [];
      const candidateIndex = candidateGraveyard.findIndex((card: any) => card && String(card.id || '') === boundCardId);
      if (candidateIndex !== -1) {
        zoneOwnerId = String(ownerId);
        cardIndex = candidateIndex;
        graveyard = candidateGraveyard;
        break;
      }
    }

    if (!boundCardId || !zoneOwnerId || cardIndex === -1) {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${boundCardName} is no longer in a graveyard to exile.`,
        ts: Date.now(),
      });
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      return;
    }

    const [movedCard] = graveyard.splice(cardIndex, 1);
    const ownerZones = zones[zoneOwnerId] || (zones[zoneOwnerId] = {});
    ownerZones.graveyard = graveyard;
    ownerZones.graveyardCount = graveyard.length;
    ownerZones.exile = Array.isArray(ownerZones.exile) ? ownerZones.exile : [];
    ownerZones.exile.push({ ...movedCard, zone: 'exile' });
    ownerZones.exileCount = ownerZones.exile.length;
    recordCardLeftGraveyardThisTurn({ state: game.state } as any, zoneOwnerId, movedCard);

    const effectText = materializeReflexiveSourceText(followupDescription, sourceName);
    const triggerId = uid('trigger');
    const sourceSnapshot = stepData.reflexiveBoundGraveyardSelfExileWhenYouDoSourcePermanentSnapshot;
    const targetMetadata = inferFollowupTargetMetadata(game, controllerId, sourceName, sourcePermanentId || undefined, effectText, sourceSnapshot);
    const effectData = {
      exiledCardIds: [String(movedCard?.id || boundCardId)],
      exiledCards: [{ ...(movedCard as any) }],
      exileCount: 1,
      boundGraveyardCardId: String(movedCard?.id || boundCardId),
      boundGraveyardOwnerId: zoneOwnerId,
    };
    const stackItem: any = {
      id: triggerId,
      type: 'triggered_ability',
      controller: controllerId,
      source: sourcePermanentId || null,
      ...(sourcePermanentId ? { permanentId: sourcePermanentId } : null),
      sourceName,
      description: effectText,
      effect: effectText,
      triggerType: 'reflexive_graveyard_exile',
      mandatory: true,
      ...targetMetadata,
      effectData,
      ...(sourceSnapshot && typeof sourceSnapshot === 'object' ? { sourcePermanentSnapshot: sourceSnapshot } : null),
      ...(sourceSnapshot?.card && typeof sourceSnapshot.card === 'object' ? { card: sourceSnapshot.card } : null),
    };

    game.state.stack = Array.isArray(game.state.stack) ? game.state.stack : [];
    game.state.stack.push(stackItem);

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'reflexiveGraveyardExileResolve', {
        playerId: controllerId,
        zoneOwnerId,
        sourceId: sourcePermanentId || undefined,
        sourceName,
        resolvedStepId: String(step.id || '').trim() || undefined,
        cardIds: [String(movedCard?.id || boundCardId)],
        followupText: followupDescription,
        effect: effectText,
        triggerId,
        ...targetMetadata,
        effectData,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(reflexiveGraveyardExileResolve bound self-exile) failed:', err);
    }

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', {
        triggerId,
        sourceId: sourcePermanentId || null,
        ...(sourcePermanentId ? { permanentId: sourcePermanentId } : null),
        sourceName,
        controllerId,
        description: effectText,
        effect: effectText,
        triggerType: 'reflexive_graveyard_exile',
        mandatory: true,
        ...targetMetadata,
        effectData,
        ...(sourceSnapshot && typeof sourceSnapshot === 'object' ? { sourcePermanentSnapshot: sourceSnapshot } : null),
        ...(sourceSnapshot?.card && typeof sourceSnapshot.card === 'object' ? { card: sourceSnapshot.card } : null),
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(pushTriggeredAbility bound reflexive graveyard exile) failed:', err);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} exiles ${String(movedCard?.name || boundCardName)}.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
  }
}

/** "You may put N cards ... from exile into ... graveyard. If/When you do, ..." (processors) */
export async function handleReflexiveExileToOwnersGraveyardWhenYouDo(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = String(extractOptionChoiceSelectionId(response.selections) || (response.cancelled ? 'decline' : '') || '').trim().toLowerCase();
  const stage = String(stepData.reflexiveExileToOwnersGraveyardWhenYouDoStage || 'ask');
  const controllerId = String(stepData.reflexiveExileToOwnersGraveyardWhenYouDoController || playerId);
  const sourceName = String(stepData.reflexiveExileToOwnersGraveyardWhenYouDoSourceName || step.sourceName || 'Ability');
  const sourcePermanentId = String(stepData.reflexiveExileToOwnersGraveyardWhenYouDoSourcePermanentId || step.sourceId || '').trim();
  const sourcePermanentSnapshot = getResolutionSourcePermanentSnapshot(game, stepData, sourcePermanentId || undefined);
  const putCount = Math.max(1, Math.floor(Number(stepData.reflexiveExileToOwnersGraveyardWhenYouDoCount || 1)));
  const followupDescription = String(stepData.reflexiveExileToOwnersGraveyardWhenYouDoFollowupDescription || '').trim();
  const putLabel = formatReflexiveExileToOwnersGraveyardLabel(putCount);

  if (stage === 'ask') {
    if (!choiceId || choiceId === 'decline' || choiceId === 'dont' || choiceId === 'no' || response.cancelled) {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} declined to put cards from exile into graveyards.`,
        ts: Date.now(),
      });
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      broadcastGame(io, game, gameId);
      return;
    }

    const validTargets = Array.isArray(stepData.reflexiveExileToOwnersGraveyardWhenYouDoValidTargets)
      ? stepData.reflexiveExileToOwnersGraveyardWhenYouDoValidTargets
      : collectOpponentOwnedExileCardTargets(game.state, controllerId);

    if (!Array.isArray(validTargets) || validTargets.length < putCount) {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} does not have enough opponent-owned cards in exile.`,
        ts: Date.now(),
      });
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      broadcastGame(io, game, gameId);
      return;
    }

    const options = validTargets.map((target: any) => ({
      id: String(target.id),
      label: String(target.name || target.id),
      description: String(target.typeLine || ''),
      imageUrl: target.imageUrl,
    }));

    const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: controllerId as PlayerID,
      sourceId: sourcePermanentId || undefined,
      sourceName,
      description: `${sourceName}: Choose ${putCount === 1 ? 'a card' : putCount + ' cards'} to put into owners' graveyards.`,
      mandatory: true,
      options,
      minSelections: putCount,
      maxSelections: putCount,
      reflexiveExileToOwnersGraveyardWhenYouDo: true,
      reflexiveExileToOwnersGraveyardWhenYouDoStage: 'select',
      reflexiveExileToOwnersGraveyardWhenYouDoCount: putCount,
      reflexiveExileToOwnersGraveyardWhenYouDoController: controllerId,
      reflexiveExileToOwnersGraveyardWhenYouDoSourceName: sourceName,
      reflexiveExileToOwnersGraveyardWhenYouDoSourcePermanentId: sourcePermanentId || undefined,
      reflexiveExileToOwnersGraveyardWhenYouDoFollowupDescription: followupDescription,
      reflexiveExileToOwnersGraveyardWhenYouDoValidTargets: validTargets,
      ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
    } as any);

    appendQueuedResolutionPromptEvent(game, gameId, {
      playerId: controllerId,
      sourceId: sourcePermanentId,
      queuedResolutionStep,
    });
    return;
  }

  if (stage === 'select') {
    const selectedIds = Array.isArray(response?.selections)
      ? response.selections.map((entry: any) => String(extractOptionChoiceSelectionId(entry) || entry || '').trim()).filter(Boolean)
      : choiceId
        ? [choiceId]
        : [];
    const uniqueSelected = Array.from(new Set(selectedIds));
    if (uniqueSelected.length !== putCount) {
      emitToPlayer(io, controllerId as any, 'error', {
        code: 'INVALID_CHOICE',
        message: `Select exactly ${putCount} card${putCount === 1 ? '' : 's'} from exile.`,
      });
      return;
    }

    const validTargets: Array<any> = Array.isArray(stepData.reflexiveExileToOwnersGraveyardWhenYouDoValidTargets)
      ? stepData.reflexiveExileToOwnersGraveyardWhenYouDoValidTargets
      : collectOpponentOwnedExileCardTargets(game.state, controllerId);
    const byId = new Map<string, any>(validTargets.map((t: any) => [String(t.id), t]));
    const movedNames: string[] = [];

    for (const cardId of uniqueSelected) {
      const meta: any = byId.get(cardId);
      if (!meta) {
        emitToPlayer(io, controllerId as any, 'error', {
          code: 'INVALID_CHOICE',
          message: 'One or more selected cards are no longer valid exile targets.',
        });
        return;
      }
      const zoneOwnerId = String(meta.zoneOwnerId || meta.ownerId || '').trim();
      const ownerId = String(meta.ownerId || zoneOwnerId).trim();
      const zones = ((game.state as any).zones = (game.state as any).zones || {});
      const zoneEntry = (zones[zoneOwnerId] = zones[zoneOwnerId] || {});
      const exile: any[] = Array.isArray(zoneEntry.exile) ? zoneEntry.exile : (zoneEntry.exile = []);
      const idx = exile.findIndex((c: any) => String(c?.id || '') === cardId);
      if (idx < 0) {
        emitToPlayer(io, controllerId as any, 'error', {
          code: 'INVALID_CHOICE',
          message: 'Selected card is no longer in exile.',
        });
        return;
      }
      const [card] = exile.splice(idx, 1);
      zoneEntry.exileCount = exile.length;
      const ownerZones = (zones[ownerId] = zones[ownerId] || {});
      ownerZones.graveyard = Array.isArray(ownerZones.graveyard) ? ownerZones.graveyard : [];
      const gyCtx = {
        state: game.state,
        gameId,
        bumpSeq: () => {
          if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
        },
      } as any;
      pushCardToPlayerGraveyardWithReplacements(gyCtx, ownerId, card, ownerZones.graveyard);
      movedNames.push(String(card?.name || meta.name || cardId));
    }

    const effectText = materializeReflexiveSourceText(followupDescription, sourceName);
    const sourceContext = buildTriggeredAbilitySourceContext(sourcePermanentSnapshot);
    const targetMetadata = inferFollowupTargetMetadata(
      game,
      controllerId,
      sourceName,
      sourcePermanentId || undefined,
      effectText,
      sourcePermanentSnapshot,
    );
    const triggerId = uid('trigger');
    const effectData = {
      putCount,
      movedCardIds: uniqueSelected.slice(),
      movedCardNames: movedNames.slice(),
    };
    const stackItem: any = {
      id: triggerId,
      type: 'triggered_ability',
      controller: controllerId,
      source: sourcePermanentId || null,
      ...(sourcePermanentId ? { permanentId: sourcePermanentId } : null),
      sourceName,
      description: effectText,
      effect: effectText,
      triggerType: 'reflexive_exile_to_owners_graveyard',
      mandatory: true,
      ...targetMetadata,
      ...sourceContext,
      effectData,
    };
    game.state.stack = Array.isArray(game.state.stack) ? game.state.stack : [];
    game.state.stack.push(stackItem);

    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'reflexiveExileToOwnersGraveyardResolve', {
        playerId: controllerId,
        sourceId: sourcePermanentId || undefined,
        sourceName,
        resolvedStepId: String((step as any)?.id || '').trim() || undefined,
        cardIds: uniqueSelected.slice(),
        followupText: followupDescription,
        effect: effectText,
        triggerId,
        ...effectData,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(reflexiveExileToOwnersGraveyardResolve) failed:', err);
    }

    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', {
        triggerId,
        sourceId: sourcePermanentId || null,
        ...(sourcePermanentId ? { permanentId: sourcePermanentId } : null),
        sourceName,
        controllerId,
        description: effectText,
        effect: effectText,
        triggerType: 'reflexive_exile_to_owners_graveyard',
        mandatory: true,
        ...targetMetadata,
        ...sourceContext,
        effectData,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(pushTriggeredAbility reflexive exile-to-GY) failed:', err);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} put ${movedNames.join(', ') || putLabel} into owners' graveyards.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
  }
}
