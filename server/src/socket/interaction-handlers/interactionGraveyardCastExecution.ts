/**
 * socket/interaction-handlers/interactionGraveyardCastExecution.ts
 *
 * Origin parent: server/src/socket/interaction.ts
 * Cluster moved: applying a graveyard-zone spell cast to the stack
 *   (`finalizeGraveyardSpellCast`), resuming that cast after cost/target
 *   payment (`continueCastFromGraveyardAbility`), and the encore token
 *   helpers those graveyard activations close over.
 * Public entry symbols: finalizeGraveyardSpellCast,
 *   continueCastFromGraveyardAbility, getNextEndStepFireTurnNumber,
 *   getEncoreTargetPlayerIds, createEncoreToken.
 */

import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/index.js";
import { appendEvent } from "../../db";
import { debugWarn } from "../../utils/debug.js";
import {
  calculateTotalAvailableMana,
  consumeManaFromPool,
  getOrInitManaPool,
  getPlayerName,
  parseManaCost,
  validateManaPayment,
} from "../util";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { canPayManaCostWithAvailableSources } from "../../state/modules/mana-check.js";
import {
  buildAlternateCastSpellManaCost,
  consumeDelayedSpellCopiesForCast,
  isGraveyardAlternateCastAbilityId,
  processHeroicTriggersForTargets,
  processOpponentSpellCastTriggersForCast,
  processSpellCastTriggersForCast,
  recordSpellCastThisTurn,
} from "../game-actions.js";
import {
  enforceGraveyardSpellCastTiming,
  getCastFromGraveyardActivationCost,
  getCastFromGraveyardDiscardCost,
  getCastFromGraveyardExileCost,
  getCastFromGraveyardResourceValidationError,
  getCastFromGraveyardSacrificeCost,
  getDirectGraveyardCastReplayMetadata,
  getEligiblePermanentsForSacrificeCost,
  markCardLeftGraveyardLive,
  markCastFromGraveyardLive,
} from "./interactionGraveyardCastCostAndTimingRules.js";
import { persistQueuedGraveyardAbilityStepActivation } from "./interactionActivationEventPersistence.js";
import {
  buildGraveyardCastSpellCard,
  normalizeSelectedTargetIds,
  queueGraveyardSpellCastTargetSelection,
} from "./interactionGraveyardSpellCastTargeting.js";

// Simple unique ID generator for this module
let idCounter = 0;
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++idCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

export function finalizeGraveyardSpellCast(params: {
  gameId: string;
  game: any;
  io: Server;
  playerId: string;
  cardId: string;
  abilityId: string;
  targets?: unknown;
  manaCost?: string;
  lifePaidForCost?: number;
  discardedCardIds?: string[];
  exiledCardIdsFromHandForCost?: string[];
  exiledCardIdsFromGraveyardForCost?: string[];
  xValue?: number;
  stackId?: string;
  // Mana payment evidence (present when the mana cost was paid by tapping/sacrificing sources
  // rather than from floating mana). Recorded on the event so replay can reconstruct the taps
  // and the net pool change instead of consuming from a pool that was never credited.
  tappedPermanentsForManaCost?: string[];
  sacrificedPermanentsForManaCost?: string[];
  paymentManaDelta?: Record<string, number>;
  emitError: (payload: { code: string; message: string }) => void;
}): 'cast' | 'error' {
  const zones = (params.game.state as any)?.zones?.[params.playerId];
  const graveyard = Array.isArray(zones?.graveyard) ? zones.graveyard : [];
  const cardIndex = graveyard.findIndex((entry: any) => entry && String(entry.id) === String(params.cardId));
  if (cardIndex === -1) {
    params.emitError({ code: 'CARD_NOT_IN_GRAVEYARD', message: 'Card not found in graveyard' });
    return 'error';
  }

  const normalizedTargets = normalizeSelectedTargetIds(params.targets);
  const [card] = graveyard.splice(cardIndex, 1);
  zones.graveyardCount = graveyard.length;
  markCardLeftGraveyardLive(params.game, params.playerId, card);
  markCastFromGraveyardLive(params.game, params.playerId);
  const replayMetadata = getDirectGraveyardCastReplayMetadata(params.game, params.playerId, card, params.abilityId);
  const spellCard = {
    ...buildGraveyardCastSpellCard(card, params.abilityId),
    ...replayMetadata,
    castFromGraveyard: true,
    castSourceZone: 'graveyard',
    fromZone: 'graveyard',
  };

  const stackId = String(params.stackId || '').trim() || generateId('stack');
  const stackItem = {
    id: stackId,
    controller: params.playerId,
    card: spellCard,
    ...(params.manaCost ? { manaCost: params.manaCost } : {}),
    castFromGraveyard: true,
    castSourceZone: 'graveyard',
    fromZone: 'graveyard',
    ...(replayMetadata.graveyardPermissionId ? { graveyardPermissionId: replayMetadata.graveyardPermissionId } : {}),
    ...(replayMetadata.graveyardPermissionSourceName ? { graveyardPermissionSourceName: replayMetadata.graveyardPermissionSourceName } : {}),
    ...(replayMetadata.graveyardPermissionCostMode ? { graveyardPermissionCostMode: replayMetadata.graveyardPermissionCostMode } : {}),
    ...(replayMetadata.castWithoutPayingManaCost ? { castWithoutPayingManaCost: true } : {}),
    ...(replayMetadata.alternateCostId ? { alternateCostId: replayMetadata.alternateCostId } : {}),
    ...(Number.isFinite(Number(params.xValue)) ? { xValue: Math.max(0, Math.floor(Number(params.xValue))) } : {}),
    targets: normalizedTargets,
    ...(spellCard?.entersBattlefieldWithCounters && typeof spellCard.entersBattlefieldWithCounters === 'object'
      ? { entersBattlefieldWithCounters: { ...(spellCard.entersBattlefieldWithCounters as Record<string, number>) } }
      : {}),
  };

  const pendingDelayedSpellCopies = Array.isArray((params.game.state as any)?.delayedSpellCopiesThisTurn)
    ? [...(params.game.state as any).delayedSpellCopiesThisTurn]
    : Array.isArray((params.game as any).delayedSpellCopiesThisTurn)
    ? [...(params.game as any).delayedSpellCopiesThisTurn]
    : [];

  params.game.state.stack = params.game.state.stack || [];
  params.game.state.stack.push(stackItem as any);

  if (typeof params.game.bumpSeq === 'function') {
    params.game.bumpSeq();
  }

  try {
    appendEvent(params.gameId, (params.game as any).seq ?? 0, 'activateGraveyardAbility', {
      playerId: params.playerId,
      cardId: params.cardId,
      abilityId: params.abilityId,
      stackId,
      manaCost: params.manaCost || undefined,
      fromZone: 'graveyard',
      lifePaidForCost: Number(params.lifePaidForCost || 0) > 0 ? Number(params.lifePaidForCost || 0) : undefined,
      ...(replayMetadata.graveyardPermissionId ? { graveyardPermissionId: replayMetadata.graveyardPermissionId } : {}),
      ...(replayMetadata.graveyardPermissionSourceName ? { graveyardPermissionSourceName: replayMetadata.graveyardPermissionSourceName } : {}),
      ...(replayMetadata.graveyardPermissionCostMode ? { graveyardPermissionCostMode: replayMetadata.graveyardPermissionCostMode } : {}),
      ...(replayMetadata.castWithoutPayingManaCost ? { castWithoutPayingManaCost: true } : {}),
      ...(replayMetadata.alternateCostId ? { alternateCostId: replayMetadata.alternateCostId } : {}),
      discardedCardIds: Array.isArray(params.discardedCardIds) && params.discardedCardIds.length > 0 ? params.discardedCardIds.slice() : undefined,
      exiledCardIdsFromHandForCost: Array.isArray(params.exiledCardIdsFromHandForCost) && params.exiledCardIdsFromHandForCost.length > 0
        ? params.exiledCardIdsFromHandForCost.slice()
        : undefined,
      exiledCardIdsFromGraveyardForCost: Array.isArray(params.exiledCardIdsFromGraveyardForCost) && params.exiledCardIdsFromGraveyardForCost.length > 0
        ? params.exiledCardIdsFromGraveyardForCost.slice()
        : undefined,
      xValue: Number.isFinite(Number(params.xValue)) ? Math.max(0, Math.floor(Number(params.xValue))) : undefined,
      targets: normalizedTargets.length > 0 ? normalizedTargets.slice() : undefined,
      tappedPermanents: Array.isArray(params.tappedPermanentsForManaCost) && params.tappedPermanentsForManaCost.length > 0
        ? params.tappedPermanentsForManaCost.slice()
        : undefined,
      sacrificedPermanents: Array.isArray(params.sacrificedPermanentsForManaCost) && params.sacrificedPermanentsForManaCost.length > 0
        ? params.sacrificedPermanentsForManaCost.slice()
        : undefined,
      paymentManaDelta: params.paymentManaDelta && typeof params.paymentManaDelta === 'object' && Object.keys(params.paymentManaDelta).length > 0
        ? { ...params.paymentManaDelta }
        : undefined,
    });
  } catch (err) {
    debugWarn(1, 'appendEvent(activateGraveyardAbility) failed:', err);
  }

  params.io.to(params.gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId: params.gameId,
    from: 'system',
    message: `${getPlayerName(params.game, params.playerId)} cast ${String(spellCard?.name || card?.name || 'that spell')} using ${params.abilityId}.`,
    ts: Date.now(),
  });

  recordSpellCastThisTurn(params.game, params.playerId, stackItem.card, 'graveyard');
  processSpellCastTriggersForCast(params.gameId, params.game, params.io as any, params.playerId, stackItem.card, 'graveyard', stackId);
  consumeDelayedSpellCopiesForCast(
    params.gameId,
    params.game,
    params.io as any,
    params.playerId,
    stackItem.card,
    stackId,
    stackItem,
    pendingDelayedSpellCopies,
  );
  if (normalizedTargets.length > 0) {
    processHeroicTriggersForTargets(params.game, params.playerId, normalizedTargets, params.io as any, params.gameId);
  }
  processOpponentSpellCastTriggersForCast(params.gameId, params.game, params.io as any, params.playerId, stackItem.card, 'graveyard');

  return 'cast';
}

export function continueCastFromGraveyardAbility(params: {
  gameId: string;
  game: any;
  io: Server;
  playerId: string;
  cardId: string;
  abilityId: string;
  targets?: unknown;
  discardedCardIds?: string[];
  exiledCardIdsFromHandForCost?: string[];
  exiledCardIdsFromGraveyardForCost?: string[];
  sacrificedPermanentIdsForCost?: string[];
  xValue?: number;
  // Set when re-entering after a queued mana-payment step has already paid the mana cost by
  // tapping/sacrificing sources. The mana block is then skipped and the payment evidence is
  // forwarded to finalizeGraveyardSpellCast for replay.
  manaCostAlreadyPaid?: boolean;
  tappedPermanentsForManaCost?: string[];
  sacrificedPermanentsForManaCost?: string[];
  paymentManaDelta?: Record<string, number>;
  emitError: (payload: { code: string; message: string }) => void;
}): 'queued' | 'cast' | 'error' {
  const zones = (params.game.state as any)?.zones?.[params.playerId];
  if (!zones || !Array.isArray(zones.graveyard)) {
    params.emitError({ code: 'GRAVEYARD_NOT_FOUND', message: 'Graveyard not found' });
    return 'error';
  }

  const cardIndex = zones.graveyard.findIndex((entry: any) => entry?.id === params.cardId);
  if (cardIndex === -1) {
    params.emitError({ code: 'CARD_NOT_IN_GRAVEYARD', message: 'Card not found in graveyard' });
    return 'error';
  }

  const card = zones.graveyard[cardIndex];
  const cardName = card?.name || 'Unknown';
  const normalizedTargets = normalizeSelectedTargetIds(params.targets);
  const activationCost = getCastFromGraveyardActivationCost(card, params.abilityId, { game: params.game, playerId: params.playerId });
  const normalizedAbilityId = String(params.abilityId || '').trim().toLowerCase();
  if (['flashback', 'jump-start', 'retrace', 'escape', 'disturb', 'graveyard-cast'].includes(normalizedAbilityId) && activationCost.hasAbility === false) {
    params.emitError({ code: 'ABILITY_NOT_AVAILABLE', message: `${cardName} does not currently have ${normalizedAbilityId}.` });
    return 'error';
  }
  if (
    ['flashback', 'jump-start', 'retrace', 'escape', 'disturb', 'graveyard-cast', 'harmonize'].includes(normalizedAbilityId)
    && !enforceGraveyardSpellCastTiming({
      game: params.game,
      playerId: String(params.playerId),
      card,
      abilityId: normalizedAbilityId,
      emitError: params.emitError,
    })
  ) {
    return 'error';
  }
  const recordedManaCost = String(activationCost.manaCost || '').trim();
  const recordedLifeCost = Number(activationCost.lifeCost || 0);
  const alternateCastCost = recordedManaCost && isGraveyardAlternateCastAbilityId(normalizedAbilityId)
    ? buildAlternateCastSpellManaCost(params.game, params.playerId, card, recordedManaCost, params.xValue)
    : null;
  const paymentManaCost = alternateCastCost?.adjustedManaCost || recordedManaCost;
  const graveyardCastCostAdjustment = alternateCastCost?.costAdjustment;
  const graveyardCastCostReduction = alternateCastCost?.costReduction;
  const discardCost = getCastFromGraveyardDiscardCost(card, params.abilityId);
  const exileCost = getCastFromGraveyardExileCost(card, params.abilityId, { game: params.game, playerId: params.playerId });
  const sacrificeCost = getCastFromGraveyardSacrificeCost(card, params.abilityId);
  const paidDiscardCount = (Array.isArray(params.discardedCardIds) ? params.discardedCardIds.length : 0)
    + (Array.isArray(params.exiledCardIdsFromHandForCost) ? params.exiledCardIdsFromHandForCost.length : 0);
  const paidGraveyardExileCount = Array.isArray(params.exiledCardIdsFromGraveyardForCost) ? params.exiledCardIdsFromGraveyardForCost.length : 0;
  const hasPaidGraveyardExileCost = exileCost
    ? (exileCost.exileCountIsX === true
      ? Number.isFinite(Number(params.xValue))
      : paidGraveyardExileCount >= exileCost.exileCount)
    : true;

  if (discardCost && paidDiscardCount < discardCost.discardCount) {
    const hand = Array.isArray(zones.hand) ? zones.hand : [];
    const eligibleHand = discardCost.discardTypeRestriction
      ? hand.filter((entry: any) => String(entry?.type_line || '').toLowerCase().includes(discardCost.discardTypeRestriction as string))
      : hand;

    if (eligibleHand.length < discardCost.discardCount) {
      params.emitError({
        code: 'CANNOT_PAY_COST',
        message: discardCost.discardTypeRestriction
          ? `Cannot cast ${cardName} using ${params.abilityId}: you need to discard ${discardCost.discardCount} ${discardCost.discardTypeRestriction} card${discardCost.discardCount === 1 ? '' : 's'}.`
          : `Cannot cast ${cardName} using ${params.abilityId}: you need to discard ${discardCost.discardCount} card${discardCost.discardCount === 1 ? '' : 's'}.`,
      });
      return 'error';
    }

    const discardTypeLabel = discardCost.discardTypeRestriction ? `${discardCost.discardTypeRestriction} ` : '';
    const discardStep = ResolutionQueueManager.addStep(params.gameId, {
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId: params.playerId as PlayerID,
      sourceId: params.cardId,
      sourceName: cardName,
      sourceImage: (card as any)?.image_uris?.small || (card as any)?.image_uris?.normal,
      description: `${cardName}: Discard ${discardCost.discardCount} ${discardTypeLabel}card${discardCost.discardCount === 1 ? '' : 's'} to cast it using ${params.abilityId}.`,
      mandatory: false,
      hand: eligibleHand,
      discardCount: discardCost.discardCount,
      currentHandSize: eligibleHand.length,
      maxHandSize: Math.max(7, eligibleHand.length),
      reason: 'activation_cost',
      graveyardCastDiscardAsCost: true,
      cardId: params.cardId,
      abilityId: params.abilityId,
      cardName,
      manaCost: paymentManaCost || undefined,
      lifeToPayForCost: recordedLifeCost > 0 ? recordedLifeCost : undefined,
      discardTypeRestriction: discardCost.discardTypeRestriction || undefined,
      targetsForCast: normalizedTargets.length > 0 ? normalizedTargets : undefined,
    } as any);

    persistQueuedGraveyardAbilityStepActivation({
      gameId: params.gameId,
      game: params.game,
      playerId: String(params.playerId),
      cardId: String(params.cardId),
      abilityId: String(params.abilityId),
      queuedStep: {
        ...(discardStep as any),
      },
    });
    return 'queued';
  }

  if (exileCost && !hasPaidGraveyardExileCost) {
    const graveyardCards = Array.isArray(zones.graveyard) ? zones.graveyard : [];
    const eligibleGraveyardCards = graveyardCards.filter((entry: any) => String(entry?.id || '') !== String(params.cardId));

    if (!exileCost.exileCountIsX && eligibleGraveyardCards.length < exileCost.exileCount) {
      params.emitError({
        code: 'CANNOT_PAY_COST',
        message: `Cannot cast ${cardName} using ${params.abilityId}: you need to exile ${exileCost.exileCount} other card${exileCost.exileCount === 1 ? '' : 's'} from your graveyard.`,
      });
      return 'error';
    }

    const dynamicExileCost = exileCost.exileCountIsX === true;
    const minExileTargets = dynamicExileCost ? 0 : exileCost.exileCount;
    const maxExileTargets = dynamicExileCost ? eligibleGraveyardCards.length : exileCost.exileCount;
    const description = dynamicExileCost
      ? `${cardName}: Exile any number of other cards from your graveyard to set X and cast it using ${params.abilityId}.`
      : `${cardName}: Exile ${exileCost.exileCount} other card${exileCost.exileCount === 1 ? '' : 's'} from your graveyard to cast it using ${params.abilityId}.`;
    const title = dynamicExileCost
      ? `Choose cards to exile for X on ${cardName}`
      : `Exile ${exileCost.exileCount} other card${exileCost.exileCount === 1 ? '' : 's'} for ${cardName}`;

    const exileStep = ResolutionQueueManager.addStep(params.gameId, {
      type: ResolutionStepType.GRAVEYARD_SELECTION,
      playerId: params.playerId as PlayerID,
      sourceId: params.cardId,
      sourceName: cardName,
      sourceImage: (card as any)?.image_uris?.small || (card as any)?.image_uris?.normal,
      description,
      mandatory: false,
      targetPlayerId: params.playerId,
      minTargets: minExileTargets,
      maxTargets: maxExileTargets,
      destination: 'exile',
      cardId: params.cardId,
      cardName,
      title,
      validTargets: eligibleGraveyardCards.map((graveyardCard: any) => ({
        id: graveyardCard.id,
        label: graveyardCard.name || 'Card',
        description: graveyardCard.type_line || 'Card',
        imageUrl: graveyardCard.image_uris?.small || graveyardCard.image_uris?.normal,
      })),
      graveyardCastExileAsCost: true,
      exileCountIsX: dynamicExileCost || undefined,
      abilityId: params.abilityId,
      manaCost: paymentManaCost || undefined,
      lifeToPayForCost: recordedLifeCost > 0 ? recordedLifeCost : undefined,
      targetsForCast: normalizedTargets.length > 0 ? normalizedTargets : undefined,
    } as any);

    persistQueuedGraveyardAbilityStepActivation({
      gameId: params.gameId,
      game: params.game,
      playerId: String(params.playerId),
      cardId: String(params.cardId),
      abilityId: String(params.abilityId),
      queuedStep: {
        ...(exileStep as any),
      },
    });
    return 'queued';
  }

  if (sacrificeCost && !(Array.isArray(params.sacrificedPermanentIdsForCost) && params.sacrificedPermanentIdsForCost.length >= sacrificeCost.sacrificeCount)) {
    const resourceValidationError = getCastFromGraveyardResourceValidationError(
      params.game,
      params.playerId,
      paymentManaCost || undefined,
      recordedLifeCost > 0 ? recordedLifeCost : undefined,
    );
    if (resourceValidationError) {
      params.emitError(resourceValidationError);
      return 'error';
    }

    const battlefield = Array.isArray(params.game.state?.battlefield) ? params.game.state.battlefield : [];
    const eligiblePermanents = getEligiblePermanentsForSacrificeCost(
      battlefield,
      params.playerId,
      sacrificeCost.sacrificeType,
      sacrificeCost.sacrificeSubtype,
      sacrificeCost.mustBeOther,
    );

    let sacrificeLabel = sacrificeCost.sacrificeSubtype || sacrificeCost.sacrificeType;
    if (sacrificeCost.sacrificeType === 'artifact_or_creature') {
      sacrificeLabel = 'artifact or creature';
    } else if (sacrificeCost.sacrificeType === 'nonland_permanent') {
      sacrificeLabel = 'nonland permanent';
    }
    const sacrificeLabelPlural = sacrificeCost.sacrificeCount === 1 ? sacrificeLabel : `${sacrificeLabel}s`;
    if (eligiblePermanents.length < sacrificeCost.sacrificeCount) {
      params.emitError({
        code: 'CANNOT_PAY_COST',
        message: `Cannot cast ${cardName} using ${params.abilityId}: you need to sacrifice ${sacrificeCost.sacrificeCount} ${sacrificeLabelPlural}.`,
      });
      return 'error';
    }

    const existingSacrificeStep = ResolutionQueueManager
      .getStepsForPlayer(params.gameId, params.playerId as any)
      .find((step: any) =>
        step?.type === ResolutionStepType.TARGET_SELECTION
        && (step as any)?.graveyardCastSacrificeAsCost === true
        && String((step as any)?.cardId || step?.sourceId || '') === String(params.cardId)
      );

    if (!existingSacrificeStep) {
      const sacrificeStep = ResolutionQueueManager.addStep(params.gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: params.playerId as PlayerID,
        sourceId: params.cardId,
        sourceName: cardName,
        sourceImage: (card as any)?.image_uris?.small || (card as any)?.image_uris?.normal,
        description: `${cardName}: Sacrifice ${sacrificeCost.sacrificeCount} ${sacrificeLabelPlural} to cast it using ${params.abilityId}.`,
        mandatory: false,
        validTargets: eligiblePermanents.map((perm: any) => ({
          id: perm.id,
          label: perm.card?.name || 'Permanent',
          description: perm.card?.type_line || 'Permanent',
          imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
        })),
        targetTypes: ['sacrifice_cost'],
        minTargets: sacrificeCost.sacrificeCount,
        maxTargets: sacrificeCost.sacrificeCount,
        targetDescription: `${sacrificeLabelPlural} you control`,
        sacrificeSelection: true,
        sacrificeSourceName: cardName,
        sacrificePermanentType: sacrificeCost.sacrificeType === 'artifact_or_creature' ? 'permanent' : sacrificeCost.sacrificeType === 'nonland_permanent' ? 'nonland permanent' : sacrificeCost.sacrificeType,
        sacrificeReason: `Cast ${cardName} using ${params.abilityId}`,
        graveyardCastSacrificeAsCost: true,
        cardId: params.cardId,
        abilityId: params.abilityId,
        cardName,
        manaCost: paymentManaCost || undefined,
        lifeToPayForCost: recordedLifeCost > 0 ? recordedLifeCost : undefined,
        sacrificeType: sacrificeCost.sacrificeType,
        sacrificeSubtype: sacrificeCost.sacrificeSubtype,
        sacrificeCount: sacrificeCost.sacrificeCount,
        mustBeOther: sacrificeCost.mustBeOther || undefined,
        targetsForCast: normalizedTargets.length > 0 ? normalizedTargets : undefined,
        discardedCardIdsForCost: Array.isArray(params.discardedCardIds) && params.discardedCardIds.length > 0 ? params.discardedCardIds.slice() : undefined,
        exiledCardIdsFromHandForCost: Array.isArray(params.exiledCardIdsFromHandForCost) && params.exiledCardIdsFromHandForCost.length > 0
          ? params.exiledCardIdsFromHandForCost.slice()
          : undefined,
        exiledCardIdsFromGraveyardForCost: Array.isArray(params.exiledCardIdsFromGraveyardForCost) && params.exiledCardIdsFromGraveyardForCost.length > 0
          ? params.exiledCardIdsFromGraveyardForCost.slice()
          : undefined,
      } as any);

      persistQueuedGraveyardAbilityStepActivation({
        gameId: params.gameId,
        game: params.game,
        playerId: String(params.playerId),
        cardId: String(params.cardId),
        abilityId: String(params.abilityId),
        queuedStep: {
          ...(sacrificeStep as any),
        },
      });
    }

    return 'queued';
  }

  if (normalizedTargets.length === 0) {
    const targetSelectionResult = queueGraveyardSpellCastTargetSelection({
      gameId: params.gameId,
      game: params.game,
      playerId: params.playerId,
      cardId: params.cardId,
      abilityId: params.abilityId,
      card,
      manaCost: paymentManaCost,
      lifeToPayForCost: recordedLifeCost,
      discardedCardIdsForCost: params.discardedCardIds,
      exiledCardIdsFromHandForCost: params.exiledCardIdsFromHandForCost,
      exiledCardIdsFromGraveyardForCost: params.exiledCardIdsFromGraveyardForCost,
      sacrificedPermanentIdsForCost: params.sacrificedPermanentIdsForCost,
      xValue: params.xValue,
      emitError: params.emitError,
    });
    if (targetSelectionResult) {
      return targetSelectionResult;
    }
  }

  if (paymentManaCost && !params.manaCostAlreadyPaid) {
    const parsedCost = parseManaCost(paymentManaCost);
    const pool = getOrInitManaPool(params.game.state, params.playerId);
    const totalAvailable = calculateTotalAvailableMana(pool, []);
    const floatingError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
    if (!floatingError) {
      // Floating mana already covers the cost — consume it directly (preserves the prior behavior
      // for players who float mana before casting).
      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, `[activateGraveyardAbility:${cardName}]`);
    } else if (canPayManaCostWithAvailableSources(params.game.state, params.playerId, parsedCost)) {
      // Floating mana is insufficient but the player can pay by tapping untapped sources (lands,
      // etc.). Queue a mana-payment step so the player/AI taps sources, then resume the cast.
      // Flashback (and other graveyard casts) must not be restricted to floating mana only.
      ResolutionQueueManager.addStep(params.gameId, {
        type: ResolutionStepType.MANA_PAYMENT_CHOICE,
        playerId: params.playerId as PlayerID,
        sourceId: params.cardId,
        sourceName: cardName,
        sourceImage: (card as any)?.image_uris?.small || (card as any)?.image_uris?.normal,
        description: `Pay ${paymentManaCost} to cast ${cardName} using ${params.abilityId}.`,
        mandatory: true,
        // spellPaymentRequired drives the client payment modal and the AI payment assembly;
        // graveyardSpellCastManaPayment routes completion back through this function.
        spellPaymentRequired: true,
        graveyardSpellCastManaPayment: true,
        cardId: params.cardId,
        cardName,
        manaCost: paymentManaCost,
        fromZone: 'graveyard',
        abilityId: params.abilityId,
        targetsForCast: normalizedTargets.length > 0 ? normalizedTargets : undefined,
        lifeToPayForCost: recordedLifeCost > 0 ? recordedLifeCost : undefined,
        discardedCardIdsForCost: Array.isArray(params.discardedCardIds) && params.discardedCardIds.length > 0 ? params.discardedCardIds.slice() : undefined,
        exiledCardIdsFromHandForCost: Array.isArray(params.exiledCardIdsFromHandForCost) && params.exiledCardIdsFromHandForCost.length > 0 ? params.exiledCardIdsFromHandForCost.slice() : undefined,
        exiledCardIdsFromGraveyardForCost: Array.isArray(params.exiledCardIdsFromGraveyardForCost) && params.exiledCardIdsFromGraveyardForCost.length > 0 ? params.exiledCardIdsFromGraveyardForCost.slice() : undefined,
        sacrificedPermanentIdsForCost: Array.isArray(params.sacrificedPermanentIdsForCost) && params.sacrificedPermanentIdsForCost.length > 0 ? params.sacrificedPermanentIdsForCost.slice() : undefined,
        xValue: Number.isFinite(Number(params.xValue)) ? Math.max(0, Math.floor(Number(params.xValue))) : undefined,
        oracleText: String((card as any)?.oracle_text || '').trim() || undefined,
        typeLine: String((card as any)?.type_line || ''),
        type_line: String((card as any)?.type_line || ''),
        ...(graveyardCastCostAdjustment ? { costAdjustment: graveyardCastCostAdjustment } : {}),
        ...(graveyardCastCostReduction && graveyardCastCostReduction.messages.length > 0
          ? { costReduction: graveyardCastCostReduction }
          : {}),
      } as any);
      return 'queued';
    } else {
      params.emitError({ code: 'INSUFFICIENT_MANA', message: `Cannot pay ${paymentManaCost}: ${floatingError}` });
      return 'error';
    }
  }

  if (recordedLifeCost > 0) {
    const currentLife = Number(params.game.state.life?.[params.playerId] ?? params.game.state.startingLife ?? 40);
    if (!Number.isFinite(currentLife) || currentLife <= recordedLifeCost) {
      params.emitError({
        code: 'INSUFFICIENT_LIFE',
        message: `Cannot pay ${recordedLifeCost} life (you have ${Number.isFinite(currentLife) ? currentLife : 0} life)`,
      });
      return 'error';
    }
    params.game.state.life = params.game.state.life || {};
    params.game.state.life[params.playerId] = currentLife - recordedLifeCost;
    try {
      (params.game.state as any).lifeLostThisTurn = (params.game.state as any).lifeLostThisTurn || {};
      (params.game.state as any).lifeLostThisTurn[String(params.playerId)] = ((params.game.state as any).lifeLostThisTurn[String(params.playerId)] || 0) + recordedLifeCost;
    } catch {}
  }

  return finalizeGraveyardSpellCast({
    gameId: params.gameId,
    game: params.game,
    io: params.io,
    playerId: params.playerId,
    cardId: params.cardId,
    abilityId: params.abilityId,
    targets: normalizedTargets,
    manaCost: paymentManaCost || undefined,
    lifePaidForCost: recordedLifeCost > 0 ? recordedLifeCost : undefined,
    discardedCardIds: params.discardedCardIds,
    exiledCardIdsFromHandForCost: params.exiledCardIdsFromHandForCost,
    exiledCardIdsFromGraveyardForCost: params.exiledCardIdsFromGraveyardForCost,
    xValue: params.xValue,
    emitError: params.emitError,
  });
}

export function getNextEndStepFireTurnNumber(state: any): number {
  const currentTurn = Number(state?.turnNumber ?? state?.turn ?? 0) || 0;
  const currentPhase = String(state?.phase ?? '').toLowerCase();
  const currentStepUpper = String(state?.step ?? '').toUpperCase();
  const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
  return inEnding ? currentTurn + 1 : currentTurn;
}

export function getEncoreTargetPlayerIds(state: any, controllerId: string): string[] {
  const players = Array.isArray(state?.players) ? state.players : [];
  return players
    .filter((player: any) => player?.id && String(player.id) !== String(controllerId) && !player.hasLost)
    .map((player: any) => String(player.id));
}

export function createEncoreToken(state: any, controllerId: string, card: any, tokenId: string, targetPlayerId: string): any {
  const grantedAbilities = Array.isArray(card?.keywords)
    ? [...card.keywords]
    : [];
  if (!grantedAbilities.some((ability: string) => String(ability).toLowerCase() === 'haste')) {
    grantedAbilities.push('Haste');
  }

  const power = Number.parseInt(String(card?.power ?? ''), 10);
  const toughness = Number.parseInt(String(card?.toughness ?? ''), 10);
  const oracleText = String(card?.oracle_text || '');
  const oracleWithHaste = /(^|\n)haste(\n|$)/i.test(oracleText)
    ? oracleText
    : `${oracleText}${oracleText ? '\n' : ''}Haste`;

  return {
    id: tokenId,
    controller: controllerId,
    owner: controllerId,
    tapped: false,
    counters: {},
    summoningSickness: false,
    isToken: true,
    mustAttack: true,
    encoreAttackPlayerId: targetPlayerId,
    copiedFromCardId: String(card?.id || ''),
    ...(Number.isFinite(power) ? { basePower: power } : {}),
    ...(Number.isFinite(toughness) ? { baseToughness: toughness } : {}),
    grantedAbilities,
    card: {
      ...card,
      id: tokenId,
      zone: 'battlefield',
      oracle_text: oracleWithHaste,
      keywords: grantedAbilities,
    },
  } as any;
}
