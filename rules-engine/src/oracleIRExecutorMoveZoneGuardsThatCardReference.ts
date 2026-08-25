// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the applyMoveZoneStep selector guards starting at if (
// Public entry symbol: tryApplyMoveZoneGuardsFromThatCardReference.

import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import { moveBattlefieldPermanentsByIdToOwnersLibraries, moveBattlefieldPermanentsByIdToOwnersHands } from './oracleIRExecutorBattlefieldOps';
import {
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
  moveTargetedCardFromExile,
  resolveFirstMatchingCardIdFromPlayerGraveyard,
  cardHasAdventureCharacteristics,
  resolveAmongMilledMatchingCardIds,
  cardMatchesMoveZoneSingleTargetCriteria,
  resolveTypedCardIdFromPlayerZone,
  exileRandomCardFromHand,
  cardMatchesType,
} from './oracleIRExecutorZoneOps';
import type { BoundCardZoneLocation } from './oracleIRExecutorMoveZoneStepTypes';
import {
  findBoundCardZoneLocation,
  getChosenObjectIds,
  getTargetPlayerId,
  resolveSourceCardZoneLocation,
} from './oracleIRExecutorMoveZoneReferenceResolvers';
import {
  getDiedCreatureManaValueFromCtx,
  getLibraryPlacement,
  moveContextualCardToDestination,
  resolveAmongThemCriteriaWithX,
  resolveContextualCardIdsInZones,
  resolveMoveZoneSingleTargetCriteriaWithX,
} from './oracleIRExecutorMoveZoneContextualCardResolvers';
import { buildAppliedResult } from './oracleIRExecutorMoveZoneStepResultBuilders';

export function tryApplyMoveZoneGuardsFromThatCardReference(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {
  const { state, step, ctx, runtime, nextState, log, controllerId, effectiveWithCounters, battlefieldEntryOverrides, finalizeAppliedResult, attachmentResolution } = args;
  const {
    parsedCreatureYouControl,
    parsedLesserMvThanDiedFromGy,
    parsedRandomCardFromTargetPlayerHand,
  } = args.zoneQueries;
  const {
    parsedReturnThisCardAndUpToOneOther,
    parsedRevealedThisWayRest,
    parsedThatCardReference,
    parsedTypedCardFromHandOrGraveyard,
    parsedAdventureCardThatPlayerOwnsFromExile,
    parsedMvLessThanReferenceFromHand,
    parsedTypedCardFromAmongMilledCards,
    parsedAnyNumberAurasFromYourGy,
    parsedNamedCardReference,
  } = args.referenceQueries;

  if (
    (parsedThatCardReference || /\bthat card\b/i.test(String((step.what as any)?.text || ''))) &&
    (step.to === 'hand' || step.to === 'battlefield') &&
    /\bonto the battlefield or into your hand\b/i.test(String(step.raw || ''))
  ) {
    const preferredIds = getChosenObjectIds(ctx);
    const cardId =
      preferredIds.find(id => Boolean(findBoundCardZoneLocation(nextState, id))) ||
      String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim();
    const location = cardId ? findBoundCardZoneLocation(nextState, cardId) : null;
    if (!location) {
      return {
        applied: false,
        message: `Skipped move zone (that card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const destination = step.to === 'battlefield' ? 'battlefield' : 'hand';
    const result =
      location.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(
            nextState,
            location.playerId,
            cardId,
            { cardType: 'any' },
            destination,
            destination === 'battlefield' ? controllerId : undefined,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            undefined,
            undefined,
            battlefieldEntryOverrides
          )
        : location.zone === 'hand'
          ? destination === 'hand'
            ? { kind: 'applied' as const, state: nextState, log: [`Card already in hand: ${step.raw}`] }
            : moveTargetedCardFromHand(
                nextState,
                location.playerId,
                cardId,
                'any',
                'battlefield',
                controllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                battlefieldEntryOverrides
              )
          : moveTargetedCardFromExile(
              nextState,
              location.playerId,
              cardId,
              'any',
              destination,
              destination === 'battlefield' ? controllerId : undefined,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              undefined,
              battlefieldEntryOverrides
            );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (that card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedAdventureCardThatPlayerOwnsFromExile && step.to === 'graveyard') {
    const targetPlayerId = getTargetPlayerId(ctx) || controllerId;
    const preferredIds = getChosenObjectIds(ctx);
    const player = nextState.players.find(p => p.id === targetPlayerId) as any;
    const exile = Array.isArray(player?.exile) ? player.exile : [];
    const matches = exile.filter(
      (card: any) =>
        cardHasAdventureCharacteristics(card) &&
        (preferredIds.length === 0 || preferredIds.includes(String(card?.id || '').trim()))
    );
    const cardId =
      (preferredIds.find(id => matches.some((card: any) => String(card?.id || '').trim() === id)) &&
        preferredIds.find(id => matches.some((card: any) => String(card?.id || '').trim() === id))) ||
      (matches.length === 1 ? String(matches[0]?.id || '').trim() : '');
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No adventure card in exile to move: ${step.raw}`] });
    }
    const result = moveTargetedCardFromExile(nextState, targetPlayerId, cardId, 'any', 'graveyard');
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (adventure card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedTypedCardFromHandOrGraveyard && (step.to === 'battlefield' || step.to === 'exile')) {
    const criteria = resolveMoveZoneSingleTargetCriteriaWithX(
      parsedTypedCardFromHandOrGraveyard,
      ctx,
      nextState,
      controllerId
    );
    const preferredIds = getChosenObjectIds(ctx);
    const zoneOwnerId =
      parsedTypedCardFromHandOrGraveyard.fromHandOrGraveyardOwner === 'target_player'
        ? getTargetPlayerId(ctx) || controllerId
        : controllerId;
    let cardId = '';
    let location: BoundCardZoneLocation | null = null;
    for (const zone of ['hand', 'graveyard'] as const) {
      const player = nextState.players.find(p => p.id === zoneOwnerId) as any;
      const cards = Array.isArray(player?.[zone]) ? player[zone] : [];
      const matches = cards.filter(
        (card: any) =>
          cardMatchesMoveZoneSingleTargetCriteria(card, criteria) &&
          (preferredIds.length === 0 || preferredIds.includes(String(card?.id || '').trim()))
      );
      if (matches.length === 1) {
        cardId = String(matches[0]?.id || '').trim();
        location = { playerId: zoneOwnerId, zone };
        break;
      }
      if (matches.length > 1 && preferredIds.length > 0) {
        const preferred = matches.find((card: any) =>
          preferredIds.includes(String(card?.id || '').trim())
        );
        if (preferred) {
          cardId = String(preferred?.id || '').trim();
          location = { playerId: zoneOwnerId, zone };
          break;
        }
      }
    }
    if (!cardId || !location) {
      return {
        applied: false,
        message: `Skipped move zone (hand or graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const destination = step.to === 'exile' ? 'exile' : 'battlefield';
    const result =
      location.zone === 'hand'
        ? moveTargetedCardFromHand(
            nextState,
            zoneOwnerId,
            cardId,
            criteria.cardType,
            destination,
            destination === 'battlefield' ? controllerId : undefined,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            undefined,
            battlefieldEntryOverrides
          )
        : moveTargetedCardFromGraveyard(
            nextState,
            zoneOwnerId,
            cardId,
            criteria,
            destination,
            destination === 'battlefield' ? controllerId : undefined,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            undefined,
            undefined,
            battlefieldEntryOverrides
          );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (hand or graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedMvLessThanReferenceFromHand && step.to === 'battlefield') {
    const targetId = String(ctx.targetCreatureId || ctx.targetPermanentId || 'bf-creature-1').trim();
    const targetPerm = (nextState.battlefield || []).find((perm: any) => String(perm?.id || '').trim() === targetId) as any;
    const referenceMv = getCardManaValue(targetPerm?.card || targetPerm);
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    const preferredIds = getChosenObjectIds(ctx);
    const matches = hand.filter((card: any) => {
      const cardId = String(card?.id || '').trim();
      if (!cardId || !cardMatchesType(card, parsedMvLessThanReferenceFromHand.cardType)) return false;
      if (preferredIds.length > 0 && !preferredIds.includes(cardId)) return false;
      const mv = getCardManaValue(card);
      return mv !== null && referenceMv !== null && mv < referenceMv;
    });
    const card = matches.length === 1 ? matches[0] : preferredIds.length > 0 ? matches.find((c: any) => preferredIds.includes(String(c?.id || '').trim())) : matches[0];
    const cardId = String((card as any)?.id || '').trim();
    if (!cardId) {
      return {
        applied: false,
        message: `Skipped move zone (reference-mv hand card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const result = moveTargetedCardFromHand(
      nextState,
      controllerId,
      cardId,
      parsedMvLessThanReferenceFromHand.cardType,
      'battlefield',
      controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      undefined,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (reference-mv hand card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedRevealedThisWayRest && step.to === 'library' && getLibraryPlacement(step) === 'bottom') {
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, ['hand', 'exile']);
    if (candidateIds.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No revealed-this-way rest cards: ${step.raw}`],
      });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of candidateIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location || location.zone === 'library') continue;
      const result = moveContextualCardToDestination(
        workingState,
        location,
        cardId,
        'library_bottom',
        { controllerId, cardType: 'any' }
      );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved revealed-this-way rest to library bottom: ${step.raw}`],
    });
  }

  if (parsedReturnThisCardAndUpToOneOther && step.to === 'battlefield') {
    const sourceZone = resolveSourceCardZoneLocation(nextState, { kind: 'raw', text: 'this card' }, ctx, step.raw);
    const preferredIds = getChosenObjectIds(ctx).filter(id => id !== sourceZone?.cardId);
    const otherId = resolveTypedCardIdFromPlayerZone(
      nextState,
      controllerId,
      'graveyard',
      parsedReturnThisCardAndUpToOneOther.otherCardType,
      preferredIds
    );
    const cardIds = [sourceZone?.cardId, otherId].filter(Boolean) as string[];
    if (cardIds.length === 0) {
      return {
        applied: false,
        message: `Skipped move zone (compound graveyard return unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of cardIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location || location.zone !== 'graveyard') continue;
      const result = moveTargetedCardFromGraveyard(
        workingState,
        location.playerId,
        cardId,
        { cardType: 'any' },
        'battlefield',
        controllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        undefined,
        undefined,
        battlefieldEntryOverrides
      );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    if (combinedLog.length === 0) {
      return {
        applied: false,
        message: `Skipped move zone (compound graveyard return unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog,
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedNamedCardReference && step.to === 'hand') {
    const wantedName = parsedNamedCardReference.toLowerCase();
    const battlefield = [...((nextState.battlefield || []) as any[])];
    const match = battlefield.find(perm => {
      const name = String((perm as any)?.name || (perm as any)?.card?.name || '').trim().toLowerCase();
      return name.includes(wantedName);
    });
    if (!match) {
      return {
        applied: false,
        message: `Skipped move zone (named card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, [String((match as any)?.id || '').trim()]);
    return finalizeAppliedResult(result);
  }

  if (parsedAnyNumberAurasFromYourGy && step.to === 'battlefield') {
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    const preferredIds = getChosenObjectIds(ctx);
    const auraIds = graveyard
      .filter((card: any) => String((card as any)?.type_line || '').toLowerCase().includes('aura'))
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean);
    const chosen =
      preferredIds.length > 0 ? auraIds.filter(id => preferredIds.includes(id)) : auraIds;
    const attachTargetId =
      preferredIds.find(id => (nextState.battlefield || []).some((perm: any) => String(perm?.id || '').trim() === id)) ||
      String(ctx.targetCreatureId || ctx.targetPermanentId || 'bf-creature-1').trim();
    if (chosen.length === 0) {
      return {
        applied: false,
        message: `Skipped move zone (aura graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of chosen) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        controllerId,
        cardId,
        { cardType: 'aura' },
        'battlefield',
        controllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        attachTargetId
      );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned aura cards attached: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (
    parsedTypedCardFromAmongMilledCards &&
    'criteria' in parsedTypedCardFromAmongMilledCards &&
    step.to === 'hand'
  ) {
    const cardId = resolveFirstMatchingCardIdFromPlayerGraveyard(
      nextState,
      controllerId,
      parsedTypedCardFromAmongMilledCards.criteria,
      getChosenObjectIds(ctx)
    );
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No matching milled card: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(nextState, controllerId, cardId, { cardType: 'any' }, 'hand');
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (milled card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (
    parsedTypedCardFromAmongMilledCards &&
    'criteria' in parsedTypedCardFromAmongMilledCards &&
    step.to === 'library' &&
    getLibraryPlacement(step) === 'top'
  ) {
    const cardId = resolveFirstMatchingCardIdFromPlayerGraveyard(
      nextState,
      controllerId,
      parsedTypedCardFromAmongMilledCards.criteria,
      getChosenObjectIds(ctx)
    );
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No matching milled card: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      cardId,
      { cardType: 'any' },
      'library_top'
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (milled card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (
    parsedTypedCardFromAmongMilledCards &&
    !('criteria' in parsedTypedCardFromAmongMilledCards) &&
    step.to === 'hand'
  ) {
    const preferredIds = getChosenObjectIds(ctx);
    const effectiveCriteria = resolveAmongThemCriteriaWithX(parsedTypedCardFromAmongMilledCards, ctx);
    const matchingIds = resolveAmongMilledMatchingCardIds(nextState, controllerId, effectiveCriteria, preferredIds);
    const cardId = matchingIds[0] || '';
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No matching milled card: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(nextState, controllerId, cardId, effectiveCriteria, 'hand');
    return result.kind === 'impossible'
      ? buildAppliedResult({ state: nextState, log: [`Milled card unavailable: ${step.raw}`] })
      : finalizeAppliedResult(result);
  }

  if (
    parsedTypedCardFromAmongMilledCards &&
    !('criteria' in parsedTypedCardFromAmongMilledCards) &&
    step.to === 'library' &&
    getLibraryPlacement(step) === 'top'
  ) {
    const preferredIds = getChosenObjectIds(ctx);
    const effectiveCriteria = resolveAmongThemCriteriaWithX(parsedTypedCardFromAmongMilledCards, ctx);
    const matchingIds = resolveAmongMilledMatchingCardIds(nextState, controllerId, effectiveCriteria, preferredIds);
    const cardId = matchingIds[0] || '';
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No matching milled card: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      cardId,
      effectiveCriteria,
      'library_top'
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (milled card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (
    parsedTypedCardFromAmongMilledCards &&
    'criteria' in parsedTypedCardFromAmongMilledCards &&
    step.to === 'battlefield'
  ) {
    const cardId = resolveFirstMatchingCardIdFromPlayerGraveyard(
      nextState,
      controllerId,
      parsedTypedCardFromAmongMilledCards.criteria,
      getChosenObjectIds(ctx)
    );
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No matching milled card: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      cardId,
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
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (milled card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (
    parsedTypedCardFromAmongMilledCards &&
    !('criteria' in parsedTypedCardFromAmongMilledCards) &&
    step.to === 'battlefield'
  ) {
    const preferredIds = getChosenObjectIds(ctx);
    const effectiveCriteria = resolveAmongThemCriteriaWithX(parsedTypedCardFromAmongMilledCards, ctx);
    const matchingIds = resolveAmongMilledMatchingCardIds(nextState, controllerId, effectiveCriteria, preferredIds);
    if (matchingIds.length === 0) {
      return {
        applied: false,
        message: `Skipped move zone (milled card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of matchingIds) {
      const result = moveTargetedCardFromGraveyard(
        workingState,
        controllerId,
        cardId,
        effectiveCriteria,
        'battlefield',
        controllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        undefined,
        undefined,
        battlefieldEntryOverrides
      );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved milled cards: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedCreatureYouControl && step.to === 'library' && getLibraryPlacement(step) === 'top') {
    const controlledCreatures = ((nextState.battlefield || []) as any[]).filter(
      perm =>
        perm?.controller === controllerId &&
        hasExecutorClass(perm as any, 'creature') &&
        String((perm as any)?.id || '').trim() !== String(ctx.sourceId || '').trim()
    );
    const preferred = getChosenObjectIds(ctx);
    let targetId = controlledCreatures
      .map(perm => String((perm as any)?.id || '').trim())
      .find(id => preferred.includes(id));
    if (!targetId && controlledCreatures.length === 1) {
      targetId = String((controlledCreatures[0] as any)?.id || '').trim();
    }
    if (!targetId && controlledCreatures.length > 1) {
      return {
        applied: false,
        message: `Skipped move zone (needs player creature choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (!targetId) {
      return buildAppliedResult({ state: nextState, log: [`No creature to move to library top: ${step.raw}`] });
    }
    const result = moveBattlefieldPermanentsByIdToOwnersLibraries(nextState, [targetId], 'top');
    return finalizeAppliedResult(result);
  }

  if (parsedLesserMvThanDiedFromGy && step.to === 'hand') {
    const diedManaValue = getDiedCreatureManaValueFromCtx(ctx, runtime);
    if (diedManaValue === null) {
      return buildAppliedResult({ state: nextState, log: [`No died creature reference for lesser MV return: ${step.raw}`] });
    }
    const controllerPlayer = nextState.players.find(p => p.id === controllerId) as any;
    const graveyard = Array.isArray(controllerPlayer?.graveyard) ? controllerPlayer.graveyard : [];
    const preferred = getChosenObjectIds(ctx);
    let cardId = '';
    for (const card of graveyard) {
      if (!hasExecutorClass(card as any, 'creature')) continue;
      const manaValue = getCardManaValue(card);
      if (manaValue === null || manaValue >= diedManaValue) continue;
      const candidateId = String((card as any)?.id || '').trim();
      if (!candidateId) continue;
      if (preferred.includes(candidateId)) {
        cardId = candidateId;
        break;
      }
      if (!cardId) cardId = candidateId;
    }
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No lesser-MV creature in graveyard: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      cardId,
      parsedLesserMvThanDiedFromGy,
      'hand'
    );
    return result.kind === 'impossible'
      ? buildAppliedResult({ state: nextState, log: [`Lesser-MV graveyard return unavailable: ${step.raw}`] })
      : finalizeAppliedResult(result);
  }

  if (parsedRandomCardFromTargetPlayerHand && step.to === 'exile') {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const result = exileRandomCardFromHand(nextState, targetPlayerId, getChosenObjectIds(ctx));
    return buildAppliedResult({
      state: result.state,
      log: result.log.length > 0 ? result.log : [`Exiled random hand card: ${step.raw}`],
      movedCards: result.movedCards,
    });
  }


  return undefined;
}
