// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the applyMoveZoneStep selector guards starting at if (parsedOneOfThemSplit) {
// Public entry symbol: tryApplyMoveZoneGuardsFromOneOfThemSplit.

import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';
import type { GameState } from '../../shared/src';
import {
  exileAllMatchingFromGraveyard,
  moveTargetedCardFromAnyGraveyard,
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
  moveTargetedCardFromExile,
  shuffleTypedCardsFromPlayerGraveyardIntoLibrary,
  selectRandomMatchingCardIdFromGraveyard,
  selectRandomMatchingCardIdsFromGraveyard,
  putAllMatchingFromGraveyardOntoBattlefield,
  putAllMatchingFromGraveyardOntoBattlefieldWithController,
  returnTargetAndSameNamedCardsFromYourGraveyardToHand,
  returnTargetAndSameNamedCardsFromYourGraveyardToBattlefield,
  returnAllMatchingFromGraveyardToHand,
  cardMatchesType,
} from './oracleIRExecutorZoneOps';
import {
  buildNoOpOptionalSingleTargetResult,
  findBoundCardZoneLocation,
  getChosenObjectIds,
  getTargetObjectId,
  getTargetPlayerId,
  hasExplicitChosenObjectIds,
  isUpToOneTargetReference,
  resolveBoundGraveyardTargetObjectId,
  resolveUniqueChosenAnyGraveyardTargetId,
  resolveUniqueChosenGraveyardTargetId,
} from './oracleIRExecutorMoveZoneReferenceResolvers';
import {
  getLibraryPlacement,
  moveContextualCardToDestination,
  requiresExplicitControllerOverride,
  resolveOneOfThemCandidateCardIds,
} from './oracleIRExecutorMoveZoneContextualCardResolvers';
import { buildAppliedResult } from './oracleIRExecutorMoveZoneStepResultBuilders';

export function tryApplyMoveZoneGuardsFromOneOfThemSplit(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {
  const { state, step, ctx, runtime, nextState, log, controllerId, effectiveWithCounters, battlefieldEntryOverrides, finalizeAppliedResult, attachmentResolution, sourcePermanentPower, boundTargetObjectId, parsedOneOfThemSplit, parsedOnePileSplit, contextualBoundCardZone, sourceCardZone } = args;
  const {
    parsedSingleTargetFromAnyGraveyard,
    parsedRandomSingleFromYourGraveyard,
    parsedSameNamedFromYourGraveyard,
    parsedUpToCountOfThem,
  } = args.zoneQueries;
  const {
    parsedTargetPlayerGy,
    parsedTargetPlayerHandAndGy,
    parsedTheCardFromYourGraveyard,
    parsedUpToXLandsHandGy,
  } = args.referenceQueries;

  if (parsedOneOfThemSplit) {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    if (candidateIds.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No contextual cards matched one-of-them split: ${step.raw}`],
      });
    }

    let workingState = nextState;
    const combinedLog: string[] = [];
    const handCount =
      parsedOneOfThemSplit === 'up_to_hand_library_bottom' || parsedOneOfThemSplit === 'up_to_hand_graveyard_rest'
        ? Math.max(1, parsedUpToCountOfThem?.maxCount ?? 2)
        : parsedOneOfThemSplit === 'hand_graveyard_other'
          ? 1
          : 1;
    const handIds = candidateIds.slice(0, handCount);
    const restIds = candidateIds.slice(handCount);
    const restDestination =
      parsedOneOfThemSplit === 'hand_library_bottom' || parsedOneOfThemSplit === 'up_to_hand_library_bottom'
        ? 'library_bottom'
        : 'graveyard';

    for (const handId of handIds) {
      const handLocation = findBoundCardZoneLocation(workingState, handId);
      if (!handLocation) continue;
      if (handLocation.zone === 'hand') continue;
      const handResult = moveContextualCardToDestination(workingState, handLocation, handId, 'hand', {
        controllerId,
      });
      if (handResult.kind !== 'applied') continue;
      workingState = handResult.state;
      combinedLog.push(...handResult.log);
    }

    for (const restId of restIds) {
      const restLocation = findBoundCardZoneLocation(workingState, restId);
      if (!restLocation) continue;
      const restResult = moveContextualCardToDestination(workingState, restLocation, restId, restDestination, {
        controllerId,
      });
      if (restResult.kind !== 'applied') continue;
      workingState = restResult.state;
      combinedLog.push(...restResult.log);
    }

    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Split one of them: ${step.raw}`],
    });
  }

  if (parsedOnePileSplit) {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    if (candidateIds.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No contextual cards matched one-pile split: ${step.raw}`],
      });
    }

    let workingState = nextState;
    const combinedLog: string[] = [];
    const handId = candidateIds[0];
    const restIds = candidateIds.slice(1);
    const restDestination = parsedOnePileSplit === 'hand_library_bottom' ? 'library_bottom' : 'graveyard';

    const handLocation = findBoundCardZoneLocation(workingState, handId);
    if (handLocation && handLocation.zone !== 'hand') {
      const handResult = moveContextualCardToDestination(workingState, handLocation, handId, 'hand', {
        controllerId,
      });
      if (handResult.kind === 'applied') {
        workingState = handResult.state;
        combinedLog.push(...(handResult.log || []));
      }
    }

    for (const restId of restIds) {
      const restLocation = findBoundCardZoneLocation(workingState, restId);
      if (!restLocation) continue;
      const restResult = moveContextualCardToDestination(workingState, restLocation, restId, restDestination, {
        controllerId,
      });
      if (restResult.kind !== 'applied') continue;
      workingState = restResult.state;
      combinedLog.push(...(restResult.log || []));
    }

    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Split one pile: ${step.raw}`],
    });
  }

  if (contextualBoundCardZone) {
    const targetObjectId = contextualBoundCardZone.cardId;
    const libraryPlacement = getLibraryPlacement(step);

    if (
      step.to !== 'hand' &&
      step.to !== 'exile' &&
      step.to !== 'graveyard' &&
      step.to !== 'battlefield' &&
      !(step.to === 'library' && libraryPlacement)
    ) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const contextualBattlefieldControllerId =
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'you'
          ? controllerId
          : contextualBoundCardZone.playerId
        : undefined;

    const destination =
      step.to === 'library'
        ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom')
        : step.to;

    const result =
      contextualBoundCardZone.zone === 'library'
        ? moveContextualCardToDestination(
            nextState,
            contextualBoundCardZone,
            targetObjectId,
            destination === 'library_top' || destination === 'library_bottom'
              ? destination
              : destination === 'hand'
                ? 'hand'
                : destination === 'graveyard'
                  ? 'graveyard'
                  : destination === 'exile'
                    ? 'exile'
                    : destination === 'battlefield'
                      ? 'battlefield'
                      : 'hand',
            {
              controllerId: contextualBattlefieldControllerId || contextualBoundCardZone.playerId,
              cardType: 'any',
              entersTapped: step.entersTapped,
              entersFaceDown: step.entersFaceDown,
              withCounters: effectiveWithCounters,
              battlefieldEntryOverrides,
              ctx,
              stepKind: 'move_zone',
            },
          )
        : contextualBoundCardZone.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(
            nextState,
            contextualBoundCardZone.playerId,
            targetObjectId,
            { cardType: 'any' },
            destination as any,
            contextualBattlefieldControllerId,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
            undefined,
            battlefieldEntryOverrides
          )
        : contextualBoundCardZone.zone === 'hand'
          ? moveTargetedCardFromHand(
              nextState,
              contextualBoundCardZone.playerId,
              targetObjectId,
              'any',
              destination as any,
              contextualBattlefieldControllerId,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
              battlefieldEntryOverrides
            )
          : moveTargetedCardFromExile(
              nextState,
              contextualBoundCardZone.playerId,
              targetObjectId,
              'any',
              destination as any,
              contextualBattlefieldControllerId,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
              battlefieldEntryOverrides
            );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target object unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (sourceCardZone) {
    const libraryPlacement = getLibraryPlacement(step);
    if (
      step.to !== 'hand' &&
      step.to !== 'exile' &&
      step.to !== 'graveyard' &&
      step.to !== 'battlefield' &&
      !(step.to === 'library' && libraryPlacement)
    ) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const destination =
      step.to === 'library'
        ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom')
        : step.to;
    const battlefieldControllerId =
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'you'
          ? controllerId
          : sourceCardZone.playerId
        : undefined;
    const result =
      sourceCardZone.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(
            nextState,
            sourceCardZone.playerId,
            sourceCardZone.cardId,
            { cardType: 'any' },
            destination as any,
            battlefieldControllerId,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
            undefined,
            battlefieldEntryOverrides
          )
        : sourceCardZone.zone === 'hand'
          ? moveTargetedCardFromHand(
              nextState,
              sourceCardZone.playerId,
              sourceCardZone.cardId,
              'any',
              destination as any,
              battlefieldControllerId,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
              battlefieldEntryOverrides
            )
          : moveTargetedCardFromExile(
              nextState,
              sourceCardZone.playerId,
              sourceCardZone.cardId,
              'any',
              destination as any,
              battlefieldControllerId,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
              battlefieldEntryOverrides
            );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (source card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedTargetPlayerGy) {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to === 'library') {
      const workingState = shuffleTypedCardsFromPlayerGraveyardIntoLibrary(
        nextState,
        targetPlayerId,
        parsedTargetPlayerGy.cardType
      );
      return buildAppliedResult({
        state: workingState,
        log: [`Shuffled ${parsedTargetPlayerGy.cardType} card(s) from ${targetPlayerId}'s graveyard into their library: ${step.raw}`],
      });
    }

    if (step.to !== 'exile' && step.to !== 'hand' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result =
      step.to === 'hand'
        ? returnAllMatchingFromGraveyardToHand(nextState, targetPlayerId, parsedTargetPlayerGy.cardType)
        : step.to === 'battlefield'
          ? step.battlefieldController?.kind === 'owner_of_moved_cards'
            ? putAllMatchingFromGraveyardOntoBattlefield(
                nextState,
                targetPlayerId,
                parsedTargetPlayerGy.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              )
            : putAllMatchingFromGraveyardOntoBattlefieldWithController(
                nextState,
                targetPlayerId,
                controllerId,
                parsedTargetPlayerGy.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              )
          : exileAllMatchingFromGraveyard(nextState, targetPlayerId, parsedTargetPlayerGy.cardType, {
              ...(parsedTargetPlayerGy.excludeBasicLands ? { excludeBasicLands: true } : {}),
              ...(parsedTargetPlayerGy.requiresFlashback ? { requiresFlashback: true } : {}),
              ...(parsedTargetPlayerGy.faceDown ? { faceDown: true } : {}),
              ...(parsedTargetPlayerGy.shuffleExiledPile ? { shuffleExiledPile: true } : {}),
            });
    return finalizeAppliedResult(result);
  }

  if (parsedTargetPlayerHandAndGy && step.to === 'exile') {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const player = nextState.players.find(p => p.id === targetPlayerId) as any;
    if (!player) {
      return buildAppliedResult({ state: nextState, log: [`No target player for hand/graveyard exile: ${step.raw}`] });
    }
    const hand = Array.isArray(player.hand) ? [...player.hand] : [];
    const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
    const exile = Array.isArray(player.exile) ? [...player.exile] : [];
    const toExile = [...hand, ...graveyard].filter((card: any) =>
      cardMatchesType(card, parsedTargetPlayerHandAndGy.cardType)
    );
    const keptHand = hand.filter((card: any) => !cardMatchesType(card, parsedTargetPlayerHandAndGy.cardType));
    const keptGy = graveyard.filter((card: any) => !cardMatchesType(card, parsedTargetPlayerHandAndGy.cardType));
    const updatedPlayers = nextState.players.map((entry: any) =>
      String(entry?.id || '').trim() === targetPlayerId
        ? { ...entry, hand: keptHand, graveyard: keptGy, exile: [...exile, ...toExile] }
        : entry
    );
    return buildAppliedResult({
      state: { ...(nextState as any), players: updatedPlayers } as GameState,
      log: [
        `Exiled ${toExile.length} card(s) from hand and graveyard${
          parsedTargetPlayerHandAndGy.cardType === 'noncreature_nonland_permanent' ? ' (noncreature nonland)' : ''
        }`,
      ],
    });
  }

  if (parsedTheCardFromYourGraveyard && step.to === 'battlefield') {
    const preferredIds = getChosenObjectIds(ctx);
    const cardId =
      preferredIds.find(id => {
        const player = nextState.players.find(p => p.id === controllerId) as any;
        const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
        return graveyard.some((card: any) => String(card?.id || '').trim() === id);
      }) ||
      (() => {
        const player = nextState.players.find(p => p.id === controllerId) as any;
        const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
        return String(graveyard[0]?.id || '').trim() || undefined;
      })();
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No graveyard card to return: ${step.raw}`] });
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
      undefined,
      undefined,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedUpToXLandsHandGy && step.to === 'battlefield') {
    const maxCount = Math.max(0, Number(ctx.xValue) || 1);
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const hand = Array.isArray(player?.hand) ? [...player.hand] : [];
    const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
    const preferred = new Set(getChosenObjectIds(ctx).map(id => String(id || '').trim()).filter(Boolean));
    const landIds: string[] = [];
    for (const card of [...hand, ...graveyard]) {
      if (landIds.length >= maxCount) break;
      const cardId = String(card?.id || '').trim();
      if (!cardId || !cardMatchesType(card, 'land')) continue;
      if (preferred.size > 0 && !preferred.has(cardId)) continue;
      if (!landIds.includes(cardId)) landIds.push(cardId);
    }
    if (preferred.size > 0 && landIds.length === 0) {
      for (const card of [...hand, ...graveyard]) {
        if (landIds.length >= maxCount) break;
        const cardId = String(card?.id || '').trim();
        if (!cardId || !cardMatchesType(card, 'land') || landIds.includes(cardId)) continue;
        landIds.push(cardId);
      }
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    for (const cardId of landIds) {
      const fromHand = hand.some((card: any) => String(card?.id || '').trim() === cardId);
      const result = fromHand
        ? moveTargetedCardFromHand(
            workingState,
            controllerId,
            cardId,
            'land',
            'battlefield',
            controllerId,
            true,
            step.entersFaceDown,
            effectiveWithCounters,
            undefined,
            battlefieldEntryOverrides
          )
        : moveTargetedCardFromGraveyard(
            workingState,
            controllerId,
            cardId,
            { cardType: 'land' },
            'battlefield',
            controllerId,
            true,
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
      log: combinedLog.length > 0 ? combinedLog : [`Moved lands from hand/graveyard: ${step.raw}`],
      movedBattlefieldPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedSameNamedFromYourGraveyard) {
    const targetObjectId = boundTargetObjectId;
    if (!targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to === 'hand') {
      const result = returnTargetAndSameNamedCardsFromYourGraveyardToHand(
        nextState,
        controllerId,
        targetObjectId,
        parsedSameNamedFromYourGraveyard
      );
      if (result.kind === 'impossible') {
        return {
          applied: false,
          message: `Skipped move zone (target object unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      return finalizeAppliedResult(result);
    }

    if (step.to === 'battlefield') {
      const result = returnTargetAndSameNamedCardsFromYourGraveyardToBattlefield(
        nextState,
        controllerId,
        targetObjectId,
        parsedSameNamedFromYourGraveyard,
        step.entersTapped
      );
      if (result.kind === 'impossible') {
        return {
          applied: false,
          message: `Skipped move zone (target object unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      return finalizeAppliedResult(result);
    }

    return {
      applied: false,
      message: `Skipped move zone (unsupported destination): ${step.raw}`,
      reason: 'unsupported_destination',
    };
  }

  if (parsedRandomSingleFromYourGraveyard) {
    const libraryPlacement = getLibraryPlacement(step);
    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield' && !(step.to === 'library' && libraryPlacement)) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if ('count' in parsedRandomSingleFromYourGraveyard) {
      const randomCount = parsedRandomSingleFromYourGraveyard.useXValue
        ? Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 3))
        : parsedRandomSingleFromYourGraveyard.count;
      const selection = selectRandomMatchingCardIdsFromGraveyard(
        nextState,
        controllerId,
        parsedRandomSingleFromYourGraveyard.criteria,
        randomCount,
        ctx.sourceName,
        sourcePermanentPower
      );
      if (selection.kind === 'missing_player') {
        return {
          applied: false,
          message: `Skipped move zone (unsupported selector): ${step.raw}`,
          reason: 'unsupported_selector',
        };
      }
      if (selection.kind === 'impossible') {
        return {
          applied: false,
          message: `Skipped move zone (target object unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      let workingState = nextState;
      const combinedLog: string[] = [];
      const movedBattlefieldIds: string[] = [];
      for (const cardId of selection.cardIds) {
        const result = moveTargetedCardFromGraveyard(
          workingState,
          controllerId,
          cardId,
          parsedRandomSingleFromYourGraveyard.criteria,
          step.to === 'library' ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom') : step.to,
          step.to === 'battlefield' ? controllerId : undefined,
          step.entersTapped,
          step.entersFaceDown,
          effectiveWithCounters,
          attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
          ctx.sourceName,
          battlefieldEntryOverrides,
          sourcePermanentPower
        );
        if (result.kind !== 'applied') continue;
        workingState = result.state;
        combinedLog.push(...(result.log || []));
        movedBattlefieldIds.push(...(result.movedPermanentIds || []));
      }
      return buildAppliedResult({
        state: workingState,
        log: combinedLog.length > 0 ? combinedLog : [`Moved random graveyard cards: ${step.raw}`],
        ...(movedBattlefieldIds.length > 0 ? { movedBattlefieldPermanentIds: movedBattlefieldIds } : {}),
      });
    }

    const selection = selectRandomMatchingCardIdFromGraveyard(
      nextState,
      controllerId,
      parsedRandomSingleFromYourGraveyard,
      ctx.sourceName,
      sourcePermanentPower
    );
    if (selection.kind === 'missing_player') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    if (selection.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target object unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      selection.cardId,
      parsedRandomSingleFromYourGraveyard,
      step.to === 'library' ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom') : step.to,
      step.to === 'battlefield' ? controllerId : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      ctx.sourceName,
      battlefieldEntryOverrides,
      sourcePermanentPower
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target object unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromAnyGraveyard) {
    // "target ... from a graveyard" is an explicit target, so a single legal candidate is not a
    // licence to auto-pick it: without a bound target or an explicit choice the move stays
    // targeting-dependent and must be skipped.
    const boundAnyGraveyardTargetId = resolveBoundGraveyardTargetObjectId(
      nextState,
      boundTargetObjectId,
      parsedSingleTargetFromAnyGraveyard,
      ctx.sourceName,
      sourcePermanentPower
    );
    // A bound id that fails strict criteria matching (e.g. the "other" qualifier needs a source the
    // caller did not supply) still counts as someone having chosen a target, so the unique-candidate
    // resolver may run. What must not happen is auto-picking when nothing was targeted at all.
    const boundTargetRaw = String(getTargetObjectId(ctx) || '').trim();
    const callerSuppliedATarget = hasExplicitChosenObjectIds(ctx) || Boolean(boundTargetRaw);
    // getTargetObjectId also surfaces ids the caller bound as permanents, which is how a graveyard
    // card gets named for "target ... from a graveyard". boundTargetObjectId ignores those fields, so
    // validate the raw id against the selector here rather than reading legality off that result.
    const validatedBoundTargetId = boundTargetRaw
      ? resolveBoundGraveyardTargetObjectId(
          nextState,
          boundTargetRaw,
          parsedSingleTargetFromAnyGraveyard,
          ctx.sourceName,
          sourcePermanentPower
        )
      : '';
    // A bound id naming a card that sits in a graveyard yet fails the selector is an illegal target,
    // not an invitation to substitute the one card that does qualify.
    const boundTargetIsIllegalGraveyardCard =
      !hasExplicitChosenObjectIds(ctx) &&
      Boolean(boundTargetRaw) &&
      !validatedBoundTargetId &&
      findBoundCardZoneLocation(nextState, boundTargetRaw)?.zone === 'graveyard';
    const boundOpponentId =
      parsedSingleTargetFromAnyGraveyard.graveyardOwner === 'opponent'
        ? getTargetPlayerId(ctx)
        : '';
    const targetObjectId =
      boundAnyGraveyardTargetId ||
      validatedBoundTargetId ||
      (callerSuppliedATarget && !boundTargetIsIllegalGraveyardCard
        ? resolveUniqueChosenAnyGraveyardTargetId(
            nextState,
            parsedSingleTargetFromAnyGraveyard,
            ctx,
            runtime,
            ctx.sourceName,
            sourcePermanentPower
          )
        : '') ||
      (boundOpponentId
        ? resolveUniqueChosenGraveyardTargetId(
            nextState,
            boundOpponentId,
            parsedSingleTargetFromAnyGraveyard,
            ctx,
            runtime,
            ctx.sourceName,
            sourcePermanentPower
          )
        : '');
    if (
      targetObjectId
      && parsedSingleTargetFromAnyGraveyard.graveyardOwner === 'opponent'
    ) {
      const loc = findBoundCardZoneLocation(nextState, targetObjectId);
      if (loc?.playerId && loc.playerId === controllerId) {
        return {
          applied: false,
          message: `Skipped move zone (illegal opponent-graveyard target): ${step.raw}`,
          reason: 'unsupported_selector',
        };
      }
    }
    const libraryPlacement = getLibraryPlacement(step);
    if (!targetObjectId) {
      if (isUpToOneTargetReference(step.what)) return buildNoOpOptionalSingleTargetResult(nextState, step);
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield' && !(step.to === 'library' && libraryPlacement)) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    if (step.to === 'battlefield' && requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result = moveTargetedCardFromAnyGraveyard(
      nextState,
      targetObjectId,
      parsedSingleTargetFromAnyGraveyard,
      step.to === 'library' ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom') : step.to,
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? undefined
          : controllerId
        : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      ctx.sourceName,
      battlefieldEntryOverrides,
      sourcePermanentPower
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            zone: 'graveyard',
            scope: 'any_graveyard',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }


  return undefined;
}
