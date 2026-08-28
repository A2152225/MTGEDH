// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the applyMoveZoneStep selector guards starting at if (parsedSingleTargetFromTargetPlayerExile) {
// Public entry symbol: tryApplyMoveZoneGuardsFromSingleTargetFromTargetPlayerExile.

import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';
import {
  exileExactCountFromHand,
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
  moveTargetedCardFromExile,
  cardMatchesMoveZoneSingleTargetCriteria,
  type MoveZoneSingleTargetCriteria,
  findFaceUpExiledCardLocation,
} from './oracleIRExecutorZoneOps';
import {
  buildNoOpOptionalSingleTargetResult,
  getChosenObjectIds,
  getTargetPlayerId,
  hasExplicitChosenObjectIds,
  isUpToOneTargetReference,
  resolveBoundGraveyardTargetObjectId,
  resolveUniqueChosenGraveyardTargetId,
} from './oracleIRExecutorMoveZoneReferenceResolvers';
import { getLibraryPlacement, requiresExplicitControllerOverride, resolveMoveZoneSingleTargetCriteriaWithX } from './oracleIRExecutorMoveZoneContextualCardResolvers';
import { buildAppliedResult } from './oracleIRExecutorMoveZoneStepResultBuilders';

export function tryApplyMoveZoneGuardsFromSingleTargetFromTargetPlayerExile(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {
  const { state, step, ctx, runtime, nextState, log, controllerId, effectiveWithCounters, battlefieldEntryOverrides, finalizeAppliedResult, attachmentResolution, sourcePermanentPower, boundTargetObjectId } = args;
  const {
    parsedCountCardsFromTargetPlayerHand,
    parsedAlternateCostColorFromHand,
    parsedSingleTargetFromTargetPlayerExile,
    parsedSingleTargetFromYourGraveyard,
    parsedSingleTargetFromYourHand,
    parsedInstantOrSorceryGyOrFlashbackExile,
  } = args.zoneQueries;
  const {
    parsedSingleTargetFromYourExile,
    parsedTargetFaceUpExiledCard,
  } = args.referenceQueries;

  if (parsedSingleTargetFromTargetPlayerExile) {
    const targetPlayerId = getTargetPlayerId(ctx);
    const targetObjectId = boundTargetObjectId;
    if (!targetPlayerId || !targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
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

    const result = moveTargetedCardFromExile(
      nextState,
      targetPlayerId,
      targetObjectId,
      parsedSingleTargetFromTargetPlayerExile.cardType,
      step.to,
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? targetPlayerId
          : controllerId
        : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      battlefieldEntryOverrides
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
            targetPlayerId,
            zone: 'exile',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedInstantOrSorceryGyOrFlashbackExile && step.to === 'hand') {
    const effectiveCriteria = parsedInstantOrSorceryGyOrFlashbackExile;
    const gyTargetId = resolveUniqueChosenGraveyardTargetId(
      nextState,
      controllerId,
      effectiveCriteria,
      ctx,
      runtime,
      ctx.sourceName,
      sourcePermanentPower
    );
    if (gyTargetId) {
      const gyResult = moveTargetedCardFromGraveyard(
        nextState,
        controllerId,
        gyTargetId,
        effectiveCriteria,
        'hand',
        undefined,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
        ctx.sourceName,
        battlefieldEntryOverrides,
        sourcePermanentPower
      );
      if (gyResult.kind === 'applied') {
        return finalizeAppliedResult(gyResult);
      }
    }

    const exileCriteria: MoveZoneSingleTargetCriteria = { ...effectiveCriteria, requiresFlashback: true };
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const exile = Array.isArray(player?.exile) ? player.exile : [];
    const chosen = new Set(getChosenObjectIds(ctx));
    const exileMatches = exile.filter((card: any) => {
      const cardId = String(card?.id || '').trim();
      if (!cardId) return false;
      if (chosen.size > 0 && !chosen.has(cardId)) return false;
      return cardMatchesMoveZoneSingleTargetCriteria(
        card,
        exileCriteria,
        ctx.sourceName,
        undefined,
        sourcePermanentPower
      );
    });
    let exileTargetId = '';
    if (exileMatches.length === 1) {
      exileTargetId = String((exileMatches[0] as any)?.id || '').trim();
    } else if (exileMatches.length > 1) {
      for (const preferredId of getChosenObjectIds(ctx)) {
        if (exileMatches.some((card: any) => String(card?.id || '').trim() === preferredId)) {
          exileTargetId = preferredId;
          break;
        }
      }
      if (!exileTargetId) {
        exileTargetId = String((exileMatches[0] as any)?.id || '').trim();
      }
    }
    if (exileTargetId) {
      const exileResult = moveTargetedCardFromExile(
        nextState,
        controllerId,
        exileTargetId,
        effectiveCriteria.cardType,
        'hand'
      );
      if (exileResult.kind === 'applied') {
        return finalizeAppliedResult(exileResult);
      }
    }

    return {
      applied: false,
      message: `Skipped move zone (unsupported selector): ${step.raw}`,
      reason: 'unsupported_selector',
    };
  }

  if (parsedSingleTargetFromYourGraveyard) {
    const effectiveCriteria = resolveMoveZoneSingleTargetCriteriaWithX(parsedSingleTargetFromYourGraveyard, ctx);
    // This selector is always an explicit "target ... from your graveyard" reference, so a legal
    // candidate alone is not enough: without a bound target or an explicit choice the move stays
    // targeting-dependent and must be skipped rather than auto-picked.
    const boundGraveyardTargetId = resolveBoundGraveyardTargetObjectId(
      nextState,
      boundTargetObjectId,
      effectiveCriteria,
      ctx.sourceName,
      sourcePermanentPower
    );
    const targetObjectId =
      boundGraveyardTargetId ||
      (hasExplicitChosenObjectIds(ctx)
        ? resolveUniqueChosenGraveyardTargetId(
            nextState,
            controllerId,
            effectiveCriteria,
            ctx,
            runtime,
            ctx.sourceName,
            sourcePermanentPower
          )
        : '');
    const libraryPlacement = getLibraryPlacement(step);
    if (!targetObjectId) {
      if (isUpToOneTargetReference(step.what)) return buildNoOpOptionalSingleTargetResult(nextState, step);
      if (ctx.interactivePlayerChoices === true) {
        return {
          applied: false,
          message: `Skipped move zone (needs player card selection): ${step.raw}`,
          reason: 'player_choice_required',
          options: { classification: 'player_choice' },
        };
      }
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

    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      targetObjectId,
      effectiveCriteria,
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
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            targetObjectId,
            zone: 'graveyard',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromYourHand) {
    const targetObjectId = boundTargetObjectId;
    if (!targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'graveyard' && step.to !== 'exile' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result = moveTargetedCardFromHand(
      nextState,
      controllerId,
      targetObjectId,
      parsedSingleTargetFromYourHand.cardType,
      step.to,
      step.to === 'battlefield' ? controllerId : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      undefined,
      battlefieldEntryOverrides
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
            zone: 'hand',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedTargetFaceUpExiledCard) {
    const preferredIds = getChosenObjectIds(ctx);
    const location = findFaceUpExiledCardLocation(nextState, preferredIds);
    if (!location) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result = moveTargetedCardFromExile(
      nextState,
      location.playerId,
      location.cardId,
      parsedTargetFaceUpExiledCard.cardType,
      step.to,
      step.to === 'battlefield' ? location.playerId : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      battlefieldEntryOverrides
    );

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedSingleTargetFromYourExile) {
    const targetObjectId = boundTargetObjectId;
    if (!targetObjectId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result = moveTargetedCardFromExile(
      nextState,
      controllerId,
      targetObjectId,
      parsedSingleTargetFromYourExile.cardType,
      step.to,
      step.to === 'battlefield' ? controllerId : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      undefined,
      battlefieldEntryOverrides
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
            zone: 'exile',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedCountCardsFromTargetPlayerHand && step.to === 'exile') {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const preferredIds = getChosenObjectIds(ctx);
    const result = exileExactCountFromHand(
      nextState,
      targetPlayerId,
      parsedCountCardsFromTargetPlayerHand.count,
      parsedCountCardsFromTargetPlayerHand.cardType,
      preferredIds
    );
    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (not enough matching cards): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedAlternateCostColorFromHand && step.to === 'exile') {
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    const preferredIds = getChosenObjectIds(ctx);
    const { count: alternateCostCount, ...alternateCostCriteria } = parsedAlternateCostColorFromHand;
    const criteria = resolveMoveZoneSingleTargetCriteriaWithX(alternateCostCriteria, ctx);
    const matchingCards = hand.filter((card: any) => {
      const cardId = String((card as any)?.id || '').trim();
      if (preferredIds.length > 0 && !preferredIds.includes(cardId)) return false;
      return cardMatchesMoveZoneSingleTargetCriteria(card, criteria);
    });
    const exileCount = Math.max(1, Number(alternateCostCount) || 1);
    const cardsToExile = matchingCards.slice(0, exileCount);
    if (cardsToExile.length < exileCount) {
      if (step.optional) {
        return buildAppliedResult({ state: nextState, log: [`Skipped optional alternate-cost exile: ${step.raw}`] });
      }
      return {
        applied: false,
        message: `Skipped move zone (alternate-cost card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const matchingCard of cardsToExile) {
      const cardId = String((matchingCard as any)?.id || '').trim();
      const result = moveTargetedCardFromHand(workingState, controllerId, cardId, criteria.cardType, 'exile');
      if (result.kind !== 'applied') {
        return {
          applied: false,
          message: `Skipped move zone (alternate-cost card unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return finalizeAppliedResult({ kind: 'applied', state: workingState, log: combinedLog });
  }


  return undefined;
}
