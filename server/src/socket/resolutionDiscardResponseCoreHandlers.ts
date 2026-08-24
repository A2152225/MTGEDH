/**
 * socket/resolutionDiscardResponseCoreHandlers.ts
 *
 * DISCARD_SELECTION response core: cancel / validate / apply discard, then hand
 * off as-cost activation resumes, then post-discard triggers / cleanup.
 */

import type { Server } from "socket.io";
import {
  ResolutionStepType,
  ResolutionQueueManager,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { appendEvent } from "../db/index.js";
import { parseMadnessCost } from "../state/modules/alternate-costs.js";
import { pushCardToPlayerGraveyardWithReplacements } from "../state/modules/graveyardEntryUtils.js";
import { materializeReflexiveSourceText } from "../state/modules/reflexive-triggers.js";
import { resolveOracleIrAnyPlayerMayPaymentSelectionFromResolution, maybeResumeOracleIRStepsAfterResolution } from "../state/modules/oracleIrServerZoneSync.js";
import { maybeResumeDeferredOracleIrStackSpellOnGame } from "../state/modules/oracleIrDeferredStackFinalize.js";
import { uid } from "../state/utils.js";
import { debug, debugWarn } from "../utils/debug.js";
import { advanceStepPersistingEvent } from "./step-advance.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "./util.js";
import { appendQueuedResolutionPromptEvent } from "./resolutionCloneQueuedPromptUtils.js";
import {
  buildTriggeredAbilitySourceContext,
  getResolutionSourcePermanentSnapshot,
} from "./resolutionKeywordChoiceHandlers.js";
import {
  inferFollowupTargetMetadata,
  queueDiscardTriggeredAbilities,
  queueDiscardTriggeredGraveyardCastAbilities,
} from "./resolutionDiscardTriggerUtils.js";
import { tryResumeDiscardActivationCosts } from "./resolutionDiscardActivationResumeHandlers.js";
import { emitWardCounterOutcome, tryCounterByWard } from "./resolutionWardUtils.js";

export function normalizeResolutionCardId(id: unknown): string {
  return String(id ?? '').trim();
}

export function buildResolutionHandIdSet(hand: readonly any[]): Set<string> {
  const ids = new Set<string>();
  for (const card of hand) {
    const normalizedId = normalizeResolutionCardId(card?.id);
    if (normalizedId) ids.add(normalizedId);
  }
  return ids;
}

/**
 * Handle discard selection response
 */
export async function handleDiscardResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  if (response.cancelled) {
    const stepAny = step as any;
    if (stepAny?.wardPayment === true) {
      const triggeredBy = String(stepAny?.wardTriggeredBy || stepAny?.sourceId || '').trim();
      const wardController = String(stepAny?.wardPermanentController || 'system');
      const wardName = String(stepAny?.wardPermanentName || step.sourceName || 'Ward');
      const pid = response.playerId;

      if (triggeredBy) {
        const outcome = tryCounterByWard(game, gameId, triggeredBy, wardController);
        emitWardCounterOutcome(io, game, gameId, wardName, pid, outcome, 'declined to pay ward');
        if (typeof game.bumpSeq === 'function') game.bumpSeq();
      }
    }

    if ((step as any)?.discardAbilityAsCost === true) {
      const pid = response.playerId;
      const cardName = String((step as any)?.cardName || step.sourceName || 'Ability');
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${cardName}: ${getPlayerName(game, pid)} cancelled the activation.`,
        ts: Date.now(),
      });
    }

    if ((step as any)?.graveyardCastDiscardAsCost === true) {
      const pid = response.playerId;
      const cardName = String((step as any)?.cardName || step.sourceName || 'Spell');
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${cardName}: ${getPlayerName(game, pid)} cancelled the graveyard cast.`,
        ts: Date.now(),
      });
    }

    if ((step as any)?.exileFromHandAbilityAsCost === true) {
      const pid = response.playerId;
      const cardName = String((step as any)?.cardName || step.sourceName || 'Ability');
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${cardName}: ${getPlayerName(game, pid)} cancelled the activation.`,
        ts: Date.now(),
      });
    }

    if ((step as any)?.oracleIrAnyPlayerMayPaymentSelection === true) {
      const ctx = ((game as any).ctx || game) as any;
      ctx.gameId = gameId;
      ctx.state = game.state;
      resolveOracleIrAnyPlayerMayPaymentSelectionFromResolution(ctx, step, {
        cancelled: true,
        selections: [],
      });
      if (typeof game.bumpSeq === 'function') game.bumpSeq();
      broadcastGame(io, game, gameId);
    }

    return;
  }

  if ((step as any)?.oracleIrAnyPlayerMayPaymentSelection === true) {
    const ctx = ((game as any).ctx || game) as any;
    ctx.gameId = gameId;
    ctx.state = game.state;
    const handled = resolveOracleIrAnyPlayerMayPaymentSelectionFromResolution(ctx, step, response);
    if (handled) {
      if (typeof game.bumpSeq === 'function') game.bumpSeq();
      broadcastGame(io, game, gameId);
    }
    return;
  }

  const pid = response.playerId;
  const selections = response.selections as string[];
  
  if (!Array.isArray(selections) || selections.length === 0) {
    debugWarn(2, `[Resolution] Invalid discard selections for step ${step.id}`);
    return;
  }
  
  // Get discard step data for validation
  const discardStep = step as any;
  const hand = discardStep.hand || [];
  const discardCount = discardStep.discardCount;
  const destination: 'graveyard' | 'exile' = discardStep.destination === 'exile' ? 'exile' : 'graveyard';
  const dungeonRoomPayment = discardStep.dungeonRoomPayment && typeof discardStep.dungeonRoomPayment === 'object'
    ? { ...(discardStep.dungeonRoomPayment as Record<string, any>) }
    : undefined;
  
  // Validate selection count matches required discard count
  if (discardCount && selections.length !== discardCount) {
    debugWarn(1, `[Resolution] Invalid discard count: expected ${discardCount}, got ${selections.length}`);
    return;
  }
  
  // Validate all selected cards are in the hand options (normalize ids — cleanup uses String(c.id) in handOptions).
  const validCardIds = buildResolutionHandIdSet(hand);
  for (const cardId of selections) {
    if (!validCardIds.has(normalizeResolutionCardId(cardId))) {
      debugWarn(1, `[Resolution] Invalid discard selection: card ${cardId} not in hand`);
      return;
    }
  }
  
  // Get player zones
  const zones = game.state?.zones?.[pid];
  if (!zones || !zones.hand) {
    debugWarn(2, `[Resolution] No hand found for player ${pid}`);
    return;
  }

  // Activation-cost flows must validate remaining mana/life BEFORE performing irreversible zone changes.
  // Otherwise, we could discard/exile a card and then discover mana can't be paid.
  const isDiscardCostActivation = (step as any)?.discardAbilityAsCost === true;
  const isExileFromHandCostActivation = (step as any)?.exileFromHandAbilityAsCost === true;
  const isGraveyardCastDiscardActivation = (step as any)?.graveyardCastDiscardAsCost === true;
  const isCleanupDiscard = (step as any)?.reason === 'cleanup';
  if (isDiscardCostActivation || isExileFromHandCostActivation || isGraveyardCastDiscardActivation) {
    const stepAny = step as any;
    const controllerId = String(pid);
    const permanentId = String(stepAny?.permanentId || step.sourceId || '').trim();
    const manaCost = String(stepAny?.manaCost || '');
    const requiresTap = Boolean(stepAny?.requiresTap);
    const lifeToPayForCost = Number(stepAny?.lifeToPayForCost || 0);

    if (isGraveyardCastDiscardActivation) {
      const graveyardCardId = String(stepAny?.cardId || step.sourceId || '').trim();
      const graveyardNow: any[] = Array.isArray(zones.graveyard) ? zones.graveyard : [];
      const sourceCard = graveyardCardId ? graveyardNow.find((entry: any) => entry && String(entry.id) === graveyardCardId) : undefined;
      if (!sourceCard) {
        emitToPlayer(io, controllerId, 'error', { code: 'CARD_NOT_IN_GRAVEYARD', message: 'Card not found in graveyard' });
        return;
      }
    } else {
      const battlefield = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
      const sourcePerm = permanentId ? battlefield.find((p: any) => p && String(p.id) === String(permanentId)) : undefined;
      if (!sourcePerm) {
        emitToPlayer(io, controllerId, 'error', { code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' });
        return;
      }
      if (String(sourcePerm.controller || '') !== controllerId) {
        emitToPlayer(io, controllerId, 'error', { code: 'NOT_CONTROLLER', message: 'You no longer control that permanent' });
        return;
      }
      if (requiresTap && (sourcePerm as any).tapped) {
        emitToPlayer(io, controllerId, 'error', { code: 'ALREADY_TAPPED', message: 'Permanent is already tapped' });
        return;
      }
    }

    let remainingNonManaCostText = (isExileFromHandCostActivation
      ? manaCost
          .replace(/\{[^}]+\}/g, ' ')
          .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
          .replace(/\bexile\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:(?:creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+)?cards?\s+from\s+your\s+hand\b/gi, ' ')
      : manaCost
          .replace(/\{[^}]+\}/g, ' ')
          .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
          .replace(
            /\bdiscard\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:(?:creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+)?cards?\b/gi,
            ' '
          ));

    // Combined discard+sacrifice costs are handled across two steps; allow sacrifice text to remain here.
    if (!isExileFromHandCostActivation && (stepAny as any)?.discardAndSacrificeAbilityAsCost === true) {
      remainingNonManaCostText = remainingNonManaCostText.replace(/\bsacrifice\b[^,]*/gi, ' ');
    }

    remainingNonManaCostText = remainingNonManaCostText
      .replace(/[\s,]+/g, ' ')
      .trim();

    if (remainingNonManaCostText.length > 0) {
      emitToPlayer(io, controllerId, 'error', { code: 'UNSUPPORTED_COST', message: `Unsupported activation cost (${remainingNonManaCostText}).` });
      return;
    }

    // Validate mana portion of the activation cost (hybrid-aware; conservative: no Phyrexian and no X).
    const manaSymbols = manaCost.match(/\{[WUBRGC0-9X\/P]+\}/gi) || [];
    const manaOnly = manaSymbols
      .filter((s) => s.toUpperCase() !== '{T}' && s.toUpperCase() !== '{Q}')
      .join('');
    if (/\{[^}]*\/P\}/i.test(manaOnly) || /\{[^}]*X[^}]*\}/i.test(manaOnly)) {
      emitToPlayer(io, controllerId, 'error', { code: 'UNSUPPORTED_COST', message: `Unsupported activation cost (${manaOnly || 'complex cost'})` });
      return;
    }
    if (manaOnly) {
      const { getOrInitManaPool, resolveManaCostForPoolPayment, calculateTotalAvailableMana, validateManaPayment } = await import('./util.js');
      const pool = getOrInitManaPool(game.state, controllerId) as any;
      const resolved = resolveManaCostForPoolPayment(pool, manaOnly);
      if (!resolved.ok) {
        emitToPlayer(io, controllerId, 'error', { code: 'INSUFFICIENT_MANA', message: (resolved as any).error || 'Insufficient mana.' });
        return;
      }
      const totalAvailable = calculateTotalAvailableMana(pool, undefined);
      const validationError = validateManaPayment(totalAvailable, resolved.coloredCost, resolved.genericCost);
      if (validationError) {
        emitToPlayer(io, controllerId, 'error', { code: 'INSUFFICIENT_MANA', message: validationError });
        return;
      }
    }

    if (Number.isFinite(lifeToPayForCost) && lifeToPayForCost > 0) {
      const currentLife = Number((game.state as any)?.life?.[controllerId] ?? 40);
      if (!Number.isFinite(currentLife) || currentLife < lifeToPayForCost) {
        emitToPlayer(io, controllerId, 'error', {
          code: 'INSUFFICIENT_LIFE',
          message: `Need to pay ${lifeToPayForCost} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
        });
        return;
      }
    }

    // Ensure the chosen cards are still in the player's actual hand.
    const handNow: any[] = Array.isArray(zones.hand) ? zones.hand : [];
    const handNowIds = buildResolutionHandIdSet(handNow);
    if (!selections.every((id) => handNowIds.has(normalizeResolutionCardId(id)))) {
      emitToPlayer(io, controllerId, 'error', { code: 'CARD_NOT_IN_HAND', message: 'Selected card not found in hand' });
      return;
    }
  }
  
  // Move selected cards to the destination zone
  zones.graveyard = zones.graveyard || [];
  zones.exile = zones.exile || [];

  const exileTag = (step as any)?.exileTag as
    | {
        exiledWithSourceId?: string;
        exiledWithOracleId?: string;
        exiledWithSourceName?: string;
      }
    | undefined;

  const movedCards: any[] = [];
  const movedCardsToGraveyard: any[] = [];
  const movedCardsToExile: any[] = [];
  const queuedMadnessPrompts: any[] = [];
  const shouldOfferMadnessPrompt =
    !isExileFromHandCostActivation &&
    destination === 'graveyard';
  const currentTurn = Number((game.state as any).turnNumber ?? (game.state as any).turn ?? 0) || 0;
  const discardTrackingCtx = {
    state: game.state,
    libraries: (game as any).libraries,
    bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
    rng: (game as any).rng,
    gameId,
  } as any;
  
  for (const cardId of selections) {
    const normalizedCardId = normalizeResolutionCardId(cardId);
    const cardIndex = zones.hand.findIndex((c: any) => normalizeResolutionCardId(c?.id) === normalizedCardId);
    if (cardIndex !== -1) {
      const [card] = zones.hand.splice(cardIndex, 1);
      movedCards.push(card);
      const madnessCost = shouldOfferMadnessPrompt ? parseMadnessCost(String(card?.oracle_text || '')) : undefined;
      if (madnessCost) {
        const exiledCard = {
          ...card,
          ...(exileTag ? { ...exileTag } : null),
          zone: 'exile',
          discardedByPlayerId: String(pid),
          discardedOnTurn: currentTurn,
        };
        zones.exile.push(exiledCard);
        movedCardsToExile.push(exiledCard);
        queuedMadnessPrompts.push({
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: pid as any,
          sourceId: String(exiledCard.id || card.id || ''),
          sourceName: 'Madness',
          sourceImage: exiledCard.image_uris?.small || exiledCard.image_uris?.normal || card.image_uris?.small || card.image_uris?.normal,
          description: `Madness: You may cast ${card.name || 'that card'} for ${madnessCost}.`,
          mandatory: false,
          options: [
            { id: 'cast', label: `Cast for Madness${madnessCost ? ` (${madnessCost})` : ''}`.trim() },
            { id: 'decline', label: 'Decline' },
          ],
          minSelections: 1,
          maxSelections: 1,
          madnessPrompt: true,
          resumeCleanupAfterPrompt: isCleanupDiscard || undefined,
          madnessCardId: String(exiledCard.id || card.id || ''),
          madnessCost,
          castFromExileCardId: String(exiledCard.id || card.id || ''),
          castFromExileCard: { ...exiledCard },
          castFromExileDeclineDestination: 'graveyard',
          castFromExileForcedAlternateCostId: 'madness',
          castFromExileCastWithoutPayingManaCost: false,
          castFromExileBypassExilePermissionCheck: true,
          castFromExileIgnoreTimingRestrictions: true,
        });
      } else if (destination === 'exile') {
        const exiledCard = {
          ...card,
          ...(exileTag ? { ...exileTag } : null),
          zone: 'exile',
          discardedByPlayerId: String(pid),
          discardedOnTurn: currentTurn,
        };
        zones.exile.push(exiledCard);
        movedCardsToExile.push(exiledCard);
      } else {
        const enteredGraveyard = pushCardToPlayerGraveyardWithReplacements(discardTrackingCtx, String(pid), card, zones.graveyard, {
          extraFields: {
            discardedByPlayerId: String(pid),
            discardedOnTurn: currentTurn,
          },
        });
        if (enteredGraveyard) {
          movedCardsToGraveyard.push(zones.graveyard[zones.graveyard.length - 1]);
        }
      }
    }
  }
  
  // Update counts
  zones.handCount = zones.hand.length;
  zones.graveyardCount = zones.graveyard.length;
  if (zones.exileCount !== undefined) {
    zones.exileCount = zones.exile.length;
  }

  if (!isExileFromHandCostActivation && movedCards.length > 0) {
    const stateAny = game.state as any;
    stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
    stateAny.discardedCardThisTurn[String(pid)] = true;
    stateAny.anyPlayerDiscardedCardThisTurn = true;
  }

  const queuedMadnessSteps = queuedMadnessPrompts.map((prompt) =>
    ResolutionQueueManager.addStep(gameId, {
      ...(prompt as any),
    } as any)
  );
  const discardedCardIdsForCost = movedCardsToGraveyard
    .map((card: any) => String(card?.id || ''))
    .filter(Boolean);
  const exiledCardIdsFromHandForCost = movedCardsToExile
    .map((card: any) => String(card?.id || ''))
    .filter(Boolean);
  const persistQueuedMadnessPromptsForCost = () => {
    if (queuedMadnessSteps.length === 0) return;
    try {
      appendQueuedResolutionPromptEvent(game, gameId, {
        playerId: String(pid),
        sourceId: String(step.sourceId || '').trim(),
        queuedResolutionSteps: queuedMadnessSteps.map((queuedStep: any) => ({ ...(queuedStep as any) })),
      });
    } catch {
      // ignore persistence failures
    }
  };
  
  // Clear legacy pending state if present
  if (game.state.pendingDiscardSelection?.[pid]) {
    delete game.state.pendingDiscardSelection[pid];
  }
  
  // Emit chat message
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message:
      destination === 'exile'
        ? `${getPlayerName(game, pid)} exiled ${selections.length} card(s) from hand.`
        : `${getPlayerName(game, pid)} discarded ${selections.length} card(s).`,
    ts: Date.now(),
  });

  if (!isDiscardCostActivation && !isExileFromHandCostActivation && !isGraveyardCastDiscardActivation && !isCleanupDiscard) {
    try {
      const shouldPersistResolvedDiscardStepId = dungeonRoomPayment
        || (step as any)?.reflexiveDiscardWhenYouDo === true
        || step.type === ResolutionStepType.DISCARD_SELECTION;
      const persistedSharedPayload = {
        playerId: pid,
        ...(shouldPersistResolvedDiscardStepId
          ? {
              resolvedStepId: String(step.id || '').trim(),
              sourceId: String(step.sourceId || '').trim(),
              ...(dungeonRoomPayment ? { dungeonRoomPayment } : null),
            }
          : {}),
      };

      if (movedCardsToGraveyard.length > 0) {
        appendEvent(gameId, (game as any).seq ?? 0, 'discardEffect', {
          ...persistedSharedPayload,
          cardIds: movedCardsToGraveyard.map((card: any) => String(card?.id || '')).filter(Boolean),
          destination: 'graveyard',
        });
      }

      if (movedCardsToExile.length > 0) {
        appendEvent(gameId, (game as any).seq ?? 0, 'discardEffect', {
          ...persistedSharedPayload,
          cardIds: movedCardsToExile.map((card: any) => String(card?.id || '')).filter(Boolean),
          destination: 'exile',
          ...(exileTag ? { exileTag } : {}),
        });
      }

      if (queuedMadnessSteps.length > 0) {
        appendQueuedResolutionPromptEvent(game, gameId, {
          playerId: String(pid),
          sourceId: String(step.sourceId || '').trim(),
          queuedResolutionSteps: queuedMadnessSteps.map((queuedStep: any) => ({ ...(queuedStep as any) })),
        });
      }
    } catch {
      // ignore persistence failures
    }
  }


  if (await tryResumeDiscardActivationCosts({
    io,
    game,
    gameId,
    step,
    pid,
    selections: selections as string[],
    discardedCardIdsForCost,
    exiledCardIdsFromHandForCost,
    queuedMadnessSteps,
    persistQueuedMadnessPromptsForCost,
  })) {
    return;
  }

  // Planeswalker helper: "You may discard a card. If you do, draw a card."
  const afterDiscardDrawCount = Math.max(0, Math.floor(Number((step as any)?.afterDiscardDrawCount || 0)));
  let followupDrawCount = 0;
  if (afterDiscardDrawCount > 0) {
    if (typeof (game as any).drawCards === 'function') {
      (game as any).drawCards(pid, afterDiscardDrawCount);
    } else {
      // Fallback draw: use game.libraries if present; else zones library.
      const lib = (game as any).libraries?.get?.(pid) || zones.library || [];
      for (let i = 0; i < afterDiscardDrawCount && lib.length > 0; i++) {
        const drawn = lib.shift();
        zones.hand.push({ ...drawn, zone: 'hand' });
      }
      zones.handCount = zones.hand.length;
      zones.libraryCount = lib.length;
      if ((game as any).libraries?.set) {
        (game as any).libraries.set(pid, lib);
      }
    }
    followupDrawCount += afterDiscardDrawCount;

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} drew ${afterDiscardDrawCount} card(s).`,
      ts: Date.now(),
    });
  }

  // Planeswalker helper: discard, draw, and if a land was discarded, draw extra.
  const afterDiscardDrawCountIfDiscardedLand = Math.max(
    0,
    Math.floor(Number((step as any)?.afterDiscardDrawCountIfDiscardedLand || 0)),
  );
  if (afterDiscardDrawCountIfDiscardedLand > 0) {
    const discardedALand = movedCards.some((c: any) => {
      const typeLine = String(c?.type_line || c?.typeLine || c?.card?.type_line || '').toLowerCase();
      return typeLine.includes('land');
    });
    if (discardedALand) {
      if (typeof (game as any).drawCards === 'function') {
        (game as any).drawCards(pid, afterDiscardDrawCountIfDiscardedLand);
      } else {
        const lib = (game as any).libraries?.get?.(pid) || zones.library || [];
        for (let i = 0; i < afterDiscardDrawCountIfDiscardedLand && lib.length > 0; i++) {
          const drawn = lib.shift();
          zones.hand.push({ ...drawn, zone: 'hand' });
        }
        zones.handCount = zones.hand.length;
        zones.libraryCount = lib.length;
        if ((game as any).libraries?.set) {
          (game as any).libraries.set(pid, lib);
        }
      }
      followupDrawCount += afterDiscardDrawCountIfDiscardedLand;

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} drew ${afterDiscardDrawCountIfDiscardedLand} additional card(s).`,
        ts: Date.now(),
      });
    }
  }


  // Rummage-style followups ("draw a card" ± land rider) already applied via
  // afterDiscardDrawCount*; do not also push a reflexive stack trigger.
  const rummageFollowupAlreadyApplied = afterDiscardDrawCount > 0
    || afterDiscardDrawCountIfDiscardedLand > 0;
  if ((step as any)?.reflexiveDiscardWhenYouDo === true && movedCards.length > 0 && !rummageFollowupAlreadyApplied) {
    const controllerId = String((step as any)?.reflexiveDiscardWhenYouDoController || pid);
    const sourceName = String((step as any)?.reflexiveDiscardWhenYouDoSourceName || step.sourceName || 'Ability');
    const sourcePermanentId = String((step as any)?.reflexiveDiscardWhenYouDoSourcePermanentId || step.sourceId || '').trim();
    const sourcePermanentSnapshot = getResolutionSourcePermanentSnapshot(game, step as any, sourcePermanentId || undefined);
    const sourceContext = buildTriggeredAbilitySourceContext(sourcePermanentSnapshot);
    const followupText = String((step as any)?.reflexiveDiscardWhenYouDoFollowupDescription || '').trim();
    const effectText = materializeReflexiveSourceText(followupText, sourceName);
    const discardedCardIds = movedCards.map((card: any) => String(card?.id || '')).filter(Boolean);
    const discardedCards = movedCards.map((card: any) => ({
      id: String(card?.id || ''),
      name: card?.name,
      type_line: card?.type_line,
      oracle_text: card?.oracle_text,
      mana_cost: card?.mana_cost,
      cmc: card?.cmc,
    }));
    const triggerId = uid('trigger');
    const targetMetadata = inferFollowupTargetMetadata(
      game,
      controllerId,
      sourceName,
      sourcePermanentId || undefined,
      effectText,
      sourcePermanentSnapshot,
    );
    const effectData = {
      discardedCardIds,
      discardedCards,
      discardCount: discardedCardIds.length,
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
      triggerType: 'reflexive_discard',
      mandatory: true,
      ...targetMetadata,
      ...sourceContext,
      effectData,
    };

    game.state.stack = Array.isArray(game.state.stack) ? game.state.stack : [];
    game.state.stack.push(stackItem);

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'reflexiveDiscardResolve', {
        playerId: controllerId,
        sourceId: sourcePermanentId || undefined,
        sourceName,
        resolvedStepId: String(step.id || '').trim() || undefined,
        cardIds: discardedCardIds,
        followupText,
        effect: effectText,
        triggerId,
        ...targetMetadata,
        effectData,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(reflexiveDiscardResolve) failed:', err);
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
        triggerType: 'reflexive_discard',
        mandatory: true,
        ...targetMetadata,
        ...sourceContext,
        effectData,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(pushTriggeredAbility reflexive discard) failed:', err);
    }
  }

  if (!isDiscardCostActivation && !isExileFromHandCostActivation && !isGraveyardCastDiscardActivation && !isCleanupDiscard && movedCards.length > 0) {
    queueDiscardTriggeredAbilities(game, gameId, String(pid), movedCards);
    queueDiscardTriggeredGraveyardCastAbilities(game, gameId, String(pid), movedCards);
  }

  if ((step as any)?.wardPayment === true) {
    const stepAny = step as any;
    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'wardPaymentResolve', {
        playerId: pid,
        stepId: String(stepAny?.id || step.id || ''),
        sourceId: String(stepAny?.wardTriggeredBy || stepAny?.sourceId || step.sourceId || '').trim(),
        wardCost: String(stepAny?.wardCost || '').trim(),
        wardPermanentId: String(stepAny?.wardPermanentId || '').trim(),
        wardPermanentName: String(stepAny?.wardPermanentName || step.sourceName || 'Ward'),
        wardPaymentType: 'discard',
      });
    } catch {
      // ignore persistence failures for ward payment resolution
    }
  }

  // Cleanup-step integration: after the discard is applied, advance through the
  // normal cleanup/turn transition logic (clears damage, ends EOT effects, Sundial pause).
  if (String((step as any)?.oracleIrResumeStepsJson || '').trim()) {
    const ctx = ((game as any).ctx || game) as any;
    ctx.gameId = gameId;
    ctx.state = game.state;
    maybeResumeOracleIRStepsAfterResolution(ctx, step);
  }

  maybeResumeDeferredOracleIrStackSpellOnGame(game, gameId);

  if (isCleanupDiscard) {
    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'cleanupDiscard', {
        playerId: pid,
        cardIds: movedCardsToGraveyard.map((card: any) => String(card?.id || '')).filter(Boolean),
        ...(exiledCardIdsFromHandForCost.length > 0 ? { exiledCardIds: exiledCardIdsFromHandForCost } : {}),
      });
      if (queuedMadnessSteps.length > 0) {
        appendQueuedResolutionPromptEvent(game, gameId, {
          playerId: String(pid),
          queuedResolutionSteps: queuedMadnessSteps.map((queuedStep: any) => ({ ...(queuedStep as any) })),
        });
      } else if (advanceStepPersistingEvent(io, game as any, gameId, {
        playerId: pid,
        reason: 'cleanupDiscardResolved',
      })) {
        // advanced
      }
    } catch (err) {
      debugWarn(1, `[Resolution] Failed to advance after cleanup discard:`, err);
    }
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}
