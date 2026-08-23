/**
 * socket/resolutionLibrarySearchOracleIrChoiceResume.ts
 *
 * Oracle-IR choice-step early-return path for library-search resolution.
 * When oracleIrChoiceStepJson is present, apply/resume IR and return without
 * falling through to legacy library-search destination handlers.
 * Extracted from resolutionLibrarySearchHandlers / resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../db/index.js";
import { cardHasCreatureType } from "../state/creatureTypeNow.js";
import {
  maybeApplyOracleIrChoiceStepFromResolution,
  maybeResumeOracleIRStepsAfterResolution,
  syncAllOracleIRPlayerZonesAfterResolution,
} from "../state/modules/oracleIrServerZoneSync.js";
import {
  readOracleIrCompoundResumePersistFields,
  readOracleIrLedgerPersistFields,
} from "../state/modules/oracleIrTransitionPipeline.js";
import type { ResolutionStep, ResolutionStepResponse } from "../state/resolution/index.js";
import { debug, debugWarn } from "../utils/debug.js";
import { broadcastGame } from "./util.js";
import { cloneLibraryStateForEvent } from "./resolutionCloneQueuedPromptUtils.js";
import { putCardOntoBattlefield } from "./resolutionPutCardOntoBattlefieldUtils.js";
import {
  oracleIrCompoundResumeIncludesDraw,
  oracleIrLibrarySearchResumeApplied,
  readShuffledLibraryIdsFromReplayMutations,
} from "./resolutionLibrarySearchOracleIrResumeUtils.js";

/**
 * @returns true if the Oracle-IR library-search path fully handled the response
 * (caller should return without running legacy destination logic).
 */
export async function tryHandleLibrarySearchOracleIrChoiceResume(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
  searchStep: any,
  selections: string[] | undefined,
  splitAssignments: any,
  searchOwnerId: string,
  availableCards: any[],
  nonSelectableCards: any[],
  entersTapped: boolean,
  sourceName: string,
  attachSelectedEquipmentToPermanentId: string,
  pid: any,
  destinationFaceDown: boolean,
  grantPlayableFromExileToController: boolean,
  grantPlayableFromExileControllerId: string,
  grantPlayableFromExileSpendManaAsThoughAnyType: boolean,
  playableFromExileTypeKey: string,
  lifeLoss: any,
): Promise<{ handled: boolean; destination?: string }> {
  if (!String(searchStep.oracleIrChoiceStepJson || '').trim()) {
    return { handled: false };
  }

  let destination = searchStep.destination || 'hand';

    const ctx = ((game as any).ctx || game) as any;
    ctx.gameId = gameId;
    ctx.state = game.state;
    const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, step, {
      ...response,
      splitAssignments,
    });
    // Never fall through to legacy library-search handlers when Oracle IR consumed the
    // choice response — legacy split/battlefield code would duplicate permanents.
    if (resumed !== null) {
      if (oracleIrLibrarySearchResumeApplied(resumed)) {
      const compoundResumePersistFields = readOracleIrCompoundResumePersistFields(searchStep);
      const ledgerPersistFields = readOracleIrLedgerPersistFields(game.state);
      const remainingLibraryIdsBeforeCompoundResume = ((game as any).libraries?.get(searchOwnerId) || [])
        .map((card: any) => String(card?.id || ''))
        .filter(Boolean);
      const compoundResumeResult = maybeResumeOracleIRStepsAfterResolution(ctx, step);
      game.state = ctx.state;
      syncAllOracleIRPlayerZonesAfterResolution(ctx);

      // Celestial / behold: IR search_library resumes to hand; promote when additional cost + type match.
      const chosenTypeBattlefieldIfPaidIr = (searchStep as any).chosenTypeBattlefieldIfPaid as
        | { chosenType?: string; additionalCostPaid?: boolean }
        | undefined;
      const selectedIdsForBehold = Array.isArray(selections) ? selections : [];
      const selectedCardForBehold = selectedIdsForBehold.length === 1
        ? [...availableCards, ...nonSelectableCards].find(
          (card: any) => String(card?.id || '') === String(selectedIdsForBehold[0] || ''),
        )
        : undefined;
      if (
        chosenTypeBattlefieldIfPaidIr?.additionalCostPaid === true
        && String(chosenTypeBattlefieldIfPaidIr.chosenType || '').trim()
        && selectedCardForBehold
        && cardHasCreatureType(selectedCardForBehold, String(chosenTypeBattlefieldIfPaidIr.chosenType))
      ) {
        const zonesRef = (game.state as any).zones || {};
        const ownerZone = zonesRef[searchOwnerId] = zonesRef[searchOwnerId] || {
          hand: [],
          handCount: 0,
          graveyard: [],
          graveyardCount: 0,
          exile: [],
          exileCount: 0,
        };
        const handCards: any[] = Array.isArray(ownerZone.hand) ? ownerZone.hand : [];
        const handIdx = handCards.findIndex(
          (card: any) => String(card?.id || '') === String(selectedIdsForBehold[0] || ''),
        );
        const cardFromHand = handIdx >= 0 ? handCards.splice(handIdx, 1)[0] : selectedCardForBehold;
        ownerZone.hand = handCards;
        ownerZone.handCount = handCards.length;
        const playerRef = ((game.state as any).players || []).find(
          (entry: any) => String(entry?.id || '') === searchOwnerId,
        );
        if (playerRef && Array.isArray(playerRef.hand)) {
          playerRef.hand = playerRef.hand.filter(
            (card: any) => String(card?.id || '') !== String(selectedIdsForBehold[0] || ''),
          );
        }
        const { uid: uidFn, parsePT: parsePtFn, cardManaValue: cmcFn } = await import('../state/utils.js');
        const { applyCounterModifications: applyCountersFn } = await import('../state/modules/counters_tokens.js');
        const { getETBTriggersForPermanent: getEtbFn } = await import('../state/modules/triggered-abilities.js');
        const { triggerETBEffectsForPermanent: triggerEtbFn } = await import('../state/modules/triggerEtbPermanentEffects.js');
        const { detectEntersWithCounters: detectEtbCountersFn } = await import('../state/modules/detectEntersWithCounters.js');
        const { creatureWillHaveHaste: hasteFn } = await import('../state/modules/creatureEntryHasteUtils.js');
        const { checkPermanentEntersTapped: entersTappedFn } = await import('../state/modules/triggerPermanentEntersTapped.js');
        const battlefieldArr = (game.state as any).battlefield = (game.state as any).battlefield || [];
        await putCardOntoBattlefield(
          cardFromHand,
          searchOwnerId,
          entersTapped,
          game.state,
          battlefieldArr,
          uidFn,
          parsePtFn,
          cmcFn,
          applyCountersFn,
          getEtbFn,
          triggerEtbFn,
          detectEtbCountersFn,
          hasteFn,
          entersTappedFn,
          game,
          io,
          gameId,
        );
        destination = 'battlefield';
        debug(2, `[Resolution] ${sourceName}: IR behold paid + type match; moved ${String(cardFromHand?.name || '')} to battlefield`);
      }

      const shuffledLibraryIdsFromMutations = readShuffledLibraryIdsFromReplayMutations(
        compoundResumeResult,
        searchOwnerId,
      );
      const playerLibraryAfterCompound = ((game.state as any).players || []).find(
        (entry: any) => String(entry?.id || '').trim() === searchOwnerId,
      ) as any;
      const libraryIdsFromPlayerState = Array.isArray(playerLibraryAfterCompound?.library)
        ? playerLibraryAfterCompound.library
            .map((card: any) => String(card?.id || '').trim())
            .filter(Boolean)
        : [];
      const remainingLibraryIdsAfterCompoundResume = shuffledLibraryIdsFromMutations
        ?? (libraryIdsFromPlayerState.length > 0
          ? libraryIdsFromPlayerState
          : (((game as any).libraries?.get(searchOwnerId) || [])
            .map((card: any) => String(card?.id || ''))
            .filter(Boolean)));

      if ((searchStep as any).persistLibrarySearchResolve === true) {
        const selectedIds = Array.isArray(selections) ? selections : [];
        const cardMap = new Map(
          [...availableCards, ...nonSelectableCards].map((card: any) => [card.id, card]),
        );
        const selectedCards = selectedIds
          .map((cardId: string) => cardMap.get(cardId))
          .filter(Boolean);
        const battlefieldRef = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
        const createdPermanentIds = (splitAssignments?.toBattlefield || []).length > 0
          ? (splitAssignments?.toBattlefield || [])
              .map((cardId: string) => {
                const perm = battlefieldRef.find(
                  (entry: any) => String(entry?.card?.id || '').trim() === String(cardId || '').trim(),
                );
                return perm ? String(perm.id || '').trim() : '';
              })
              .filter(Boolean)
          : (destination === 'battlefield' && selectedCards.length > 0)
            ? selectedCards
                .map((card: any) => {
                  const perm = battlefieldRef.find(
                    (entry: any) => String(entry?.card?.id || '').trim() === String(card?.id || '').trim(),
                  );
                  return perm ? String(perm.id || '').trim() : '';
                })
                .filter(Boolean)
            : undefined;

        if (
          !oracleIrCompoundResumeIncludesDraw(searchStep)
          && remainingLibraryIdsAfterCompoundResume.length > 0
          && (game as any).libraries?.set
        ) {
          const lib = (game as any).libraries.get(searchOwnerId) || [];
          const byId = new Map(lib.map((card: any) => [String(card?.id || ''), card]));
          const reordered = remainingLibraryIdsAfterCompoundResume
            .map((id) => byId.get(String(id || '')))
            .filter(Boolean)
            .map((card: any) => ({ ...card, zone: 'library' }));
          (game as any).libraries.set(searchOwnerId, reordered);
          const zones = (game.state as any).zones || {};
          const z = zones[searchOwnerId] = zones[searchOwnerId] || {};
          z.library = reordered;
          z.libraryCount = reordered.length;
          const player = ((game.state as any).players || []).find((entry: any) => String(entry?.id || '') === searchOwnerId);
          if (player) (player as any).library = reordered;
        }

        try {
          const libraryAfterSnapshot = !oracleIrCompoundResumeIncludesDraw(searchStep)
            ? cloneLibraryStateForEvent(
                Array.isArray((game as any).libraries?.get(searchOwnerId))
                  ? (game as any).libraries.get(searchOwnerId)
                  : [],
              )
            : undefined;
          const remainingLibraryIdsForPersist = oracleIrCompoundResumeIncludesDraw(searchStep)
            ? remainingLibraryIdsBeforeCompoundResume
            : (Array.isArray(libraryAfterSnapshot) && libraryAfterSnapshot.length > 0
              ? libraryAfterSnapshot
                  .map((card: any) => String(card?.id || '').trim())
                  .filter(Boolean)
              : remainingLibraryIdsAfterCompoundResume);
          appendEvent(gameId, game.seq ?? 0, 'librarySearchResolve', {
            playerId: pid,
            resolvedStepId: String((step as any).id || '').trim(),
            searchOwnerId,
            sourceId: String((step as any).sourceId || ''),
            sourceName,
            reason: String((searchStep as any).persistLibrarySearchResolveReason || ''),
            abilityId: String((searchStep as any).persistLibrarySearchResolveAbilityId || ''),
            selectedCardIds: selectedCards.map((card: any) => String(card?.id || '')).filter(Boolean),
            selectedCards: selectedCards.map((card: any) => ({ ...card })),
            createdPermanentIds: createdPermanentIds && createdPermanentIds.length > 0
              ? [...createdPermanentIds]
              : undefined,
            destination,
            splitAssignments: splitAssignments || undefined,
            entersTapped,
            destinationFaceDown,
            grantPlayableFromExileToController,
            grantPlayableFromExileControllerId,
            grantPlayableFromExileSpendManaAsThoughAnyType,
            playableFromExileTypeKey,
            remainingLibraryIds: remainingLibraryIdsForPersist,
            ...(Array.isArray(libraryAfterSnapshot) && libraryAfterSnapshot.length > 0
              ? { libraryAfter: libraryAfterSnapshot }
              : {}),
            lifeLoss: Number(lifeLoss || 0),
            ...ledgerPersistFields,
            ...(Array.isArray(libraryAfterSnapshot) && libraryAfterSnapshot.length > 0
              ? {}
              : compoundResumePersistFields),
          });
        } catch {
          // Ignore persistence failures.
        }
      }

      if (destination === 'battlefield' && attachSelectedEquipmentToPermanentId) {
        const selectedIds = Array.isArray(selections) ? selections : [];
        const battlefieldRef = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
        const equipment = battlefieldRef.find((permanent: any) =>
          selectedIds.includes(String(permanent?.card?.id || '').trim())
          && String(permanent?.card?.type_line || '').toLowerCase().includes('equipment'),
        );
        const targetPermanent = battlefieldRef.find(
          (permanent: any) => permanent?.id === attachSelectedEquipmentToPermanentId,
        );
        if (equipment && targetPermanent) {
          const equipmentId = String((equipment as any).id || '').trim();
          for (const permanent of battlefieldRef) {
            const attachedEquipment = Array.isArray((permanent as any)?.attachedEquipment)
              ? (permanent as any).attachedEquipment
              : null;
            if (!attachedEquipment) continue;
            (permanent as any).attachedEquipment = attachedEquipment.filter(
              (id: any) => String(id) !== equipmentId,
            );
            if ((permanent as any).attachedEquipment.length === 0) {
              (permanent as any).isEquipped = false;
            }
          }
          (equipment as any).attachedTo = attachSelectedEquipmentToPermanentId;
          targetPermanent.attachedEquipment = Array.isArray(targetPermanent.attachedEquipment)
            ? targetPermanent.attachedEquipment
            : [];
          if (!targetPermanent.attachedEquipment.some((id: any) => String(id) === equipmentId)) {
            targetPermanent.attachedEquipment.push(equipmentId);
          }
          targetPermanent.isEquipped = true;
          try {
            await appendEvent(gameId, game.seq ?? 0, 'equipPermanent', {
              playerId: String(pid),
              equipmentId,
              targetCreatureId: attachSelectedEquipmentToPermanentId,
            });
          } catch (err) {
            debugWarn(1, '[Resolution] Failed to persist equipPermanent event for post-search Equipment attachment:', err);
          }
        }
      }

      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }
      broadcastGame(io, game, gameId);
      return { handled: true, destination };
      }

      game.state = ctx.state;
      syncAllOracleIRPlayerZonesAfterResolution(ctx);
      maybeResumeOracleIRStepsAfterResolution(ctx, step);
      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }
      broadcastGame(io, game, gameId);
      return { handled: true, destination };
    }
  return { handled: false };
}
