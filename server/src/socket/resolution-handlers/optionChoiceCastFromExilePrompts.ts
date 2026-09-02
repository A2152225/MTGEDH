/**
 * socket/resolution-handlers/optionChoiceCastFromExilePrompts.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleOptionChoiceResponse).
 * Cluster moved: the two "you may cast that card from exile without paying its mana cost"
 * OPTION_CHOICE prompts - the Dance with Calamity sequence (cast, detect whether the cast actually
 * progressed, then either retry, defer until the cast finishes, or advance to the next exiled card)
 * and the generic castFromExile prompt (cast, or apply the decline destination - graveyard, cease to
 * exist, bottom of library, hand, stay exiled - plus the optional damage-each-opponent rider, then
 * enqueue the next queued prompt and resume a suspended cleanup step).
 * Public entry symbols: handleDanceWithCalamityCastPrompt, handleCastFromExilePromptChoice.
 *
 * The private `appendCastFromExilePromptResolveEvent` helper came along; these were its only callers.
 * `handleCastFromExilePromptChoice` takes a `helpers.sanitizeStepForClient` callback because the
 * retry path re-prompts the player and that sanitizer still lives in the parent.
 * If a generic cast-from-exile "cast" choice does not actually start a cast
 * (no stack growth, card still in exile, no pending payment/target step), the
 * prompt is treated as declined (Possibility Storm bottoms the card) instead of
 * re-queued — otherwise AI auto-picks "cast" forever.
 * Both branches always returned, so each call site is `await handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import { pushCardToPlayerGraveyardWithReplacements } from "../../state/modules/graveyardEntryUtils.js";
import { cleanupCardLeavingExile } from "../../state/modules/playable-from-exile.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debugWarn } from "../../utils/debug.js";
import { requestCastSpellForSocket } from "../game-actions.js";
import { appendQueuedResolutionPromptEvent } from "../resolutionCloneQueuedPromptUtils.js";
import {
  advanceDanceWithCalamityCastSequence,
  processPendingDanceWithCalamity,
  upsertOneShotCastFromExilePromptPermission,
} from "../resolutionProcessPendingHandlers.js";
import { advanceStepPersistingEvent } from "../step-advance.js";
import { emitToPlayer, getPlayerName } from "../util.js";
import { extractOptionChoiceSelectionId } from "./resolutionOptionChoiceSelectionIds.js";

function resolutionStepReferencesExiledCard(queuedStep: any, exiledCardId: string): boolean {
  const wanted = String(exiledCardId || '').trim();
  if (!wanted) return false;
  const fields = [
    queuedStep?.sourceId,
    queuedStep?.cardId,
    queuedStep?.spellCardId,
    queuedStep?.spellCastContext?.cardId,
    queuedStep?.effectId,
    queuedStep?.id,
  ];
  return fields.some((value) => {
    const text = String(value || '').trim();
    return Boolean(text) && (text === wanted || text.includes(wanted));
  });
}

/** Callback seam for the one parent-owned helper this cluster still needs. */
export type CastFromExilePromptHelpers = {
  sanitizeStepForClient: (gameId: string, step: ResolutionStep) => any;
};

function appendCastFromExilePromptResolveEvent(
  gameId: string,
  game: any,
  payload: Record<string, unknown>
): void {
  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'castFromExilePromptResolve', payload);
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(castFromExilePromptResolve) failed:', err);
  }
}

/**
 * Generic: "You may cast <that card> from exile without paying its mana cost."
 * Used by planeswalker templates and other effects that exile a card then offer a free cast.
 */
export async function handleDanceWithCalamityCastPrompt(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = extractOptionChoiceSelectionId(response.selections) || 'decline';
  const effectId = String(stepData.danceWithCalamityEffectId || '');
  const orderedSpellIds = Array.isArray(stepData.danceWithCalamityOrderedSpellIds)
    ? stepData.danceWithCalamityOrderedSpellIds.map((value: any) => String(value || '')).filter(Boolean)
    : [];
  const nextCastIndex = Math.max(0, Number(stepData.danceWithCalamityNextCastIndex || 0));
  const exiledCardId = String(stepData.castFromExileCardId || '');
  const exiledCard = stepData.castFromExileCard;
  const sourceName = String(stepData.sourceName || step.sourceName || 'Dance with Calamity');
  const pendingEntry = ((game.state as any)?.pendingDanceWithCalamity || {})[playerId] || {};
  const sourceImage = pendingEntry?.sourceImage || (step as any).sourceImage;
  const totalManaValue = Number(pendingEntry?.totalManaValue || 0);
  const exiledCards = Array.isArray(pendingEntry?.exiledCards) ? pendingEntry.exiledCards : [];

  if (choiceId === 'cast') {
    const fakeSocket: any = {
      data: { playerId, spectator: false },
      emit: (event: string, payload: unknown) => {
        emitToPlayer(io, playerId as any, event as any, payload);
      },
    };

    const stackLengthBefore = Array.isArray(game.state?.stack) ? game.state.stack.length : 0;
    await requestCastSpellForSocket(
      io,
      fakeSocket,
      { gameId, cardId: exiledCardId },
      {
        skipPriorityCheck: true,
        forcedAlternateCostId: 'free',
        castWithoutPayingManaCost: true,
        bypassExilePermissionCheck: true,
        ignoreTimingRestrictions: true,
      }
    );

    await Promise.resolve();
    await Promise.resolve();

    const stackLengthAfter = Array.isArray(game.state?.stack) ? game.state.stack.length : 0;
    const exileZone = Array.isArray((game.state as any)?.zones?.[playerId]?.exile)
      ? (game.state as any).zones[playerId].exile
      : [];
    const cardStillInExile = exileZone.some((entry: any) => String(entry?.id || '') === exiledCardId);
    const pendingSpellCasts = Object.values(((game.state as any)?.pendingSpellCasts || {})) as any[];
    const hasPendingCast = pendingSpellCasts.some((entry: any) => String(entry?.cardId || '') === exiledCardId);
    const queue = ResolutionQueueManager.getQueue(gameId);
    const hasPendingStep = queue.steps.some((queuedStep: any) =>
      String(queuedStep?.sourceId || '') === exiledCardId ||
      String(queuedStep?.cardId || '') === exiledCardId ||
      String(queuedStep?.spellCardId || '') === exiledCardId ||
      String(queuedStep?.spellCastContext?.cardId || '') === exiledCardId
    );
    const castOnStack = stackLengthAfter > stackLengthBefore && !cardStillInExile;
    const castStillResolving = !castOnStack && (hasPendingCast || hasPendingStep);
    const progressed = castOnStack || castStillResolving;

    if (!progressed) {
      const livePendingEntry = ((game.state as any)?.pendingDanceWithCalamity || {})[playerId];
      if (livePendingEntry && typeof livePendingEntry === 'object') {
        livePendingEntry.queued = false;
      }
      processPendingDanceWithCalamity(io, game, gameId);
      return;
    }

    if (castStillResolving) {
      const livePendingEntry = ((game.state as any)?.pendingDanceWithCalamity || {})[playerId];
      if (livePendingEntry && typeof livePendingEntry === 'object') {
        livePendingEntry.queued = false;
        livePendingEntry.pendingAdvanceAfterCast = {
          effectId,
          sourceName,
          sourceImage,
          totalManaValue,
          orderedSpellIds,
          nextCastIndex,
          exiledCardId,
        };
      }
      return;
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)} casts ${exiledCard.name} with ${sourceName} without paying its mana cost.`,
      ts: Date.now(),
    });
  } else {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)} declines to cast ${exiledCard.name} with ${sourceName}.`,
      ts: Date.now(),
    });
  }

  const currentExileZone = Array.isArray((game.state as any)?.zones?.[playerId]?.exile)
    ? (game.state as any).zones[playerId].exile
    : [];
  const remainingExiledCards = currentExileZone.map((card: any) => ({ ...card, zone: 'exile' }));
  const livePendingEntry = ((game.state as any)?.pendingDanceWithCalamity || {})[playerId];
  if (livePendingEntry && typeof livePendingEntry === 'object') {
    livePendingEntry.exiledCards = remainingExiledCards;
  }

  advanceDanceWithCalamityCastSequence(io, game, gameId, playerId, {
    effectId,
    sourceName,
    sourceImage,
    totalManaValue,
    orderedSpellIds,
    nextCastIndex,
  });

  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }
}

/** The generic cast-from-exile prompt, including every decline destination. */
export async function handleCastFromExilePromptChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
  helpers: CastFromExilePromptHelpers,
): Promise<void> {
  void helpers;
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = extractOptionChoiceSelectionId(response.selections) || 'decline';
  const exiledCardId = String(stepData.castFromExileCardId);
  const declineDestination = String(stepData.castFromExileDeclineDestination || 'exile');
  const declineDamageEachOpponent = Number(stepData.castFromExileDeclineDamageEachOpponent || 0);
  const declineDamageSourcePermanentId = String(stepData.castFromExileDeclineDamageSourcePermanentId || '');
  const forcedAlternateCostId = String(stepData.castFromExileForcedAlternateCostId || '').trim() || undefined;
  const castWithoutPayingManaCost = stepData.castFromExileCastWithoutPayingManaCost === true || (!forcedAlternateCostId && stepData.castFromExileCastWithoutPayingManaCost !== false);
  const bypassExilePermissionCheck = stepData.castFromExileBypassExilePermissionCheck !== false;
  const ignoreTimingRestrictions = stepData.castFromExileIgnoreTimingRestrictions !== false;
  const zones = game.state?.zones?.[playerId];
  if (!zones || !zones.exile) {
    debugWarn(2, `[Resolution] Cast-from-exile: No exile zone found for player ${playerId}`);
    return;
  }

  const cardIndex = zones.exile.findIndex((c: any) => c?.id === exiledCardId);
  if (cardIndex === -1) {
    debugWarn(2, `[Resolution] Cast-from-exile: Card ${exiledCardId} not found in exile`);
    return;
  }

  const exiledCard = zones.exile[cardIndex];
  const sourceName = String(stepData.sourceName || step.sourceName || 'Ability');
  let applyDecline = choiceId !== 'cast';
  let failedCastAttempt = false;

  if (choiceId === 'cast') {
    const stackLengthBefore = Array.isArray(game.state?.stack) ? game.state.stack.length : 0;
    const fakeSocket: any = {
      data: { playerId, spectator: false },
      emit: (event: string, payload: unknown) => {
        emitToPlayer(io, playerId as any, event as any, payload);
      },
    };

    await requestCastSpellForSocket(
      io,
      fakeSocket,
      { gameId, cardId: exiledCardId, fromZone: 'exile' },
      {
        skipPriorityCheck: true,
        forcedAlternateCostId: forcedAlternateCostId || (castWithoutPayingManaCost ? 'free' : undefined),
        castWithoutPayingManaCost,
        bypassExilePermissionCheck,
        ignoreTimingRestrictions,
      }
    );

    await Promise.resolve();
    await Promise.resolve();

    const stackLengthAfter = Array.isArray(game.state?.stack) ? game.state.stack.length : 0;
    const currentExileZone = Array.isArray((game.state as any)?.zones?.[playerId]?.exile)
      ? (game.state as any).zones[playerId].exile
      : [];
    const cardStillInExile = currentExileZone.some((entry: any) => String(entry?.id || '') === exiledCardId);
    const pendingSpellCasts = Object.values(((game.state as any)?.pendingSpellCasts || {})) as any[];
    const hasPendingCast = pendingSpellCasts.some((entry: any) => String(entry?.cardId || '') === exiledCardId);
    const queueAfterCast = ResolutionQueueManager.getQueue(gameId);
    const hasPendingStep = Boolean(
      (queueAfterCast?.activeStep && resolutionStepReferencesExiledCard(queueAfterCast.activeStep, exiledCardId)) ||
      (Array.isArray(queueAfterCast?.steps) && queueAfterCast.steps.some((queuedStep: any) =>
        resolutionStepReferencesExiledCard(queuedStep, exiledCardId)
      ))
    );
    const progressed = stackLengthAfter > stackLengthBefore || !cardStillInExile || hasPendingCast || hasPendingStep;

    if (progressed) {
      appendCastFromExilePromptResolveEvent(gameId, game, {
        playerId,
        sourceId: String((step as any).sourceId || '').trim(),
        resolvedStepId: String((step as any).id || '').trim(),
        cardId: exiledCardId,
        choice: 'cast',
        declineDestination,
        declineDamageEachOpponent,
        declineDamageSourcePermanentId,
      });
    } else {
      applyDecline = true;
      failedCastAttempt = true;
    }
  }

  if (applyDecline) {
    const findCreatureOnBattlefieldById = (id: string): any | null => {
      if (!id) return null;
      const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
      const perm = battlefield.find((p: any) => String(p?.id || '') === String(id));
      if (!perm) return null;
      const tl = String(perm?.card?.type_line || '').toLowerCase();
      if (!tl.includes('creature')) return null;
      return perm;
    };

    const recordPlayerDamageThisTurn = (targetPlayerId: string, dmg: number) => {
      if (!Number.isFinite(dmg) || dmg <= 0) return;
      try {
        (game.state as any).damageTakenThisTurnByPlayer = (game.state as any).damageTakenThisTurnByPlayer || {};
        (game.state as any).damageTakenThisTurnByPlayer[String(targetPlayerId)] =
          ((game.state as any).damageTakenThisTurnByPlayer[String(targetPlayerId)] || 0) + dmg;
      } catch {}
      try {
        (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
        (game.state as any).lifeLostThisTurn[String(targetPlayerId)] =
          ((game.state as any).lifeLostThisTurn[String(targetPlayerId)] || 0) + dmg;
      } catch {}
    };

    const recordCreatureDealtDamageToPlayerThisTurn = (sourceCreature: any, targetPlayerId: string, dmg: number) => {
      const sourceId = String(sourceCreature?.id || '');
      if (!sourceId || !Number.isFinite(dmg) || dmg <= 0) return;
      try {
        (game.state as any).creaturesThatDealtDamageToPlayer = (game.state as any).creaturesThatDealtDamageToPlayer || {};
        const perPlayer = (((game.state as any).creaturesThatDealtDamageToPlayer[String(targetPlayerId)] =
          (game.state as any).creaturesThatDealtDamageToPlayer[String(targetPlayerId)] || {}) as any);
        const creatureName = String(sourceCreature?.card?.name || 'Unknown Creature');
        perPlayer[sourceId] = {
          creatureName,
          totalDamage: (perPlayer[sourceId]?.totalDamage || 0) + dmg,
          lastDamageTime: Date.now(),
        };
      } catch {}
    };

    const declineCtx = {
      state: game.state,
      libraries: (game as any).libraries,
      bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
      rng: (game as any).rng,
      gameId,
    } as any;

    if (declineDestination === 'graveyard') {
      zones.exile.splice(cardIndex, 1);
      zones.exileCount = zones.exile.length;

      cleanupCardLeavingExile(game.state as any, exiledCard);

      zones.graveyard = zones.graveyard || [];
      pushCardToPlayerGraveyardWithReplacements(declineCtx, String(playerId), exiledCard, zones.graveyard);
      zones.graveyardCount = zones.graveyard.length;
    } else if (declineDestination === 'cease_to_exist') {
      zones.exile.splice(cardIndex, 1);
      zones.exileCount = zones.exile.length;

      cleanupCardLeavingExile(game.state as any, exiledCard);
    } else if (declineDestination === 'library_bottom_random') {
      zones.exile.splice(cardIndex, 1);
      zones.exileCount = zones.exile.length;

      cleanupCardLeavingExile(game.state as any, exiledCard);

      const bottomed = { ...exiledCard, zone: 'library' };
      zones.library = Array.isArray(zones.library) ? zones.library : [];
      zones.library.push(bottomed);
      zones.libraryCount = zones.library.length;
      const lib = (game as any).libraries?.get?.(playerId);
      if (Array.isArray(lib)) {
        lib.push({ ...bottomed });
        (game as any).libraries?.set?.(playerId, lib);
      } else if ((game as any).libraries?.set) {
        (game as any).libraries.set(playerId, [{ ...bottomed }]);
      }
    } else if (declineDestination === 'hand') {
      zones.exile.splice(cardIndex, 1);
      zones.exileCount = zones.exile.length;

      cleanupCardLeavingExile(game.state as any, exiledCard);

      const toHand = { ...exiledCard, zone: 'hand' };
      delete (toHand as any).canBePlayedBy;
      delete (toHand as any).playableUntilTurn;
      delete (toHand as any).withoutPayingManaCost;
      delete (toHand as any).castWithoutPayingManaCost;
      zones.hand = Array.isArray(zones.hand) ? zones.hand : [];
      zones.hand.push(toHand);
      zones.handCount = zones.hand.length;
      const player = (game.state.players || []).find((entry: any) => String(entry?.id || '').trim() === String(playerId));
      if (player) {
        player.hand = Array.isArray(player.hand) ? player.hand : [];
        player.hand.push({ ...toHand });
        if (Array.isArray(player.exile)) {
          const playerExileIndex = player.exile.findIndex(
            (card: any) => String(card?.id || '').trim() === exiledCardId,
          );
          if (playerExileIndex !== -1) player.exile.splice(playerExileIndex, 1);
        }
      }
    } else if (declineDestination === 'exile') {
      cleanupCardLeavingExile(game.state as any, exiledCard);
    }

    if (Number.isFinite(declineDamageEachOpponent) && declineDamageEachOpponent > 0) {
      const startingLife = game.state.startingLife || 40;
      game.state.life = game.state.life || {};
      const sourceCreature = findCreatureOnBattlefieldById(declineDamageSourcePermanentId);
      for (const p of game.state.players || []) {
        if (!p?.id || String(p.id) === String(playerId)) continue;
        const pid = String(p.id);
        const currentLife = game.state.life?.[pid] ?? startingLife;
        game.state.life[pid] = currentLife - declineDamageEachOpponent;
        recordPlayerDamageThisTurn(pid, declineDamageEachOpponent);
        if (sourceCreature) {
          recordCreatureDealtDamageToPlayerThisTurn(sourceCreature, pid, declineDamageEachOpponent);
        }
      }
    }

    appendCastFromExilePromptResolveEvent(gameId, game, {
      playerId,
      sourceId: String((step as any).sourceId || '').trim(),
      resolvedStepId: String((step as any).id || '').trim(),
      cardId: exiledCardId,
      choice: 'decline',
      declineDestination,
      declineDamageEachOpponent,
      declineDamageSourcePermanentId,
    });

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message:
        failedCastAttempt && declineDestination === 'library_bottom_random'
          ? `${getPlayerName(game, playerId)} could not cast ${exiledCard.name} and it was put on the bottom of their library (${sourceName}).`
          : failedCastAttempt && declineDestination === 'graveyard'
            ? `${getPlayerName(game, playerId)} could not cast ${exiledCard.name} and it was put into their graveyard (${sourceName}).`
        : declineDamageEachOpponent > 0
          ? `${getPlayerName(game, playerId)} declined to cast ${exiledCard.name}${declineDestination === 'graveyard' ? ' and it was put into their graveyard' : declineDestination === 'library_bottom_random' ? ' and it was put on the bottom of their library' : declineDestination === 'cease_to_exist' ? ' and the copy ceased to exist' : ''}. ${sourceName} deals ${declineDamageEachOpponent} damage to each opponent.`
          : declineDestination === 'graveyard'
            ? `${getPlayerName(game, playerId)} declined to cast ${exiledCard.name} and it was put into their graveyard (${sourceName}).`
            : declineDestination === 'library_bottom_random'
              ? `${getPlayerName(game, playerId)} declined to cast ${exiledCard.name} and it was put on the bottom of their library (${sourceName}).`
              : declineDestination === 'hand'
                ? `${getPlayerName(game, playerId)} put ${exiledCard.name} into their hand (${sourceName}).`
              : declineDestination === 'cease_to_exist'
                ? `${getPlayerName(game, playerId)} declined to cast ${exiledCard.name} and the copy ceased to exist (${sourceName}).`
              : `${getPlayerName(game, playerId)} declined to cast ${exiledCard.name} (${sourceName}).`,
      ts: Date.now(),
    });
  }

  // Multi-card follow-up: if this prompt is part of a queue, enqueue the next prompt.
  try {
    const queueIds = Array.isArray(stepData.castFromExileQueueCardIds) ? stepData.castFromExileQueueCardIds : null;
    const queueCards = Array.isArray(stepData.castFromExileQueueCards) ? stepData.castFromExileQueueCards : null;
    const queueIndex = Number(stepData.castFromExileQueueIndex || 0);
    if (queueIds && queueCards && queueIds.length > 0 && queueCards.length > 0) {
      const nextIndex = queueIndex + 1;
      const next = queueCards[nextIndex];
      if (next && nextIndex < queueCards.length) {
        upsertOneShotCastFromExilePromptPermission(game, playerId as any, next, sourceName, (step as any).sourceId);

        const queuedStep = ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: playerId as any,
          description: `${sourceName}: You may cast ${next?.name || 'that card'} from exile without paying its mana cost.`,
          mandatory: false,
          sourceName,
          sourceId: (step as any).sourceId,
          sourceImage: (step as any).sourceImage,
          options: [
            { id: 'cast', label: `Cast ${next?.name || 'that card'}` },
            { id: 'decline', label: 'Decline' },
          ],
          minSelections: 1,
          maxSelections: 1,
          castFromExileCardId: next?.id,
          castFromExileCard: next,
          castFromExileDeclineDestination: declineDestination,
          castFromExileQueueCardIds: queueIds,
          castFromExileQueueCards: queueCards,
          castFromExileQueueIndex: nextIndex,
        } as any);

        appendQueuedResolutionPromptEvent(game, gameId, {
          playerId,
          sourceId: String((step as any).sourceId || '').trim(),
          queuedResolutionStep: queuedStep,
        });
      }
    }
  } catch (err) {
    debugWarn(2, `[Resolution] Cast-from-exile: Failed to enqueue next queued prompt:`, err);
  }

  if (choiceId !== 'cast' && stepData.resumeCleanupAfterPrompt === true && typeof (game as any).nextStep === 'function') {
    const queueAfterPrompt = ResolutionQueueManager.getQueue(gameId);
    const resolvedStepId = String((step as any).id || '').trim();
    const hasRemainingCleanupPrompt = Boolean(
      (queueAfterPrompt?.activeStep
        && String((queueAfterPrompt.activeStep as any)?.id || '').trim() !== resolvedStepId
        && (queueAfterPrompt.activeStep as any)?.resumeCleanupAfterPrompt === true)
      || (Array.isArray(queueAfterPrompt?.steps)
        && queueAfterPrompt.steps.some((queuedStep: any) =>
          String(queuedStep?.id || '').trim() !== resolvedStepId
          && queuedStep?.resumeCleanupAfterPrompt === true
        ))
    );
    const pendingSpellCasts = Object.values(((game.state as any)?.pendingSpellCasts || {})) as any[];
    const hasPendingCast = pendingSpellCasts.length > 0;
    const stackLengthAfterPrompt = Array.isArray(game.state?.stack) ? game.state.stack.length : 0;
    if (!hasRemainingCleanupPrompt && !hasPendingCast && stackLengthAfterPrompt === 0) {
      try {
        advanceStepPersistingEvent(io, game as any, gameId, {
          playerId,
          reason: 'cleanupMadnessPromptResolved',
        });
      } catch (err) {
        debugWarn(1, `[Resolution] Failed to resume cleanup after madness prompt:`, err);
      }
    }
  }

  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }
}
