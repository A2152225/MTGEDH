// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the applyMoveZoneStep selector guards starting at if (parsedBothCards && step.to === 'battlefield') {
// Public entry symbol: tryApplyMoveZoneGuardsFromBothCards.

import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';
import { parseSimpleBattlefieldSelector } from './oracleIRExecutorBattlefieldParser';
import { hasExecutorClass, getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { bounceMatchingBattlefieldPermanentsToOwnersHands, moveBattlefieldPermanentsByIdToOwnersLibraries, moveBattlefieldPermanentsByIdToOwnersHands } from './oracleIRExecutorBattlefieldOps';
import {
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
  moveTargetedCardFromExile,
  cardHasMorphAbility,
  selectGraveyardCardIdsWithDistinctManaValues,
  cardMatchesTotalPowerToughnessLte,
  cardMatchesType,
} from './oracleIRExecutorZoneOps';
import {
  buildNameReferenceAliases,
  buildNoOpOptionalSingleTargetResult,
  collectBothCardsZoneEntries,
  findBoundCardZoneLocation,
  getChosenObjectIds,
  normalizeReferenceText,
  resolveBoundGraveyardTargetObjectId,
  resolveSourceCardZoneLocation,
  resolveUniqueChosenGraveyardTargetId,
} from './oracleIRExecutorMoveZoneReferenceResolvers';
import { getLibraryPlacement } from './oracleIRExecutorMoveZoneContextualCardResolvers';
import { annotateExiledCardsWithSource, buildAppliedResult } from './oracleIRExecutorMoveZoneStepResultBuilders';
import {
  getPermanentToughnessValue,
  handCardSharesCreatureTypeWithEachPermanent,
  permanentDealtDamageThisTurn,
  permanentHasAnyListedCreatureType,
  resolveTappedThisWayPermanentIds,
} from './oracleIRExecutorMoveZonePermanentSelectors';

export function tryApplyMoveZoneGuardsFromBothCards(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {
  const { state, step, ctx, runtime, nextState, log, controllerId, effectiveWithCounters, battlefieldEntryOverrides, finalizeAppliedResult, attachmentResolution, sourcePermanentPower, boundTargetObjectId } = args;
  const {
    parsedCreatureFromHandSharingTypeWithEachTappedThisWay,
    parsedEachCreatureThatDealtDamageThisTurn,
    parsedCountTypedCards,
    parsedCreatureYouDontControlLowestToughness,
    parsedThatManyCreatureCardsFromYourGraveyard,
    parsedEachCreatureExcludingListedTypes,
    parsedCreatureHandTotalPowerToughnessLte,
    parsedAnyNumberDistinctManaValuesFromYourGraveyard,
  } = args.zoneQueries;
  const {
    parsedBothCards,
    parsedOneOfThoseDragons,
    parsedMorphCreatureFromHand,
    parsedAurasAttachedToTargetPermanentYouOwn,
    parsedEachAttackingCreature,
    parsedAllCreatureTokens,
    parsedTargetCreatureOwnerLibraryChoice,
    parsedThisCardAndNamedFromGy,
    parsedThisCardAndTargetFromGy,
  } = args.referenceQueries;

  if (parsedBothCards && step.to === 'battlefield') {
    const cardsToPut = collectBothCardsZoneEntries(nextState, controllerId, ctx, runtime);
    if (cardsToPut.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No both-cards match: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const entry of cardsToPut) {
      const result =
        entry.zone === 'hand'
          ? moveTargetedCardFromHand(
              workingState,
              entry.playerId,
              entry.cardId,
              'any',
              'battlefield',
              controllerId,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
              battlefieldEntryOverrides
            )
          : entry.zone === 'exile'
            ? moveTargetedCardFromExile(
                workingState,
                entry.playerId,
                entry.cardId,
                'any',
                'battlefield',
                controllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
                battlefieldEntryOverrides
              )
            : moveTargetedCardFromGraveyard(
                workingState,
                entry.playerId,
                entry.cardId,
                { cardType: 'any' },
                'battlefield',
                controllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
                undefined,
                battlefieldEntryOverrides
              );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      if (Array.isArray(result.movedPermanentIds)) {
        movedBattlefieldIds.push(...result.movedPermanentIds);
      }
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Put both cards onto the battlefield: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedOneOfThoseDragons && step.to === 'hand') {
    const preferred = new Set(getChosenObjectIds(ctx));
    const battlefield = (nextState.battlefield || []) as any[];
    let dragons = battlefield.filter((perm: any) => {
      const permanentId = String(perm?.id || '').trim();
      if (String(perm?.controller || '').trim() !== controllerId) return false;
      if (!getExecutorTypeLineLower(perm).includes('dragon')) return false;
      if (preferred.size > 0 && !preferred.has(permanentId)) return false;
      return true;
    });
    if (dragons.length === 0) {
      dragons = battlefield.filter((perm: any) => {
        const permanentId = String(perm?.id || '').trim();
        return (
          String(perm?.controller || '').trim() === controllerId &&
          hasExecutorClass(perm, 'creature') &&
          getExecutorTypeLineLower(perm).includes('dragon')
        );
      });
    }
    const targetId = String((dragons[0] as any)?.id || '').trim();
    if (!targetId) {
      return buildAppliedResult({ state: nextState, log: [`No dragon to return: ${step.raw}`] });
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, [targetId]);
    return finalizeAppliedResult(result);
  }

  if (parsedMorphCreatureFromHand && step.to === 'battlefield') {
    const player = nextState.players.find(entry => entry.id === controllerId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    const preferred = new Set(getChosenObjectIds(ctx));
    const pick =
      hand.find(
        (card: any) =>
          preferred.has(String(card?.id || '').trim()) &&
          cardHasMorphAbility(card) &&
          cardMatchesType(card, 'creature')
      ) ||
      hand.find((card: any) => cardHasMorphAbility(card) && cardMatchesType(card, 'creature'));
    const cardId = String((pick as any)?.id || '').trim();
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No morph creature in hand: ${step.raw}`] });
    }
    const result = moveTargetedCardFromHand(
      nextState,
      controllerId,
      cardId,
      'creature',
      'battlefield',
      controllerId,
      step.entersTapped,
      false,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (morph creature unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedAurasAttachedToTargetPermanentYouOwn && step.to === 'hand') {
    const targetPermanentId = String(
      ctx.targetPermanentId || ctx.selectorContext?.targetPermanentId || 'bf-legendary-creature'
    ).trim();
    const battlefield = [...((nextState.battlefield || []) as any[])];
    const auraIds = battlefield
      .filter(perm => {
        const attachedTo = String((perm as any)?.attachedTo || (perm as any)?.enchanting || '').trim();
        return (
          attachedTo === targetPermanentId &&
          getExecutorTypeLineLower(perm).includes('aura') &&
          String((perm as any)?.owner || (perm as any)?.controller || '').trim() === controllerId
        );
      })
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, auraIds);
    return finalizeAppliedResult(result);
  }

  if (parsedAllCreatureTokens && step.to === 'hand') {
    const selector = parseSimpleBattlefieldSelector({ kind: 'raw', text: 'all creature tokens' });
    if (!selector) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const result = bounceMatchingBattlefieldPermanentsToOwnersHands(nextState, selector, ctx);
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Returned all creature tokens: ${step.raw}`],
    });
  }

  if (parsedTargetCreatureOwnerLibraryChoice && step.to === 'library') {
    const targetId =
      getChosenObjectIds(ctx).find(id =>
        ((nextState.battlefield || []) as any[]).some(
          (perm: any) => String(perm?.id || '').trim() === id
        )
      ) ||
      String(ctx.targetCreatureId || ctx.targetPermanentId || '').trim() ||
      '';
    if (!targetId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const placementRaw = String(
      (ctx as any).libraryPlacement || ctx.selectorContext?.libraryPlacement || 'bottom'
    )
      .trim()
      .toLowerCase();
    const placement = placementRaw === 'top' ? 'top' : 'bottom';
    const result = moveBattlefieldPermanentsByIdToOwnersLibraries(nextState, [targetId], placement);
    return finalizeAppliedResult({
      applied: true,
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Put target creature on ${placement} of owner's library: ${step.raw}`],
    });
  }

  if (parsedCreatureFromHandSharingTypeWithEachTappedThisWay && step.to === 'battlefield') {
    const tappedIds = resolveTappedThisWayPermanentIds(ctx, runtime);
    const battlefield = (nextState.battlefield || []) as any[];
    const tappedPermanents = tappedIds
      .map(id => battlefield.find(perm => String(perm?.id || '').trim() === id))
      .filter(Boolean);
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    const preferred = getChosenObjectIds(ctx);
    const matchingCards = hand.filter((card: any) =>
      handCardSharesCreatureTypeWithEachPermanent(card, tappedPermanents)
    );
    const cardId =
      preferred.find(id => matchingCards.some((card: any) => String(card?.id || '').trim() === id)) ||
      String((matchingCards[0] as any)?.id || '').trim();
    if (!cardId) {
      if (step.optional) {
        return buildAppliedResult({
          state: nextState,
          log: [`No matching creature card from hand for tapped types: ${step.raw}`],
        });
      }
      return buildAppliedResult({
        state: nextState,
        log: [`No matching creature card from hand for tapped types: ${step.raw}`],
      });
    }
    const result = moveTargetedCardFromHand(
      nextState,
      controllerId,
      cardId,
      'creature',
      'battlefield',
      controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      battlefieldEntryOverrides
    );
    return result.kind === 'impossible'
      ? buildAppliedResult({ state: nextState, log: [`Matching hand creature unavailable: ${step.raw}`] })
      : finalizeAppliedResult(result);
  }

  if (parsedAnyNumberDistinctManaValuesFromYourGraveyard && step.to === 'hand') {
    const cardIds = selectGraveyardCardIdsWithDistinctManaValues(
      nextState,
      controllerId,
      getChosenObjectIds(ctx)
    );
    if (cardIds.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No graveyard cards with distinct mana values: ${step.raw}`],
      });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        controllerId,
        cardId,
        { cardType: 'any' },
        'hand'
      );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log:
        combinedLog.length > 0
          ? combinedLog
          : [`Returned distinct-mana-value graveyard cards to hand: ${step.raw}`],
    });
  }

  if (parsedCreatureHandTotalPowerToughnessLte && step.to === 'battlefield') {
    const maxTotal = parsedCreatureHandTotalPowerToughnessLte.totalPowerToughnessLte;
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    const preferred = getChosenObjectIds(ctx);
    const candidates = hand.filter(
      (card: any) => cardMatchesType(card, 'creature') && cardMatchesTotalPowerToughnessLte(card, maxTotal)
    );
    const cardId =
      preferred.find(id => candidates.some((card: any) => String(card?.id || '').trim() === id)) ||
      String((candidates[0] as any)?.id || '').trim();
    if (!cardId) {
      return buildAppliedResult({
        state: nextState,
        log: [`No matching creature in hand for total power/toughness put: ${step.raw}`],
      });
    }
    const result = moveTargetedCardFromHand(
      nextState,
      controllerId,
      cardId,
      'creature',
      'battlefield',
      controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      battlefieldEntryOverrides
    );
    return result.kind === 'impossible'
      ? buildAppliedResult({ state: nextState, log: [`Matching hand creature unavailable: ${step.raw}`] })
      : finalizeAppliedResult(result);
  }

  if (parsedCountTypedCards && step.to === 'battlefield') {
    const { count, cardType } = parsedCountTypedCards;
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const hand = Array.isArray(player?.hand) ? [...player.hand] : [];
    const preferred = getChosenObjectIds(ctx);
    const matchingCards = hand.filter((card: any) => cardMatchesType(card, cardType));
    const orderedIds = [
      ...preferred.filter(id => matchingCards.some((card: any) => String(card?.id || '').trim() === id)),
      ...matchingCards
        .map((card: any) => String(card?.id || '').trim())
        .filter(id => id && !preferred.includes(id)),
    ];
    const cardIds = Array.from(new Set(orderedIds)).slice(0, count);
    if (cardIds.length === 0) {
      if (step.optional) {
        return buildAppliedResult({ state: nextState, log: [`No matching cards for count put: ${step.raw}`] });
      }
      return buildAppliedResult({ state: nextState, log: [`No matching cards for count put: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromHand(
        workingState,
        controllerId,
        cardId,
        cardType,
        'battlefield',
        controllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
        battlefieldEntryOverrides
      );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Put ${cardIds.length} card(s) onto the battlefield: ${step.raw}`],
      lastMovedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedCreatureYouDontControlLowestToughness && step.to === 'hand') {
    const opponentsCreatures = ((nextState.battlefield || []) as any[]).filter(
      perm =>
        hasExecutorClass(perm as any, 'creature') &&
        String((perm as any)?.controller || '').trim() !== controllerId
    );
    let minToughness = Number.POSITIVE_INFINITY;
    for (const perm of opponentsCreatures) {
      const toughness = getPermanentToughnessValue(perm);
      if (toughness !== null) minToughness = Math.min(minToughness, toughness);
    }
    const candidates = opponentsCreatures.filter(perm => {
      const toughness = getPermanentToughnessValue(perm);
      return toughness !== null && toughness === minToughness;
    });
    if (candidates.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No opponent creature with lowest toughness: ${step.raw}`],
      });
    }
    const preferred = getChosenObjectIds(ctx);
    const targetId =
      preferred.find(id => candidates.some(perm => String((perm as any)?.id || '').trim() === id)) ||
      String((candidates[0] as any)?.id || '').trim();
    if (!targetId) {
      return buildAppliedResult({
        state: nextState,
        log: [`No opponent creature with lowest toughness: ${step.raw}`],
      });
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, [targetId]);
    return finalizeAppliedResult(result);
  }

  if (parsedThatManyCreatureCardsFromYourGraveyard && step.to === 'battlefield') {
    const count = Math.max(
      0,
      Number(ctx.referenceAmount ?? ctx.xValue ?? ctx.lastReferenceAmount ?? runtime?.lastReferenceAmount ?? 0)
    );
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    const preferred = getChosenObjectIds(ctx);
    const candidates = graveyard.filter((card: any) => cardMatchesType(card, 'creature'));
    const orderedIds = [
      ...preferred.filter(id => candidates.some((card: any) => String(card?.id || '').trim() === id)),
      ...candidates
        .map((card: any) => String(card?.id || '').trim())
        .filter(id => id && !preferred.includes(id)),
    ];
    const cardIds = Array.from(new Set(orderedIds)).slice(0, count || candidates.length);
    if (cardIds.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No creature cards in graveyard for that-many return: ${step.raw}`],
      });
    }
    const bfController = String(step.battlefieldController?.kind === 'you' ? controllerId : controllerId);
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        controllerId,
        cardId,
        { cardType: 'creature' },
        'battlefield',
        bfController,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
        ctx.sourceName,
        battlefieldEntryOverrides
      );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      const bfId = String((result as any).movedPermanentId || '').trim();
      if (bfId) movedBattlefieldIds.push(bfId);
    }
    return buildAppliedResult({
      state: workingState,
      log:
        combinedLog.length > 0
          ? combinedLog
          : [`Returned ${cardIds.length} creature card(s) from graveyard: ${step.raw}`],
      lastMovedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedEachCreatureExcludingListedTypes && step.to === 'hand') {
    const excludedTypes = parsedEachCreatureExcludingListedTypes.excludedCreatureTypes;
    const targetIds = ((nextState.battlefield || []) as any[])
      .filter(
        perm =>
          hasExecutorClass(perm as any, 'creature') &&
          !permanentHasAnyListedCreatureType(perm, excludedTypes)
      )
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    if (targetIds.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No creatures excluding listed types: ${step.raw}`],
      });
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds);
    return finalizeAppliedResult(result);
  }

  if (parsedEachCreatureThatDealtDamageThisTurn && step.to === 'hand') {
    const targetIds = ((nextState.battlefield || []) as any[])
      .filter(
        perm => hasExecutorClass(perm as any, 'creature') && permanentDealtDamageThisTurn(perm)
      )
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    if (targetIds.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No creatures dealt damage this turn: ${step.raw}`],
      });
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds);
    return finalizeAppliedResult(result);
  }

  if (parsedEachAttackingCreature && step.to === 'hand') {
    const attackingIds = ((nextState.battlefield || []) as any[])
      .filter(
        (perm: any) =>
          perm?.attacking === true || perm?.isAttacking === true || (perm as any)?.attackedThisTurn === true
      )
      .map((perm: any) => String(perm?.id || '').trim())
      .filter(Boolean);
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, attackingIds);
    return finalizeAppliedResult(result);
  }

  if (parsedEachAttackingCreature && step.to === 'library') {
    const attackingIds = ((nextState.battlefield || []) as any[])
      .filter(
        (perm: any) =>
          perm?.attacking === true || perm?.isAttacking === true || (perm as any)?.attackedThisTurn === true
      )
      .map((perm: any) => String(perm?.id || '').trim())
      .filter(Boolean);
    const placement = getLibraryPlacement(step) === 'top' ? 'top' : 'bottom';
    const result = moveBattlefieldPermanentsByIdToOwnersLibraries(nextState, attackingIds, placement);
    return finalizeAppliedResult({
      applied: true,
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Moved each attacking creature to library: ${step.raw}`],
    });
  }

  if (parsedThisCardAndTargetFromGy && step.to === 'battlefield') {
    const targetCriteria = parsedThisCardAndTargetFromGy;
    const sourceZone =
      resolveSourceCardZoneLocation(nextState, { kind: 'raw', text: 'this card' }, ctx, step.raw) ||
      resolveSourceCardZoneLocation(nextState, { kind: 'raw', text: 'this permanent' }, ctx, step.raw);
    const targetObjectId =
      resolveUniqueChosenGraveyardTargetId(
        nextState,
        controllerId,
        targetCriteria,
        ctx,
        runtime,
        ctx.sourceName,
        sourcePermanentPower
      ) ||
      resolveBoundGraveyardTargetObjectId(
        nextState,
        boundTargetObjectId,
        targetCriteria,
        ctx.sourceName,
        sourcePermanentPower
      );
    if (!sourceZone || sourceZone.zone !== 'graveyard' || !targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const entersTapped = step.entersTapped === true;
    for (const cardId of [sourceZone.cardId, targetObjectId]) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        controllerId,
        cardId,
        cardId === targetObjectId ? targetCriteria : { cardType: 'any' },
        'battlefield',
        controllerId,
        entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
        ctx.sourceName,
        battlefieldEntryOverrides,
        sourcePermanentPower
      );
      if (result.kind !== 'applied') {
        return {
          applied: false,
          message: `Skipped move zone (target card unavailable): ${step.raw}`,
          reason: 'impossible_action',
        };
      }
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return finalizeAppliedResult({
      applied: true,
      state: workingState,
      log:
        combinedLog.length > 0
          ? combinedLog
          : [`Returned this card and target card from graveyard to battlefield: ${step.raw}`],
    });
  }

  if (parsedThisCardAndNamedFromGy && step.to === 'exile') {
    const sourceNameAliases = new Set(buildNameReferenceAliases(ctx.sourceName));
    const preferredIds = getChosenObjectIds(ctx);
    const sourceZone =
      resolveSourceCardZoneLocation(nextState, { kind: 'raw', text: 'this card' }, ctx, step.raw) ||
      resolveSourceCardZoneLocation(nextState, { kind: 'raw', text: 'this permanent' }, ctx, step.raw);
    const cardIdsToExile: string[] = [];
    if (sourceZone?.zone === 'graveyard') {
      cardIdsToExile.push(sourceZone.cardId);
    } else {
      const sourceId = String(ctx.sourceId || '').trim();
      if (sourceId) cardIdsToExile.push(sourceId);
    }
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    const namedMatches = graveyard.filter((card: any) => {
      const cardId = String(card?.id || '').trim();
      if (!cardId || cardIdsToExile.includes(cardId)) return false;
      const cardName = normalizeReferenceText(card?.name);
      return sourceNameAliases.has(cardName);
    });
    const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
    const prioritized = [
      ...namedMatches.filter((card: any) => preferred.has(String(card?.id || '').trim())),
      ...namedMatches.filter((card: any) => !preferred.has(String(card?.id || '').trim())),
    ];
    for (const card of prioritized) {
      if (cardIdsToExile.length >= parsedThisCardAndNamedFromGy.namedCount + 1) break;
      const cardId = String((card as any)?.id || '').trim();
      if (cardId) cardIdsToExile.push(cardId);
    }
    if (cardIdsToExile.length === 0) {
      if (step.optional) return buildNoOpOptionalSingleTargetResult(nextState, step);
      return buildAppliedResult({ state: nextState, log: [`No cards to exile for named graveyard cost: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedCards: any[] = [];
    for (const cardId of cardIdsToExile) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location || location.zone !== 'graveyard') continue;
      const result = moveTargetedCardFromGraveyard(workingState, location.playerId, cardId, { cardType: 'any' }, 'exile');
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      const playerAfter = workingState.players.find(p => p.id === location.playerId) as any;
      const exiled = Array.isArray(playerAfter?.exile) ? playerAfter.exile : [];
      const moved = exiled[exiled.length - 1];
      if (moved) movedCards.push(moved);
    }
    const annotated = annotateExiledCardsWithSource({ state: workingState, movedCards, ctx });
    return buildAppliedResult({
      state: annotated.state,
      log: combinedLog.length > 0 ? combinedLog : [`Exiled this card and named cards from graveyard: ${step.raw}`],
      movedCards: annotated.movedCards,
    });
  }


  return undefined;
}
