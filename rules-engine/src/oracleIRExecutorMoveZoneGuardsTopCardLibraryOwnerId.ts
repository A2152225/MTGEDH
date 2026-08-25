// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the applyMoveZoneStep selector guards starting at if (topCardLibraryOwnerId) {
// Public entry symbol: tryApplyMoveZoneGuardsFromTopCardLibraryOwnerId.

import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';
import {
  moveTopCardFromLibrary,
  moveBottomCardFromLibrary,
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
  moveTargetedCardFromExile,
  stepHasRevealedThisWayRestToLibrary,
} from './oracleIRExecutorZoneOps';
import { findBoundCardZoneLocation } from './oracleIRExecutorMoveZoneReferenceResolvers';
import { getLibraryPlacement, moveContextualCardToDestination, moveContextualRestToLibraryBottom } from './oracleIRExecutorMoveZoneContextualCardResolvers';
import { buildAppliedResult } from './oracleIRExecutorMoveZoneStepResultBuilders';

export function tryApplyMoveZoneGuardsFromTopCardLibraryOwnerId(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {
  const { state, step, ctx, runtime, nextState, log, controllerId, effectiveWithCounters, battlefieldEntryOverrides, finalizeAppliedResult, attachmentResolution, contextualBoundCardIds, topCardLibraryOwnerId, bottomCardLibraryOwnerId } = args;

  if (topCardLibraryOwnerId) {
    const libraryPlacement = getLibraryPlacement(step);
    if (
      step.to !== 'hand' &&
      step.to !== 'graveyard' &&
      step.to !== 'exile' &&
      step.to !== 'battlefield' &&
      !(step.to === 'library' && libraryPlacement)
    ) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result = moveTopCardFromLibrary(
      nextState,
      topCardLibraryOwnerId,
      step.to === 'library' ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom') : step.to,
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? topCardLibraryOwnerId
          : controllerId
        : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      undefined,
      step.faceDownWardCost
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (top card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (bottomCardLibraryOwnerId) {
    const libraryPlacement = getLibraryPlacement(step);
    if (
      step.to !== 'hand' &&
      step.to !== 'graveyard' &&
      step.to !== 'exile' &&
      step.to !== 'battlefield' &&
      !(step.to === 'library' && libraryPlacement)
    ) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    const result = moveBottomCardFromLibrary(
      nextState,
      bottomCardLibraryOwnerId,
      step.to === 'library' ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom') : step.to,
      step.to === 'battlefield'
        ? step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? bottomCardLibraryOwnerId
          : controllerId
        : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      undefined,
      step.faceDownWardCost
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (bottom card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (contextualBoundCardIds.length > 0) {
    const xAtLeastAlternate = (step as any).xAtLeastAlternate as
      | { threshold?: number; destinations?: readonly string[] }
      | undefined;
    let activeStep = step;
    if (
      xAtLeastAlternate
      && Number.isFinite(Number(xAtLeastAlternate.threshold))
      && Number.isFinite(Number(ctx.xValue))
      && Number(ctx.xValue) >= Number(xAtLeastAlternate.threshold)
    ) {
      const allowedDestinations = (Array.isArray(xAtLeastAlternate.destinations)
        ? xAtLeastAlternate.destinations
        : []
      )
        .map((destination) => String(destination || '').trim())
        .filter(Boolean);
      const chosenDestination = String(ctx.selectorContext?.moveZoneDestination || '').trim();
      if (!chosenDestination || !allowedDestinations.includes(chosenDestination)) {
        return {
          applied: false,
          message: `Move zone destination choice required: ${step.raw}`,
          reason: 'player_choice_required',
          options: {
            classification: 'player_choice',
            metadata: {
              moveZoneDestinationChoice: allowedDestinations,
              xAtLeastAlternateThreshold: Number(xAtLeastAlternate.threshold),
            },
          },
        };
      }
      activeStep = {
        ...step,
        to: chosenDestination as typeof step.to,
        ...(chosenDestination === 'battlefield' && !step.battlefieldController
          ? { battlefieldController: { kind: 'you' } as const }
          : {}),
      };
    }

    const libraryPlacement = getLibraryPlacement(activeStep);
    const ownerControlledBattlefield =
      activeStep.to === 'battlefield' &&
      (activeStep.battlefieldController?.kind === 'owner_of_moved_cards' ||
        /under their owners?'? control/i.test(String(activeStep.toRaw || activeStep.raw || '')));
    if (
      !['hand', 'exile', 'graveyard', 'battlefield'].includes(activeStep.to) &&
      !(activeStep.to === 'library' && libraryPlacement)
    ) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported destination): ${step.raw}`,
        reason: 'unsupported_destination',
      };
    }

    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedCardIds: string[] = [];
    for (const targetObjectId of contextualBoundCardIds) {
      const exactZone = findBoundCardZoneLocation(workingState, targetObjectId);
      if (!exactZone) {
        return {
          applied: false,
          message: `Skipped move zone (target object unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }

      // "Reveal cards until you reveal a land card, then put those cards into your graveyard" mills
      // them on the reveal step, so by now they are already where they belong. The zone helpers below
      // take no graveyard/exile destination and would fall through to their battlefield branch,
      // reanimating the cards instead. Library is excluded because top/bottom is a real reposition.
      if (exactZone.zone === activeStep.to && activeStep.to !== 'library') {
        movedCardIds.push(targetObjectId);
        continue;
      }

      const destination =
        activeStep.to === 'library'
          ? (libraryPlacement === 'top' ? 'library_top' : 'library_bottom')
          : activeStep.to;
      const battlefieldControllerId =
        activeStep.to === 'battlefield'
          ? ownerControlledBattlefield
            ? exactZone.playerId
            : activeStep.battlefieldController?.kind === 'you'
              ? controllerId
              : controllerId
          : undefined;
      const result =
        exactZone.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(
              workingState,
              exactZone.playerId,
              targetObjectId,
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
          : exactZone.zone === 'hand'
            ? moveTargetedCardFromHand(
                workingState,
                exactZone.playerId,
                targetObjectId,
                'any',
                destination as any,
                battlefieldControllerId,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
                battlefieldEntryOverrides
              )
            : exactZone.zone === 'library'
              ? moveContextualCardToDestination(
                  workingState,
                  exactZone,
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
                    controllerId,
                    cardType: 'any',
                    entersTapped: step.entersTapped,
                    entersFaceDown: step.entersFaceDown,
                    withCounters: effectiveWithCounters,
                    battlefieldEntryOverrides,
                    ctx,
                    stepKind: 'move_zone',
                  }
                )
              : moveTargetedCardFromExile(
                  workingState,
                  exactZone.playerId,
                  targetObjectId,
                  'any',
                  destination as any,
                  battlefieldControllerId,
                  step.entersTapped,
                  step.entersFaceDown,
                  effectiveWithCounters,
                  attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
                  battlefieldEntryOverrides
                );

      if (result.kind !== 'applied') {
        return {
          applied: false,
          message: `Skipped move zone (target object unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }

      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedCardIds.push(targetObjectId);
    }

    if (stepHasRevealedThisWayRestToLibrary(step)) {
      const restResult = moveContextualRestToLibraryBottom(
        workingState,
        controllerId,
        ctx,
        runtime,
        movedCardIds
      );
      workingState = restResult.state;
      combinedLog.push(...restResult.log);
    }

    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Moved ${contextualBoundCardIds.length} contextual card(s)`],
    });
  }

  return undefined;
}
