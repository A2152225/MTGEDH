// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the applyMoveZoneStep selector guards starting at if (
// Public entry symbol: tryApplyMoveZoneGuardsFromTypedCardsRevealedThisWay.

import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';
import {
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
  moveTargetedCardFromExile,
  selectContextualCardsWithTotalManaValueLte,
  stepHasAmongThemRestToLibrary,
  cardMatchesMoveZoneSingleTargetCriteria,
  resolveAmongThemMatchingCardIds,
} from './oracleIRExecutorZoneOps';
import { auraEnterAttachmentId, readBoundZoneCard, resolveAuraEnterAttachment } from './oracleIRExecutorAuraEnterAttachment';
import { findBoundCardZoneLocation, getChosenObjectIds, ownerIdFromMovedCardSnapshots } from './oracleIRExecutorMoveZoneReferenceResolvers';
import {
  preferredAuraAttachIdFromContext,
  trySkipEnchantmentWaveAuraAttach,
} from './oracleIRExecutorWarpWorldInteractive';
import {
  getLibraryPlacement,
  moveContextualCardToDestination,
  moveContextualRestAfterPrimaryMove,
  moveContextualRestToLibraryBottom,
  resolveAmongThemCriteriaWithX,
  resolveContextualCardIdsInZones,
  resolveRevealThisWayRestDestination,
} from './oracleIRExecutorMoveZoneContextualCardResolvers';
import { buildAppliedResult } from './oracleIRExecutorMoveZoneStepResultBuilders';
import { readPlayerZoneCards, writePlayerZoneCards } from './oracleIRExecutorPlayerUtils';
import { resolveRevealedThisWayCardPile } from './oracleIRLedgerCardAccess';
import {
  findBestZoneCardIndex,
  flattenZoneCardForBattlefield,
  mergeRevealedCardIdentity,
  takeRevealedCardSnapshot,
} from './oracleIRExecutorZoneCardIdentity';

export function tryApplyMoveZoneGuardsFromTypedCardsRevealedThisWay(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {
  const { state, step, ctx, runtime, nextState, log, controllerId, effectiveWithCounters, battlefieldEntryOverrides } = args;
  const {
    parsedRestOfExiledCards,
    parsedTypedCardFromAmongThem,
    parsedTypedCardsRevealedThisWay,
    parsedRevealedThisWayRestToLibrary,
  } = args.referenceQueries;

  if (
    (parsedTypedCardsRevealedThisWay || parsedRevealedThisWayRestToLibrary) &&
    (step.to === 'hand' || step.to === 'graveyard' || step.to === 'battlefield')
  ) {
    const preferredIds = getChosenObjectIds(ctx);
    const effectiveCriteria = resolveAmongThemCriteriaWithX(parsedTypedCardsRevealedThisWay || { cardType: 'any' }, ctx);
    const revealedCards = resolveRevealedThisWayCardPile(ctx, step);
    const candidateRefs: Array<{ cardId: string; ownerId?: string }> =
      revealedCards.length > 0
        ? revealedCards
            .map((card: any) => ({
              cardId: String(card?.id || '').trim(),
              ownerId: String(card?.owner || card?.ownerId || '').trim() || undefined,
            }))
            .filter((ref) => ref.cardId)
        : resolveContextualCardIdsInZones(nextState, ctx, runtime, ['library', 'exile', 'hand', 'graveyard']).map(
            (cardId) => ({
              cardId,
              ownerId: ownerIdFromMovedCardSnapshots(revealedCards, cardId),
            }),
          );
    const matchingRefs = candidateRefs.filter(({ cardId, ownerId }) => {
      const location = findBoundCardZoneLocation(nextState, cardId, ownerId);
      if (!location) return false;
      const player = nextState.players.find(p => p.id === location.playerId) as any;
      const zoneCards =
        location.zone === 'library'
          ? readPlayerZoneCards(nextState, location.playerId, player, 'library')
          : Array.isArray(player?.[location.zone]) ? player[location.zone] : [];
      const card = location.zone === 'library'
        ? zoneCards[findBestZoneCardIndex(zoneCards, cardId)]
        : zoneCards.find((entry: any) => String(entry?.id || '').trim() === cardId);
      return card && cardMatchesMoveZoneSingleTargetCriteria(
        flattenZoneCardForBattlefield(card) || card,
        effectiveCriteria,
      );
    });
    const matchingIds = matchingRefs.map((ref) => ref.cardId);
    if (matchingRefs.length === 0 && !parsedRevealedThisWayRestToLibrary) {
      return buildAppliedResult({ state: nextState, log: [`No matching revealed-this-way cards: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedCardIds: string[] = [];
    const movedBattlefieldIds: string[] = [];
    const hostSnapshot =
      step.to === 'battlefield' ? [...(((workingState.battlefield || []) as any[]) || [])] : [];
    const remainingRevealed = [...revealedCards];
    if (step.to === 'battlefield') {
      const auraSkip = trySkipEnchantmentWaveAuraAttach({
        state: workingState,
        ctx,
        matchingIds,
        hostSnapshot,
        ownerControlsMovedCards: step.battlefieldController?.kind === 'owner_of_moved_cards',
        stepRaw: String(step.raw || ''),
      });
      if (auraSkip) return auraSkip;
    }
    for (const { cardId, ownerId } of matchingRefs) {
      const location = findBoundCardZoneLocation(workingState, cardId, ownerId);
      if (!location) continue;
      const battlefieldControllerId =
        step.battlefieldController?.kind === 'owner_of_moved_cards' ? location.playerId : controllerId;
      if (location.zone === 'library' && step.to === 'battlefield') {
        const player = workingState.players.find(p => p.id === location.playerId) as any;
        const pile = readPlayerZoneCards(workingState, location.playerId, player, 'library');
        const idx = findBestZoneCardIndex(pile, cardId);
        if (idx >= 0) {
          pile[idx] = mergeRevealedCardIdentity(
            pile[idx],
            takeRevealedCardSnapshot(remainingRevealed, cardId, ownerId),
          );
          writePlayerZoneCards(workingState, location.playerId, player, 'library', pile);
        }
      }
      let attachedToId: string | undefined;
      if (step.to === 'battlefield') {
        const card = readBoundZoneCard(workingState, location.playerId, location.zone, cardId);
        const attachment = resolveAuraEnterAttachment(workingState, card, battlefieldControllerId, {
          hostPool: hostSnapshot,
          preferredAttachId: preferredAuraAttachIdFromContext(ctx, cardId),
        });
        if (attachment.kind === 'illegal') continue;
        attachedToId = auraEnterAttachmentId(attachment);
      }
      const result =
        location.zone === 'library'
          ? moveContextualCardToDestination(workingState, location, cardId, step.to, {
              controllerId: battlefieldControllerId,
              ctx,
              cardType: effectiveCriteria.cardType,
              entersTapped: step.entersTapped,
              entersFaceDown: step.entersFaceDown,
              withCounters: effectiveWithCounters,
              battlefieldEntryOverrides,
              attachedToBattlefieldPermanentId: attachedToId,
            })
          : location.zone === 'graveyard'
            ? moveTargetedCardFromGraveyard(
                workingState,
                location.playerId,
                cardId,
                effectiveCriteria,
                step.to === 'battlefield' ? 'battlefield' : 'hand',
                step.to === 'battlefield' ? battlefieldControllerId : undefined,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                attachedToId,
                undefined,
                battlefieldEntryOverrides
              )
            : location.zone === 'hand' && step.to === 'hand'
              ? { kind: 'applied' as const, state: workingState, log: [] as string[] }
            : location.zone === 'hand'
              ? moveTargetedCardFromHand(
                  workingState,
                  location.playerId,
                  cardId,
                  effectiveCriteria.cardType,
                  step.to === 'battlefield' ? 'battlefield' : 'graveyard',
                  step.to === 'battlefield' ? battlefieldControllerId : undefined,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters,
                  attachedToId,
                  battlefieldEntryOverrides
                )
              : moveTargetedCardFromExile(
                  workingState,
                  location.playerId,
                  cardId,
                  effectiveCriteria.cardType,
                  step.to,
                  step.to === 'battlefield' ? battlefieldControllerId : undefined,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters,
                  attachedToId,
                  battlefieldEntryOverrides
                );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedCardIds.push(cardId);
      movedBattlefieldIds.push(...((result as any).movedPermanentIds || []));
    }
    if (parsedRevealedThisWayRestToLibrary) {
      const restResult = moveContextualRestAfterPrimaryMove(
        workingState,
        controllerId,
        ctx,
        runtime,
        movedCardIds,
        resolveRevealThisWayRestDestination(step)
      );
      workingState = restResult.state;
      combinedLog.push(...restResult.log);
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved revealed-this-way cards: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds.length > 0 ? movedBattlefieldIds : undefined,
    });
  }

  if (parsedTypedCardFromAmongThem) {
    const preferredIds = getChosenObjectIds(ctx);
    const effectiveCriteria = resolveAmongThemCriteriaWithX(parsedTypedCardFromAmongThem, ctx);
    if (parsedTypedCardFromAmongThem.handGySplit && step.to === 'hand') {
      const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, [
        'library',
        'exile',
        'hand',
        'graveyard',
      ]);
      const matchingIds = candidateIds.filter(cardId => {
        const location = findBoundCardZoneLocation(nextState, cardId);
        if (!location) return false;
        const player = nextState.players.find(p => p.id === location.playerId) as any;
        const zoneCards = Array.isArray(player?.[location.zone]) ? player[location.zone] : [];
        const card = zoneCards.find((entry: any) => String(entry?.id || '').trim() === cardId);
        return card && cardMatchesMoveZoneSingleTargetCriteria(card, effectiveCriteria);
      });
      const preferred = preferredIds.filter(id => matchingIds.includes(id));
      const xHandCount =
        parsedTypedCardFromAmongThem.maxCount === -1
          ? Math.max(1, Number(ctx.xValue ?? ctx.referenceAmount ?? 3))
          : undefined;
      const handIds =
        preferred.length > 0
          ? preferred.slice(0, xHandCount ?? preferred.length)
          : parsedTypedCardFromAmongThem.anyNumber
            ? matchingIds.slice(0, xHandCount ?? matchingIds.length)
            : matchingIds.slice(
                0,
                xHandCount ?? Math.min(parsedTypedCardFromAmongThem.maxCount || 2, matchingIds.length)
              );
      const restIds = candidateIds.filter(id => !handIds.includes(id));
      let workingState = nextState;
      const combinedLog: string[] = [];
      for (const cardId of handIds) {
        const location = findBoundCardZoneLocation(workingState, cardId);
        if (!location || location.zone === 'hand') continue;
        const result =
          location.zone === 'library'
            ? moveContextualCardToDestination(workingState, location, cardId, 'hand', {
                controllerId,
                cardType: effectiveCriteria.cardType,
              })
            : location.zone === 'graveyard'
              ? moveTargetedCardFromGraveyard(workingState, location.playerId, cardId, effectiveCriteria, 'hand')
              : moveTargetedCardFromExile(workingState, location.playerId, cardId, effectiveCriteria.cardType, 'hand');
        if (result.kind !== 'applied') continue;
        workingState = result.state;
        combinedLog.push(...(result.log || []));
      }
      for (const cardId of restIds) {
        const location = findBoundCardZoneLocation(workingState, cardId);
        if (!location || location.zone === 'graveyard') continue;
        const result =
          location.zone === 'library'
            ? moveContextualCardToDestination(workingState, location, cardId, 'graveyard', {
                controllerId,
                cardType: 'any',
              })
            : location.zone === 'hand'
              ? moveTargetedCardFromHand(workingState, location.playerId, cardId, 'any', 'graveyard')
              : moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'graveyard');
        if (result.kind !== 'applied') continue;
        workingState = result.state;
        combinedLog.push(...(result.log || []));
      }
      return buildAppliedResult({
        state: workingState,
        log: combinedLog.length > 0 ? combinedLog : [`Split among-them cards to hand and graveyard: ${step.raw}`],
      });
    }
    if (parsedTypedCardFromAmongThem.bfHandSplit && step.to === 'hand') {
      const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, [
        'library',
        'exile',
        'hand',
        'graveyard',
      ]);
      const matchingPermanentIds = candidateIds.filter(cardId => {
        const location = findBoundCardZoneLocation(nextState, cardId);
        if (!location) return false;
        const player = nextState.players.find(p => p.id === location.playerId) as any;
        const zoneCards = Array.isArray(player?.[location.zone]) ? player[location.zone] : [];
        const card = zoneCards.find((entry: any) => String(entry?.id || '').trim() === cardId);
        return card && cardMatchesMoveZoneSingleTargetCriteria(card, effectiveCriteria);
      });
      const preferred = preferredIds.filter(id => matchingPermanentIds.includes(id));
      const bfIds =
        preferred.length > 0
          ? preferred
          : parsedTypedCardFromAmongThem.anyNumber
            ? matchingPermanentIds
            : matchingPermanentIds.slice(0, Math.min(2, matchingPermanentIds.length));
      const restIds = candidateIds.filter(id => !bfIds.includes(id));
      let workingState = nextState;
      const combinedLog: string[] = [];
      const movedBattlefieldIds: string[] = [];
      const entersTapped =
        step.entersTapped || parsedTypedCardFromAmongThem.entersTappedFromWhat === true;
      for (const cardId of bfIds) {
        const location = findBoundCardZoneLocation(workingState, cardId);
        if (!location) continue;
        const result =
          location.zone === 'library'
            ? moveContextualCardToDestination(workingState, location, cardId, 'battlefield', {
                controllerId,
                ctx,
                cardType: effectiveCriteria.cardType,
                entersTapped,
                entersFaceDown: step.entersFaceDown,
                withCounters: effectiveWithCounters,
                battlefieldEntryOverrides,
              })
            : location.zone === 'graveyard'
              ? moveTargetedCardFromGraveyard(
                  workingState,
                  location.playerId,
                  cardId,
                  effectiveCriteria,
                  'battlefield',
                  controllerId,
                  entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters,
                  undefined,
                  undefined,
                  battlefieldEntryOverrides
                )
              : location.zone === 'hand'
                ? moveTargetedCardFromHand(
                    workingState,
                    location.playerId,
                    cardId,
                    effectiveCriteria.cardType,
                    'battlefield',
                    controllerId,
                    entersTapped,
                    step.entersFaceDown,
                    effectiveWithCounters,
                    undefined,
                    battlefieldEntryOverrides
                  )
                : moveTargetedCardFromExile(
                    workingState,
                    location.playerId,
                    cardId,
                    effectiveCriteria.cardType,
                    'battlefield',
                    controllerId,
                    entersTapped,
                    step.entersFaceDown,
                    effectiveWithCounters,
                    undefined,
                    battlefieldEntryOverrides
                  );
        if (result.kind !== 'applied') continue;
        workingState = result.state;
        combinedLog.push(...(result.log || []));
        movedBattlefieldIds.push(...((result as any).movedPermanentIds || []));
      }
      for (const cardId of restIds) {
        const location = findBoundCardZoneLocation(workingState, cardId);
        if (!location || location.zone === 'hand') continue;
        const result =
          location.zone === 'library'
            ? moveContextualCardToDestination(workingState, location, cardId, 'hand', {
                controllerId,
                cardType: 'any',
              })
            : location.zone === 'graveyard'
              ? moveTargetedCardFromGraveyard(workingState, location.playerId, cardId, { cardType: 'any' }, 'hand')
              : moveTargetedCardFromExile(workingState, location.playerId, cardId, 'any', 'hand');
        if (result.kind !== 'applied') continue;
        workingState = result.state;
        combinedLog.push(...(result.log || []));
      }
      return buildAppliedResult({
        state: workingState,
        log: combinedLog.length > 0 ? combinedLog : [`Split among-them cards to battlefield and hand: ${step.raw}`],
        movedBattlefieldPermanentIds: movedBattlefieldIds,
      });
    }
    if (
      parsedTypedCardFromAmongThem.bfLibraryBottomSplit &&
      (step.to === 'library' || step.to === 'battlefield')
    ) {
      const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, [
        'library',
        'exile',
        'hand',
        'graveyard',
      ]);
      const matchingLandIds = candidateIds.filter(cardId => {
        const location = findBoundCardZoneLocation(nextState, cardId);
        if (!location) return false;
        const player = nextState.players.find(p => p.id === location.playerId) as any;
        const zoneCards = Array.isArray(player?.[location.zone]) ? player[location.zone] : [];
        const card = zoneCards.find((entry: any) => String(entry?.id || '').trim() === cardId);
        return card && cardMatchesMoveZoneSingleTargetCriteria(card, effectiveCriteria);
      });
      const preferred = preferredIds.filter(id => matchingLandIds.includes(id));
      const maxCount = parsedTypedCardFromAmongThem.anyNumber
        ? matchingLandIds.length
        : parsedTypedCardFromAmongThem.maxCount || 1;
      const bfIds =
        parsedTypedCardFromAmongThem.totalManaValueLte !== undefined
          ? selectContextualCardsWithTotalManaValueLte(
              Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : [],
              effectiveCriteria.cardType,
              parsedTypedCardFromAmongThem.totalManaValueLte,
              maxCount,
              preferredIds
            )
          : preferred.length > 0
            ? parsedTypedCardFromAmongThem.anyNumber
              ? preferred
              : preferred.slice(0, maxCount)
            : matchingLandIds.slice(0, Math.min(maxCount, matchingLandIds.length));
      const restIds = candidateIds.filter(id => !bfIds.includes(id));
      let workingState = nextState;
      const combinedLog: string[] = [];
      const movedBattlefieldIds: string[] = [];
      const entersTapped =
        step.entersTapped || parsedTypedCardFromAmongThem.entersTappedFromWhat === true;
      for (const cardId of bfIds) {
        const location = findBoundCardZoneLocation(workingState, cardId);
        if (!location) continue;
        const result =
          location.zone === 'library'
            ? moveContextualCardToDestination(workingState, location, cardId, 'battlefield', {
                controllerId,
                ctx,
                cardType: effectiveCriteria.cardType,
                entersTapped,
                entersFaceDown: step.entersFaceDown,
                withCounters: effectiveWithCounters,
                battlefieldEntryOverrides,
              })
            : location.zone === 'hand'
              ? moveTargetedCardFromHand(
                  workingState,
                  location.playerId,
                  cardId,
                  effectiveCriteria.cardType,
                  'battlefield',
                  controllerId,
                  entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters,
                  undefined,
                  battlefieldEntryOverrides
                )
              : location.zone === 'graveyard'
                ? moveTargetedCardFromGraveyard(
                    workingState,
                    location.playerId,
                    cardId,
                    effectiveCriteria,
                    'battlefield',
                    controllerId,
                    entersTapped,
                    step.entersFaceDown,
                    effectiveWithCounters,
                    undefined,
                    undefined,
                    battlefieldEntryOverrides
                  )
                : moveTargetedCardFromExile(
                    workingState,
                    location.playerId,
                    cardId,
                    effectiveCriteria.cardType,
                    'battlefield',
                    controllerId,
                    entersTapped,
                    step.entersFaceDown,
                    effectiveWithCounters,
                    undefined,
                    battlefieldEntryOverrides
                  );
        if (result.kind !== 'applied') continue;
        workingState = result.state;
        combinedLog.push(...(result.log || []));
        movedBattlefieldIds.push(...((result as any).movedPermanentIds || []));
      }
      const restResult = moveContextualRestToLibraryBottom(workingState, controllerId, ctx, runtime, bfIds);
      workingState = restResult.state;
      combinedLog.push(...restResult.log);
      return buildAppliedResult({
        state: workingState,
        log: combinedLog.length > 0 ? combinedLog : [`Split among-them lands to battlefield and library bottom: ${step.raw}`],
        movedBattlefieldPermanentIds: movedBattlefieldIds,
      });
    }
    const matchingIds = resolveAmongThemMatchingCardIds(
      nextState,
      controllerId,
      effectiveCriteria,
      preferredIds
    );
    if (matchingIds.length === 0) {
      return {
        applied: false,
        message: `Skipped move zone (typed among-them card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    const destination =
      step.to === 'library'
        ? getLibraryPlacement(step) === 'top'
          ? 'library_top'
          : 'library_bottom'
        : step.to;

    if (parsedTypedCardFromAmongThem.maxCount === -1 && step.to === 'battlefield') {
      const xCount = Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 3));
      const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, [
        'library',
        'exile',
        'hand',
        'graveyard',
      ]);
      const contextualMatchingIds = candidateIds.filter(cardId => {
        const location = findBoundCardZoneLocation(nextState, cardId);
        if (!location) return false;
        const player = nextState.players.find(p => p.id === location.playerId) as any;
        const zoneCards = Array.isArray(player?.[location.zone]) ? player[location.zone] : [];
        const card = zoneCards.find((entry: any) => String(entry?.id || '').trim() === cardId);
        return card && cardMatchesMoveZoneSingleTargetCriteria(card, effectiveCriteria);
      });
      const preferred = preferredIds.filter(id => contextualMatchingIds.includes(id));
      const targetIds = (preferred.length > 0 ? preferred : contextualMatchingIds).slice(0, xCount);
      let workingState = nextState;
      const combinedLog: string[] = [];
      const movedBattlefieldIds: string[] = [];
      const movedCardIds: string[] = [];
      for (const cardId of targetIds) {
        const location = findBoundCardZoneLocation(workingState, cardId);
        if (!location) continue;
        const result =
          location.zone === 'library'
            ? moveContextualCardToDestination(workingState, location, cardId, 'battlefield', {
                controllerId,
                ctx,
                cardType: effectiveCriteria.cardType,
                entersTapped: step.entersTapped,
                entersFaceDown: step.entersFaceDown,
                withCounters: effectiveWithCounters,
                battlefieldEntryOverrides,
              })
            : location.zone === 'graveyard'
              ? moveTargetedCardFromGraveyard(
                  workingState,
                  location.playerId,
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
                )
              : location.zone === 'hand'
                ? moveTargetedCardFromHand(
                    workingState,
                    location.playerId,
                    cardId,
                    effectiveCriteria.cardType,
                    'battlefield',
                    controllerId,
                    step.entersTapped,
                    step.entersFaceDown,
                    effectiveWithCounters,
                    undefined,
                    battlefieldEntryOverrides
                  )
                : moveTargetedCardFromExile(
                    workingState,
                    location.playerId,
                    cardId,
                    effectiveCriteria.cardType,
                    'battlefield',
                    controllerId,
                    step.entersTapped,
                    step.entersFaceDown,
                    effectiveWithCounters,
                    undefined,
                    battlefieldEntryOverrides
                  );
        if (result.kind !== 'applied') continue;
        workingState = result.state;
        combinedLog.push(...(result.log || []));
        movedCardIds.push(cardId);
        movedBattlefieldIds.push(...('movedPermanentIds' in result ? result.movedPermanentIds || [] : []));
      }
      if (stepHasAmongThemRestToLibrary(step)) {
        const restResult = moveContextualRestToLibraryBottom(workingState, controllerId, ctx, runtime, movedCardIds);
        workingState = restResult.state;
        combinedLog.push(...restResult.log);
      }
      return buildAppliedResult({
        state: workingState,
        log: combinedLog.length > 0 ? combinedLog : [`Moved up-to-X among-them cards: ${step.raw}`],
        movedBattlefieldPermanentIds: movedBattlefieldIds,
      });
    }

    if (parsedTypedCardFromAmongThem.anyNumber) {
      let workingState = nextState;
      const combinedLog: string[] = [];
      const movedBattlefieldIds: string[] = [];
      const movedCardIds: string[] = [];
      for (const cardId of matchingIds) {
        const location = findBoundCardZoneLocation(workingState, cardId);
        if (!location) continue;
        const result =
          location.zone === 'library'
            ? moveContextualCardToDestination(workingState, location, cardId, destination === 'hand' ? 'hand' : 'library_bottom', {
                controllerId,
                cardType: effectiveCriteria.cardType,
                entersTapped: step.entersTapped,
                entersFaceDown: step.entersFaceDown,
                withCounters: effectiveWithCounters,
                battlefieldEntryOverrides,
              })
            : location.zone === 'graveyard'
            ? moveTargetedCardFromGraveyard(
                workingState,
                location.playerId,
                cardId,
                { cardType: effectiveCriteria.cardType },
                destination as any,
                step.to === 'battlefield' ? controllerId : undefined,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                undefined,
                battlefieldEntryOverrides
              )
            : location.zone === 'hand'
              ? moveTargetedCardFromHand(
                  workingState,
                  location.playerId,
                  cardId,
                  effectiveCriteria.cardType,
                  destination as any,
                  step.to === 'battlefield' ? controllerId : undefined,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters,
                  undefined,
                  battlefieldEntryOverrides
                )
              : moveTargetedCardFromExile(
                  workingState,
                  location.playerId,
                  cardId,
                  effectiveCriteria.cardType,
                  destination as any,
                  step.to === 'battlefield' ? controllerId : undefined,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters,
                  undefined,
                  battlefieldEntryOverrides
                );
        if (result.kind !== 'applied') continue;
        workingState = result.state;
        combinedLog.push(...(result.log || []));
        movedCardIds.push(cardId);
        movedBattlefieldIds.push(...('movedPermanentIds' in result ? result.movedPermanentIds || [] : []));
      }
      if (stepHasAmongThemRestToLibrary(step)) {
        const restResult = moveContextualRestToLibraryBottom(workingState, controllerId, ctx, runtime, movedCardIds);
        workingState = restResult.state;
        combinedLog.push(...restResult.log);
      }
      return buildAppliedResult({
        state: workingState,
        log: combinedLog.length > 0 ? combinedLog : [`Moved among-them cards: ${step.raw}`],
        movedBattlefieldPermanentIds: movedBattlefieldIds,
      });
    }

    const cardId = matchingIds[0];
    const location = findBoundCardZoneLocation(nextState, cardId);
    if (!location) {
      return {
        applied: false,
        message: `Skipped move zone (typed among-them card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    const result =
      location.zone === 'library'
        ? moveContextualCardToDestination(nextState, location, cardId, destination === 'hand' ? 'hand' : 'library_bottom', {
            controllerId,
            cardType: parsedTypedCardFromAmongThem.cardType,
            entersTapped: step.entersTapped,
            entersFaceDown: step.entersFaceDown,
            withCounters: effectiveWithCounters,
            battlefieldEntryOverrides,
          })
        : location.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(
            nextState,
            location.playerId,
            cardId,
            effectiveCriteria,
            destination as any,
            step.to === 'battlefield' ? controllerId : undefined,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            undefined,
            undefined,
            battlefieldEntryOverrides
          )
        : location.zone === 'hand'
          ? moveTargetedCardFromHand(
              nextState,
              location.playerId,
              cardId,
              parsedTypedCardFromAmongThem.cardType,
              destination as any,
              step.to === 'battlefield' ? controllerId : undefined,
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
              parsedTypedCardFromAmongThem.cardType,
              destination as any,
              step.to === 'battlefield' ? controllerId : undefined,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              undefined,
              battlefieldEntryOverrides
            );
    if (result.kind !== 'applied') {
      return {
        applied: false,
        message: `Skipped move zone (typed among-them card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    let workingState = result.state;
    const combinedLog = [...(result.log || [])];
    if (stepHasAmongThemRestToLibrary(step)) {
      const restResult = moveContextualRestToLibraryBottom(workingState, controllerId, ctx, runtime, [cardId]);
      workingState = restResult.state;
      combinedLog.push(...restResult.log);
    }
    return buildAppliedResult({ state: workingState, log: combinedLog });
  }

  if (parsedRestOfExiledCards && step.to === 'hand') {
    const contextualExiled = Array.isArray(ctx.lastExiledCards) ? [...ctx.lastExiledCards] : [];
    let cardIds = contextualExiled
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean);
    if (cardIds.length === 0) {
      const player = nextState.players.find(p => p.id === controllerId) as any;
      cardIds = (Array.isArray(player?.exile) ? player.exile : [])
        .map((card: any) => String(card?.id || '').trim())
        .filter(Boolean);
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of cardIds) {
      const result = moveTargetedCardFromExile(workingState, controllerId, cardId, 'any', 'hand');
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log:
        combinedLog.length > 0
          ? combinedLog
          : [`Moved rest of exiled cards to hand: ${step.raw}`],
    });
  }


  return undefined;
}
