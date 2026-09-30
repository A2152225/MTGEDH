/**
 * socket/resolution-handlers/additionalCostPaymentResponseHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse switch).
 * Cluster moved: the ADDITIONAL_COST_PAYMENT case - paying a spell's additional cost by discarding
 * (with Madness deferral), sacrificing (deferred to cast commit), removing counters, revealing,
 * beholding, or teamwork-tapping, plus the Bargain/Teamwork decline paths - and the cast restart
 * that follows each outcome.
 * Public entry symbols: handleAdditionalCostPaymentResponse.
 *
 * Terminal for the case: every original `break` becomes `return`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import { parseMadnessCost } from "../../state/modules/alternate-costs.js";
import { updateCounters } from "../../state/modules/counters_tokens.js";
import { pushCardToPlayerGraveyardWithReplacements } from "../../state/modules/graveyardEntryUtils.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { requestCastSpellForSocket } from "../game-actions.js";
import { appendQueuedResolutionPromptEvent } from "../resolutionCloneQueuedPromptUtils.js";
import {
  appendCastSpellContinuationEvent,
  createForwardingGameActionSocket,
} from "../resolutionSyntheticCastSocketUtils.js";
import { broadcastGame, emitToPlayer, getEffectivePower, getPlayerName } from "../util.js";
import {
  validateCounterRemovalPaymentSelection,
  type NormalizedCounterRemovalPayment,
} from "./resolutionCounterRemovalPaymentSelection.js";

/** ADDITIONAL_COST_PAYMENT: apply the chosen additional cost, then restart the gated cast. */
export async function handleAdditionalCostPaymentResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId;
  const stepData = step as any;
  const mandatory = Boolean(stepData.mandatory);

  const castArgs = stepData.castSpellFromHandArgs as any;
  const cardId = String(stepData.cardId || stepData.sourceId || castArgs?.cardId || '');
  const cardName = String(stepData.cardName || stepData.sourceName || 'Spell');
  const costType = String(stepData.costType || 'discard') as 'discard' | 'sacrifice' | 'remove_counters' | 'reveal' | 'behold' | 'teamwork';
  const additionalCostKeyword = String(stepData.additionalCostKeyword || '').toLowerCase().trim();
  const isBargain = additionalCostKeyword === 'bargain';

  const zones = (game.state as any)?.zones?.[pid];
  if (!zones || !Array.isArray(zones.hand)) {
    emitToPlayer(io, pid as any, 'error', { code: 'NO_ZONES', message: 'Player zones not found' });
    return;
  }

  const requestCastEffectId = String(stepData.effectId || stepData.sourceId || '').trim();
  const requestCastPending = requestCastEffectId
    ? (game.state as any)?.pendingSpellCasts?.[requestCastEffectId]
    : undefined;

  const sourceZoneRaw = String(castArgs?.fromZone || requestCastPending?.fromZone || 'hand').toLowerCase().trim();
  const spellSourceZone = sourceZoneRaw === 'exile'
    || sourceZoneRaw === 'graveyard'
    || sourceZoneRaw === 'library'
    || sourceZoneRaw === 'command'
    ? sourceZoneRaw
    : 'hand';

  const hand = Array.isArray((zones as any).hand) ? ((zones as any).hand as any[]) : [];
  const exile = Array.isArray((zones as any).exile) ? ((zones as any).exile as any[]) : [];
  const graveyard = Array.isArray((zones as any).graveyard) ? ((zones as any).graveyard as any[]) : [];
  const library = Array.isArray((game as any).libraries?.get?.(String(pid)))
    ? ((game as any).libraries.get(String(pid)) as any[])
    : (Array.isArray((zones as any).library) ? ((zones as any).library as any[]) : []);
  const command = Array.isArray((game.state as any)?.commandZone?.[String(pid)]?.commanderCards)
    ? ((game.state as any).commandZone[String(pid)].commanderCards as any[])
    : [];

  const sourceCards = spellSourceZone === 'exile'
    ? exile
    : spellSourceZone === 'graveyard'
      ? graveyard
      : spellSourceZone === 'library'
        ? library
        : spellSourceZone === 'command'
          ? command
          : hand;

  const cardInHand = hand.find((c: any) => c && c.id === cardId);
  const spellCard = cardInHand || sourceCards.find((c: any) => c && c.id === cardId);
  if (!spellCard) {
    emitToPlayer(io, pid as any, 'error', {
      code: spellSourceZone === 'hand' ? 'CARD_NOT_IN_HAND' : 'CARD_NOT_FOUND',
      message: spellSourceZone === 'hand' ? 'Card not found in hand' : `Card not found in ${spellSourceZone}`,
    });
    return;
  }

  let selectedIds: string[] = [];
  let removedCountersForCost: NormalizedCounterRemovalPayment = [];
  if (costType === 'remove_counters') {
    const validation = validateCounterRemovalPaymentSelection(game, String(pid), stepData, response.selections);
    if (validation.ok === false) {
      emitToPlayer(io, pid as any, 'error', { code: validation.code, message: validation.message });
      return;
    }
    removedCountersForCost = validation.selections;
  } else {
    selectedIds = (Array.isArray(response.selections) ? response.selections : [response.selections])
      .map((x: any) => String(x ?? ''))
      .filter(Boolean);
  }

  // Optional steps can be declined (empty selection or cancel) without error.
  // Used for Bargain and Teamwork.
  const noSelectionsProvided = costType === 'remove_counters'
    ? removedCountersForCost.length === 0
    : selectedIds.length === 0;
  if ((response.cancelled || noSelectionsProvided) && !mandatory) {
    if (costType === 'teamwork') {
      (spellCard as any).teamworkResolved = true;
      (spellCard as any).teamworkWasPaid = false;
      (spellCard as any).additionalCostPaid = true;
      (spellCard as any).additionalCostMethod = 'teamwork';
      if (requestCastPending) {
        requestCastPending.teamworkResolved = true;
        requestCastPending.teamworkWasPaid = false;
        requestCastPending.additionalCostPaid = true;
        requestCastPending.additionalCostMethod = 'teamwork';
      }

      const continuationPayload: Record<string, unknown> = {
        playerId: pid,
        resolvedStepId: String((step as any).id || ''),
        resolvedStepType: String((step as any).type || ''),
        cardId,
        ...(spellSourceZone === 'hand'
          ? {
              cardUpdates: {
                teamworkResolved: true,
                teamworkWasPaid: false,
                additionalCostPaid: true,
              },
            }
          : {}),
        ...(requestCastPending
          ? {
              effectId: requestCastEffectId,
              pendingSpellCast: {
                ...(requestCastPending || {}),
              },
            }
          : {}),
      };

      appendCastSpellContinuationEvent(gameId, game, continuationPayload);

      if (requestCastPending && requestCastEffectId) {
        delete (game.state as any).pendingSpellCasts[requestCastEffectId];
      }

      const { socket: restartCastSocket } = createForwardingGameActionSocket(io, gameId, String(pid));
      await requestCastSpellForSocket(
        io,
        restartCastSocket as any,
        {
          gameId,
          cardId,
          faceIndex: Number.isFinite(castArgs?.faceIndex)
            ? Number(castArgs.faceIndex)
            : (Number.isFinite(requestCastPending?.faceIndex) ? Number(requestCastPending.faceIndex) : undefined),
          fromZone: spellSourceZone as any,
        },
        {
          xValue: Number.isFinite(castArgs?.xValue)
            ? Number(castArgs.xValue)
            : (Number.isFinite(requestCastPending?.xValue) ? Number(requestCastPending.xValue) : undefined),
          forcedAlternateCostId: String(castArgs?.alternateCostId || requestCastPending?.forcedAlternateCostId || '').trim() || undefined,
          castWithoutPayingManaCost: castArgs?.castWithoutPayingManaCost === true || requestCastPending?.castWithoutPayingManaCost === true,
          bypassExilePermissionCheck: castArgs?.bypassExilePermissionCheck === true || requestCastPending?.bypassExilePermissionCheck === true,
          ignoreTimingRestrictions: castArgs?.ignoreTimingRestrictions === true || requestCastPending?.ignoreTimingRestrictions === true,
        },
      );
      return;
    }

    if (!isBargain) return;
    // Mark Bargain as resolved (declined).
    (spellCard as any).bargainResolved = true;
    (spellCard as any).wasBargained = false;

    if (requestCastPending) {
      requestCastPending.bargainResolved = true;
      requestCastPending.wasBargained = false;
    }

    const continuationPayload: Record<string, unknown> = {
      playerId: pid,
      resolvedStepId: String((step as any).id || ''),
      resolvedStepType: String((step as any).type || ''),
      cardId,
      ...(spellSourceZone === 'hand'
        ? {
            cardUpdates: {
              bargainResolved: true,
              wasBargained: false,
            },
          }
        : {}),
      ...(requestCastPending
        ? {
            effectId: requestCastEffectId,
            pendingSpellCast: {
              ...(requestCastPending || {}),
            },
          }
        : {}),
    };

    appendCastSpellContinuationEvent(gameId, game, continuationPayload);

    if (requestCastPending && requestCastEffectId) {
      delete (game.state as any).pendingSpellCasts[requestCastEffectId];
    }

    const { socket: restartCastSocket } = createForwardingGameActionSocket(io, gameId, String(pid));
    await requestCastSpellForSocket(
      io,
      restartCastSocket as any,
      {
        gameId,
        cardId,
        faceIndex: Number.isFinite(castArgs?.faceIndex)
          ? Number(castArgs.faceIndex)
          : (Number.isFinite(requestCastPending?.faceIndex) ? Number(requestCastPending.faceIndex) : undefined),
        fromZone: spellSourceZone as any,
      },
      {
        xValue: Number.isFinite(castArgs?.xValue)
          ? Number(castArgs.xValue)
          : (Number.isFinite(requestCastPending?.xValue) ? Number(requestCastPending.xValue) : undefined),
        forcedAlternateCostId: String(castArgs?.alternateCostId || requestCastPending?.forcedAlternateCostId || '').trim() || undefined,
        castWithoutPayingManaCost: castArgs?.castWithoutPayingManaCost === true || requestCastPending?.castWithoutPayingManaCost === true,
        bypassExilePermissionCheck: castArgs?.bypassExilePermissionCheck === true || requestCastPending?.bypassExilePermissionCheck === true,
        ignoreTimingRestrictions: castArgs?.ignoreTimingRestrictions === true || requestCastPending?.ignoreTimingRestrictions === true,
      },
    );
    return;
  }

  if (response.cancelled) return;

  if (costType !== 'remove_counters' && selectedIds.length === 0) {
    emitToPlayer(io, pid as any, 'error', { code: 'INVALID_SELECTION', message: 'No selections provided' });
    return;
  }

  let discardedNames: string[] = [];
  let sacrificedNames: string[] = [];
  let removedCounterDescriptions: string[] = [];
  let revealedNames: string[] = [];
  const movedDiscardedCardsToGraveyard: any[] = [];
  const movedDiscardedCardsToExile: any[] = [];
  const deferredMadnessPrompts: any[] = [];

  if (costType === 'discard') {
    zones.graveyard = zones.graveyard || [];
    zones.exile = zones.exile || [];
    const discardTrackingCtx = {
      state: game.state,
      libraries: (game as any).libraries,
      bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
      rng: (game as any).rng,
      gameId,
    } as any;

    for (const discardId of selectedIds) {
      const idx = (zones.hand as any[]).findIndex((c: any) => c && c.id === discardId);
      if (idx === -1) continue;
      const discarded = (zones.hand as any[]).splice(idx, 1)[0];
      discardedNames.push(String(discarded?.name || 'Unknown'));

      const madnessCost = parseMadnessCost(String(discarded?.oracle_text || ''));
      if (madnessCost) {
        const exiledCard = {
          ...discarded,
          zone: 'exile',
        };
        (zones.exile as any[]).push(exiledCard);
        movedDiscardedCardsToExile.push(exiledCard);
        deferredMadnessPrompts.push({
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: pid as any,
          sourceId: String(exiledCard.id || discarded?.id || ''),
          sourceName: 'Madness',
          sourceImage: exiledCard.image_uris?.small || exiledCard.image_uris?.normal || discarded?.image_uris?.small || discarded?.image_uris?.normal,
          description: `Madness: You may cast ${discarded?.name || 'that card'} for ${madnessCost}.`,
          mandatory: false,
          options: [
            { id: 'cast', label: `Cast for Madness (${madnessCost})` },
            { id: 'decline', label: 'Decline' },
          ],
          minSelections: 1,
          maxSelections: 1,
          madnessPrompt: true,
          madnessCardId: String(exiledCard.id || discarded?.id || ''),
          madnessCost,
          castFromExileCardId: String(exiledCard.id || discarded?.id || ''),
          castFromExileCard: { ...exiledCard },
          castFromExileDeclineDestination: 'graveyard',
          castFromExileForcedAlternateCostId: 'madness',
          castFromExileCastWithoutPayingManaCost: false,
          castFromExileBypassExilePermissionCheck: true,
          castFromExileIgnoreTimingRestrictions: true,
        });
        continue;
      }

      const enteredGraveyard = pushCardToPlayerGraveyardWithReplacements(discardTrackingCtx, String(pid), discarded, zones.graveyard as any[]);
      if (enteredGraveyard) {
        movedDiscardedCardsToGraveyard.push(zones.graveyard[zones.graveyard.length - 1]);
      }
    }

    zones.handCount = (zones.hand as any[]).length;
    zones.graveyardCount = (zones.graveyard as any[]).length;
    zones.exileCount = Array.isArray(zones.exile) ? zones.exile.length : 0;

    if (selectedIds.length > 0) {
      const stateAny = game.state as any;
      stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
      stateAny.discardedCardThisTurn[String(pid)] = true;
      stateAny.anyPlayerDiscardedCardThisTurn = true;
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} discards ${discardedNames.join(', ')} as an additional cost to cast ${cardName}.`,
      ts: Date.now(),
    });
  } else if (costType === 'sacrifice') {
    // Defer the actual sacrifice until the cast commits to the stack.
    // Applying it here caused pay-then-abort (e.g. Altar's Reap): commander-zone
    // replacement from the sac blocked / aborted the cast restart while the
    // permanent was already gone.
    const battlefield = (game.state as any).battlefield || [];
    const deferredSacrificeIds: string[] = [];
    for (const permId of selectedIds) {
      const perm = battlefield.find((p: any) => p && p.id === permId);
      if (!perm) continue;
      if (String(perm?.controller || '') !== String(pid)) continue;
      deferredSacrificeIds.push(String(permId));
      sacrificedNames.push(String(perm?.card?.name || 'Unknown'));
    }
    if (deferredSacrificeIds.length === 0) {
      emitToPlayer(io, pid as any, 'error', {
        code: 'INVALID_SELECTION',
        message: 'Selected sacrifice permanent(s) are no longer available.',
      });
      return;
    }
    selectedIds = deferredSacrificeIds;
    (spellCard as any).pendingAdditionalCostSacrificeIds = deferredSacrificeIds.slice();
    if (requestCastPending) {
      requestCastPending.pendingAdditionalCostSacrificeIds = deferredSacrificeIds.slice();
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} chooses to sacrifice ${sacrificedNames.join(', ')} as an additional cost to cast ${cardName}.`,
      ts: Date.now(),
    });
  } else if (costType === 'remove_counters') {
    const battlefield = Array.isArray((game.state as any).battlefield) ? (game.state as any).battlefield : [];
    for (const selection of removedCountersForCost) {
      const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === String(selection.permanentId));
      const permanentName = String(permanent?.card?.name || 'permanent');
      updateCounters(game as any, selection.permanentId, { [selection.counterType]: -selection.count });
      removedCounterDescriptions.push(`${selection.count} ${selection.counterType} from ${permanentName}`);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} removes ${removedCounterDescriptions.join(', ')} as an additional cost to cast ${cardName}.`,
      ts: Date.now(),
    });
  } else if (costType === 'reveal') {
    for (const revealId of selectedIds) {
      const revealed = (zones.hand as any[]).find((c: any) => c && String(c.id || '') === String(revealId));
      if (!revealed) continue;
      revealedNames.push(String(revealed?.name || 'Unknown'));
    }

    if (revealedNames.length === 0) {
      emitToPlayer(io, pid as any, 'error', { code: 'CARD_NOT_IN_HAND', message: 'Selected reveal card not found in hand' });
      return;
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} reveals ${revealedNames.join(', ')} as an additional cost to cast ${cardName}.`,
      ts: Date.now(),
    });
  } else if (costType === 'behold') {
    const chosenType = String(stepData.chosenCreatureType || (spellCard as any)?.chosenCreatureType || '').trim();
    const availableCardIds = new Set(
      (Array.isArray(stepData.availableCards) ? stepData.availableCards : [])
        .map((entry: any) => String(entry?.id || ''))
        .filter(Boolean),
    );
    const revealedNamesForBehold: string[] = [];
    const chosenNamesForBehold: string[] = [];

    for (const selectedId of selectedIds) {
      if (availableCardIds.has(String(selectedId))) {
        const revealed = (zones.hand as any[]).find((card: any) => card && String(card.id || '') === String(selectedId));
        if (revealed) {
          revealedNamesForBehold.push(String(revealed.name || 'Unknown'));
        }
        continue;
      }

      const battlefield = Array.isArray((game.state as any).battlefield) ? (game.state as any).battlefield : [];
      const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === String(selectedId));
      if (permanent) {
        chosenNamesForBehold.push(String(permanent?.card?.name || 'Unknown'));
      }
    }

    const beholdParts = [
      revealedNamesForBehold.length > 0 ? `reveals ${revealedNamesForBehold.join(', ')}` : '',
      chosenNamesForBehold.length > 0 ? `chooses ${chosenNamesForBehold.join(', ')}` : '',
    ].filter(Boolean);

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} beholds ${chosenType || 'creatures'} (${beholdParts.join(' and ') || 'none'}) as an additional cost to cast ${cardName}.`,
      ts: Date.now(),
    });

    (spellCard as any).beholdResolved = true;
    (spellCard as any).wasBeheld = true;
    if (chosenType) {
      (spellCard as any).chosenCreatureType = chosenType;
    }
    if (requestCastPending) {
      requestCastPending.beholdResolved = true;
      requestCastPending.wasBeheld = true;
      if (chosenType) {
        requestCastPending.chosenCreatureType = chosenType;
      }
    }
  } else if (costType === 'teamwork') {
    const minPower = Math.max(0, Number(stepData.teamworkMinPower || 0));
    const battlefield = Array.isArray((game.state as any).battlefield) ? (game.state as any).battlefield : [];
    const tappedNames: string[] = [];
    let totalPower = 0;
    for (const permId of selectedIds) {
      const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === String(permId));
      if (!permanent) continue;
      (permanent as any).tapped = true;
      totalPower += getEffectivePower(permanent, game.state);
      tappedNames.push(String(permanent?.card?.name || 'Creature'));
    }
    const paid = selectedIds.length > 0 && totalPower >= minPower;
    (spellCard as any).teamworkResolved = true;
    (spellCard as any).teamworkWasPaid = paid;
    if (requestCastPending) {
      requestCastPending.teamworkResolved = true;
      requestCastPending.teamworkWasPaid = paid;
    }
    if (paid) {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, pid)} taps ${tappedNames.join(', ')} using teamwork to cast ${cardName}.`,
        ts: Date.now(),
      });
    } else {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, pid)} declines teamwork for ${cardName}.`,
        ts: Date.now(),
      });
    }
  }

  if (isBargain) {
    (spellCard as any).bargainResolved = true;
    (spellCard as any).wasBargained = true;
    if (requestCastPending) {
      requestCastPending.bargainResolved = true;
      requestCastPending.wasBargained = true;
    }
  } else if (costType !== 'behold') {
    // Mark as paid on the card, and resume the cast with an explicit payment marker to avoid re-prompt loops.
    (spellCard as any).additionalCostPaid = true;
    (spellCard as any).additionalCostMethod = costType;
    if (requestCastPending) {
      requestCastPending.additionalCostPaid = true;
      requestCastPending.additionalCostMethod = costType;
    }
  } else {
    (spellCard as any).additionalCostPaid = true;
    (spellCard as any).additionalCostMethod = 'behold';
    if (requestCastPending) {
      requestCastPending.additionalCostPaid = true;
      requestCastPending.additionalCostMethod = 'behold';
    }
  }

  if (costType === 'discard') {
    try {
      if (movedDiscardedCardsToGraveyard.length > 0) {
        appendEvent(gameId, (game as any).seq ?? 0, 'discardEffect', {
          playerId: pid,
          cardIds: movedDiscardedCardsToGraveyard.map((card: any) => String(card?.id || '')).filter(Boolean),
          destination: 'graveyard',
        });
      }

      if (movedDiscardedCardsToExile.length > 0) {
        appendEvent(gameId, (game as any).seq ?? 0, 'discardEffect', {
          playerId: pid,
          cardIds: movedDiscardedCardsToExile.map((card: any) => String(card?.id || '')).filter(Boolean),
          destination: 'exile',
        });
      }
    } catch {
      // ignore persistence failures
    }
  }

  const continuationPayload: Record<string, unknown> = {
    playerId: pid,
    resolvedStepId: String((step as any).id || ''),
    resolvedStepType: String((step as any).type || ''),
    cardId,
    sacrificedPermanentIds: costType === 'sacrifice' ? selectedIds : [],
    // Intent only for replay bookkeeping; live sacrifice is deferred until cast commits.
    deferAdditionalCostSacrifice: costType === 'sacrifice',
    removedCountersForCost: costType === 'remove_counters' ? removedCountersForCost : [],
    revealedCardIdsForCost: costType === 'reveal' ? selectedIds : [],
    ...(spellSourceZone === 'hand'
      ? {
          cardUpdates: isBargain
            ? {
                bargainResolved: true,
                wasBargained: true,
              }
            : costType === 'teamwork'
              ? {
                  additionalCostPaid: true,
                  teamworkResolved: true,
                  teamworkWasPaid: (spellCard as any)?.teamworkWasPaid === true,
                }
            : costType === 'behold'
              ? {
                  additionalCostPaid: true,
                  beholdResolved: true,
                  wasBeheld: true,
                  ...(String(stepData.chosenCreatureType || (spellCard as any)?.chosenCreatureType || '').trim()
                    ? {
                        chosenCreatureType: String(stepData.chosenCreatureType || (spellCard as any)?.chosenCreatureType || '').trim(),
                      }
                    : {}),
                }
              : {
                  additionalCostPaid: true,
                  ...(costType === 'sacrifice'
                    ? { pendingAdditionalCostSacrificeIds: selectedIds.slice() }
                    : {}),
                },
        }
      : {}),
    ...(requestCastPending
      ? {
          effectId: requestCastEffectId,
          pendingSpellCast: {
            ...(requestCastPending || {}),
          },
        }
      : {}),
  };

  appendCastSpellContinuationEvent(gameId, game, continuationPayload);

  if (requestCastPending && requestCastEffectId) {
    delete (game.state as any).pendingSpellCasts[requestCastEffectId];
  }

  const { socket: restartCastSocket } = createForwardingGameActionSocket(io, gameId, String(pid));
  await requestCastSpellForSocket(
    io,
    restartCastSocket as any,
    {
      gameId,
      cardId,
      faceIndex: Number.isFinite(castArgs?.faceIndex)
        ? Number(castArgs.faceIndex)
        : (Number.isFinite(requestCastPending?.faceIndex) ? Number(requestCastPending.faceIndex) : undefined),
      fromZone: spellSourceZone as any,
    },
    {
      xValue: Number.isFinite(castArgs?.xValue)
        ? Number(castArgs.xValue)
        : (Number.isFinite(requestCastPending?.xValue) ? Number(requestCastPending.xValue) : undefined),
      forcedAlternateCostId: String(castArgs?.alternateCostId || requestCastPending?.forcedAlternateCostId || '').trim() || undefined,
      castWithoutPayingManaCost: castArgs?.castWithoutPayingManaCost === true || requestCastPending?.castWithoutPayingManaCost === true,
      bypassExilePermissionCheck: castArgs?.bypassExilePermissionCheck === true || requestCastPending?.bypassExilePermissionCheck === true,
      ignoreTimingRestrictions: castArgs?.ignoreTimingRestrictions === true || requestCastPending?.ignoreTimingRestrictions === true,
    },
  );

  if (costType === 'discard' && deferredMadnessPrompts.length > 0) {
    const stateAny = game.state as any;
    const pendingSpellCasts = stateAny.pendingSpellCasts || {};
    const pendingSpellCastEntry = Object.entries(pendingSpellCasts).find(([, pendingCast]) => {
      const pendingCastAny = pendingCast as any;
      return String(pendingCastAny?.cardId || '') === cardId && String(pendingCastAny?.playerId || pid) === String(pid);
    }) as [string, any] | undefined;
    const queueAfterResume = ResolutionQueueManager.getQueue(gameId) as any;
    const pendingSpellQueueSteps = Array.isArray(queueAfterResume?.steps)
      ? queueAfterResume.steps.filter((queueStep: any) => {
          if (!queueStep) return false;
          const queueCardId = String(
            (queueStep as any)?.cardId ||
            (queueStep as any)?.spellCastContext?.cardId ||
            ''
          ).trim();
          return queueCardId === cardId;
        })
      : [];

    if (pendingSpellCastEntry && pendingSpellQueueSteps.length > 0) {
      const [pendingEffectId, pendingCast] = pendingSpellCastEntry;
      const updatedPendingCast = {
        ...(pendingCast || {}),
        queuedMadnessStepsAfterCast: deferredMadnessPrompts.map((prompt) => ({ ...(prompt as any) })),
      };

      pendingSpellCasts[pendingEffectId] = updatedPendingCast;
      appendCastSpellContinuationEvent(gameId, game, {
        playerId: pid,
        cardId,
        effectId: String(pendingEffectId),
        pendingSpellCast: updatedPendingCast,
        queuedResolutionSteps: pendingSpellQueueSteps.map((queueStep: any) => ({ ...(queueStep as any) })),
      });
    } else {
      const playerHand = Array.isArray((game.state as any)?.zones?.[String(pid)]?.hand)
        ? (game.state as any).zones[String(pid)].hand
        : [];
      const spellStillInHand = playerHand.some((entry: any) => String(entry?.id || '') === cardId);
      if (!spellStillInHand) {
        const queuedMadnessSteps = deferredMadnessPrompts.map((prompt) =>
          ResolutionQueueManager.addStep(gameId, {
            ...(prompt as any),
          } as any)
        );

        appendQueuedResolutionPromptEvent(game, gameId, {
          playerId: String(pid),
          sourceId: cardId,
          queuedResolutionSteps: queuedMadnessSteps.map((queuedStep: any) => ({ ...(queuedStep as any) })),
        });

        if (typeof (game as any).bumpSeq === 'function') {
          (game as any).bumpSeq();
        }
        broadcastGame(io, game, gameId);
      }
    }
  }
}
