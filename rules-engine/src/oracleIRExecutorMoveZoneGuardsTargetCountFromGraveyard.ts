// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the applyMoveZoneStep selector guards starting at if (parsedTargetCountFromGraveyard) {
// Public entry symbol: tryApplyMoveZoneGuardsFromTargetCountFromGraveyard.

import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';
import {
  exileExactMatchingFromGraveyard,
  exileAllMatchingFromGraveyard,
  moveAllMatchingFromExile,
  moveAllMatchingFromHand,
  moveAllMatchingFromLibrary,
  putExactMatchingFromGraveyardOntoBattlefieldWithController,
  putAllMatchingFromExileOntoBattlefield,
  putAllMatchingFromExileOntoBattlefieldWithController,
  putAllMatchingFromGraveyardOntoBattlefield,
  putAllMatchingFromGraveyardOntoBattlefieldWithController,
  putAllMatchingFromHandOntoBattlefield,
  putAllMatchingFromHandOntoBattlefieldWithController,
  returnExactMatchingFromGraveyardToHand,
  returnAllMatchingFromGraveyardToHand,
  returnAllOwnedMatchingCardsToPlayerHand,
} from './oracleIRExecutorZoneOps';
import {
  getChosenObjectIds,
  getOpponents,
  getTargetPlayerId,
  resolveMoveZoneGraveyardCount,
} from './oracleIRExecutorMoveZoneReferenceResolvers';
import { requiresExplicitControllerOverride } from './oracleIRExecutorMoveZoneContextualCardResolvers';

export function tryApplyMoveZoneGuardsFromTargetCountFromGraveyard(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {
  const { state, step, ctx, log, controllerId, effectiveWithCounters, finalizeAppliedResult, attachmentResolution } = args;
  // Rebound locally: the per-opponent loops below reassign it and then return unconditionally,
  // so the caller never observes the intermediate states.
  let nextState = args.nextState;
  const {
    parsedCountFromGraveyard,
    parsedTargetCountFromGraveyard,
  } = args.zoneQueries;
  const {
    parsedEachOpponentsGy,
    parsedEachOpponentsHand,
    parsedEachOpponentsExile,
    parsedTargetPlayerHand,
    parsedAllTypedCardsTargetPlayerOwns,
    parsedTargetPlayerLibrary,
    parsedTargetPlayerExile,
  } = args.referenceQueries;

  if (parsedTargetCountFromGraveyard) {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield') {
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

    const result =
      step.to === 'hand'
        ? returnExactMatchingFromGraveyardToHand(
            nextState,
            targetPlayerId,
            parsedTargetCountFromGraveyard.count,
            parsedTargetCountFromGraveyard.cardType
          )
        : step.to === 'battlefield'
          ? putExactMatchingFromGraveyardOntoBattlefieldWithController(
              nextState,
              targetPlayerId,
              step.battlefieldController?.kind === 'owner_of_moved_cards' ? targetPlayerId : controllerId,
              parsedTargetCountFromGraveyard.count,
              parsedTargetCountFromGraveyard.cardType,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined
            )
          : exileExactMatchingFromGraveyard(
              nextState,
              targetPlayerId,
              parsedTargetCountFromGraveyard.count,
              parsedTargetCountFromGraveyard.cardType
            );

    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          metadata: {
            requiredCount: parsedTargetCountFromGraveyard.count,
            availableCount: result.available,
            zone: 'graveyard',
            destination: step.to,
            targetPlayerId,
          },
        },
      };
    }

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (not enough matching cards): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            requiredCount: parsedTargetCountFromGraveyard.count,
            availableCount: result.available,
            zone: 'graveyard',
            destination: step.to,
            targetPlayerId,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedTargetPlayerExile) {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
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

    if (requiresExplicitControllerOverride(step)) {
      return {
        applied: false,
        message: `Skipped move zone (battlefield requires explicit control override): ${step.raw}`,
        reason: 'battlefield_requires_explicit_control_override',
      };
    }

    const result =
      step.to === 'hand'
        ? moveAllMatchingFromExile(nextState, targetPlayerId, parsedTargetPlayerExile.cardType, 'hand')
        : step.to === 'graveyard'
          ? moveAllMatchingFromExile(nextState, targetPlayerId, parsedTargetPlayerExile.cardType, 'graveyard')
          : step.battlefieldController?.kind === 'owner_of_moved_cards'
            ? putAllMatchingFromExileOntoBattlefield(
                nextState,
                targetPlayerId,
                parsedTargetPlayerExile.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              )
            : putAllMatchingFromExileOntoBattlefieldWithController(
                nextState,
                targetPlayerId,
                controllerId,
                parsedTargetPlayerExile.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              );
    return finalizeAppliedResult(result);
  }

  if (parsedAllTypedCardsTargetPlayerOwns && step.to === 'hand') {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const result = returnAllOwnedMatchingCardsToPlayerHand(
      nextState,
      targetPlayerId,
      parsedAllTypedCardsTargetPlayerOwns.cardType
    );
    return finalizeAppliedResult(result);
  }

  if (parsedTargetPlayerHand) {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    if (step.to !== 'exile' && step.to !== 'graveyard' && step.to !== 'battlefield') {
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
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'you'
          ? putAllMatchingFromHandOntoBattlefieldWithController(
              nextState,
              targetPlayerId,
              controllerId,
              parsedTargetPlayerHand.cardType,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters
            )
          : putAllMatchingFromHandOntoBattlefield(
              nextState,
              targetPlayerId,
              parsedTargetPlayerHand.cardType,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters
            )
        : moveAllMatchingFromHand(nextState, targetPlayerId, parsedTargetPlayerHand.cardType, step.to);
    return finalizeAppliedResult(result);
  }

  if (parsedTargetPlayerLibrary && step.to === 'exile') {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const result = moveAllMatchingFromLibrary(
      nextState,
      targetPlayerId,
      parsedTargetPlayerLibrary.cardType,
      'exile'
    );
    return finalizeAppliedResult(result);
  }

  if (parsedCountFromGraveyard) {
    if (step.to !== 'hand' && step.to !== 'exile' && step.to !== 'battlefield') {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const requiredCount = resolveMoveZoneGraveyardCount(parsedCountFromGraveyard, ctx);

    const result =
      step.to === 'hand'
        ? returnExactMatchingFromGraveyardToHand(
            nextState,
            controllerId,
            requiredCount,
            parsedCountFromGraveyard.cardType,
            getChosenObjectIds(ctx)
          )
        : step.to === 'battlefield'
          ? putExactMatchingFromGraveyardOntoBattlefieldWithController(
              nextState,
              controllerId,
              controllerId,
              requiredCount,
              parsedCountFromGraveyard.cardType,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined
            )
          : exileExactMatchingFromGraveyard(
              nextState,
              controllerId,
              requiredCount,
              parsedCountFromGraveyard.cardType
            );

    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          metadata: {
            requiredCount,
            availableCount: result.available,
            zone: 'graveyard',
            destination: step.to,
          },
        },
      };
    }

    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (not enough matching cards): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            requiredCount,
            availableCount: result.available,
            zone: 'graveyard',
            destination: step.to,
          },
        },
      };
    }

    return finalizeAppliedResult(result);
  }

  if (parsedEachOpponentsExile) {
    if (step.to !== 'hand' && step.to !== 'graveyard' && step.to !== 'battlefield') {
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

    for (const player of getOpponents(nextState, controllerId)) {
      const result =
        step.to === 'hand'
          ? moveAllMatchingFromExile(nextState, player.id, parsedEachOpponentsExile.cardType, 'hand')
          : step.to === 'graveyard'
            ? moveAllMatchingFromExile(nextState, player.id, parsedEachOpponentsExile.cardType, 'graveyard')
            : step.battlefieldController?.kind === 'owner_of_moved_cards'
              ? putAllMatchingFromExileOntoBattlefield(
                  nextState,
                  player.id,
                  parsedEachOpponentsExile.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                )
              : putAllMatchingFromExileOntoBattlefieldWithController(
                  nextState,
                  player.id,
                  controllerId,
                  parsedEachOpponentsExile.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                );
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }

  if (parsedEachOpponentsGy) {
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

    for (const player of getOpponents(nextState, controllerId)) {
      const result =
        step.to === 'hand'
          ? returnAllMatchingFromGraveyardToHand(nextState, player.id, parsedEachOpponentsGy.cardType)
          : step.to === 'battlefield'
            ? step.battlefieldController?.kind === 'owner_of_moved_cards'
              ? putAllMatchingFromGraveyardOntoBattlefield(
                  nextState,
                  player.id,
                  parsedEachOpponentsGy.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                )
              : putAllMatchingFromGraveyardOntoBattlefieldWithController(
                  nextState,
                  player.id,
                  controllerId,
                  parsedEachOpponentsGy.cardType,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters
                )
            : exileAllMatchingFromGraveyard(nextState, player.id, parsedEachOpponentsGy.cardType);
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }

  if (parsedEachOpponentsHand) {
    if (step.to !== 'exile' && step.to !== 'graveyard' && step.to !== 'battlefield') {
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

    for (const player of getOpponents(nextState, controllerId)) {
      const result =
        step.to === 'battlefield'
          ? step.battlefieldController?.kind === 'you'
          ? putAllMatchingFromHandOntoBattlefieldWithController(
                nextState,
                player.id,
                controllerId,
                parsedEachOpponentsHand.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              )
            : putAllMatchingFromHandOntoBattlefield(
                nextState,
                player.id,
                parsedEachOpponentsHand.cardType,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters
              )
          : moveAllMatchingFromHand(nextState, player.id, parsedEachOpponentsHand.cardType, step.to);
      nextState = result.state;
      log.push(...result.log);
    }

    return { applied: true, state: nextState, log };
  }


  return undefined;
}
