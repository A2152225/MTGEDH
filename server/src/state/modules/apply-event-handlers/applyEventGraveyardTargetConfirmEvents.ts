// server/src/state/modules/apply-event-handlers/applyEventGraveyardTargetConfirmEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Graveyard target confirmation, Forbidden Orchard targets, opponent-may-pay and additional costs.
// Public entry: applyGraveyardTargetConfirmEvents(ctx, e) -> true when it handled the event.
//
// Handles: additionalCostConfirm, confirmGraveyardTargets, confirmForbiddenOrchardTarget, opponentMayPayResolve
import type { GameContext } from "../../context";
import type { PlayerID, GameEvent } from "../../types";
import { recordCardLeftGraveyardThisTurn } from "../turn-tracking.js";
import { buildDiscardProvenanceFields } from "../graveyardEntryUtils.js";
import { movePermanentToGraveyard } from "../counters_tokens";
import { triggerETBEffectsForToken } from "../triggerEtbEntryEffects.js";
import {
  markReplayPermanentEnteredFromZone,
  applyReplayBattlefieldReturnCharacteristics,
  generateDeterministicId,
  clearReplayQueuedSteps,
} from "../applyEventReplayZoneCommanderManaHelpers.js";
import { applyOpponentMayPayResolve, pickMutablePlayerLibrary, writePlayerLibrary } from "../applyEventReplayCardMoveLibraryHelpers.js";
import { debugWarn } from "../../../utils/debug.js";
import { ResolutionStepType } from "../../resolution/index.js";
import { stampCardExiledWithSource } from "../exileWithSourceStamp.js";
import { stampPermanentEntryTimestamp } from '../../../../../rules-engine/src/permanentTimestamps.js';

export function applyGraveyardTargetConfirmEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "additionalCostConfirm": {
        // Handle additional costs (discard, sacrifice) for spell casting
        const pid = (e as any).playerId;
        const costType = (e as any).costType;
        const selectedCards = (e as any).selectedCards as string[] || [];
        
        try {
          const zones = ctx.state.zones || {};
          const z = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };
          zones[pid] = z;
          ctx.state.zones = zones;
          
          if (costType === 'discard') {
            // Move cards from hand to graveyard
            let discardedCount = 0;
            for (const cardId of selectedCards) {
              const hand = Array.isArray(z.hand) ? z.hand : [];
              const cardIndex = hand.findIndex((c: any) => c?.id === cardId);
              if (cardIndex !== -1) {
                const [card] = hand.splice(cardIndex, 1);
                z.graveyard = z.graveyard || [];
                if (card && typeof card === 'object') {
                  (z.graveyard as any[]).push({
                    ...card,
                    zone: 'graveyard',
                    ...buildDiscardProvenanceFields(ctx.state, String(pid)),
                  });
                  discardedCount++;
                }
              }
            }
            z.handCount = Array.isArray(z.hand) ? z.hand.length : 0;
            z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : 0;

            // Turn-tracking for intervening-if: a player discarded a card this turn.
            if (discardedCount > 0) {
              const stateAny = ctx.state as any;
              stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
              stateAny.discardedCardThisTurn[String(pid)] = true;
              stateAny.anyPlayerDiscardedCardThisTurn = true;
            }
          } else if (costType === 'sacrifice') {
            // Move permanents from battlefield to graveyard
            const battlefield = ctx.state.battlefield || [];
            for (const permId of selectedCards) {
              const permIndex = battlefield.findIndex((p: any) => p?.id === permId);
              if (permIndex !== -1) {
                movePermanentToGraveyard(ctx as any, String(permId), true);
              }
            }
            z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : 0;
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(additionalCostConfirm): failed", err);
        }
        break;
      }

      case "confirmGraveyardTargets": {
        // Move cards from graveyard to another zone
        const pid = (e as any).playerId;
        const selectedCardIds = (e as any).selectedCardIds as string[] || [];
        const createdPermanentIds = Array.isArray((e as any).createdPermanentIds)
          ? ((e as any).createdPermanentIds as any[]).map((value: any) => String(value || '').trim())
          : [];
        const destination = (e as any).destination;
        const targetPlayerId = String((e as any).targetPlayerId || '').trim();
        const destinationUsesSelectedCardOwner = (e as any).destinationUsesSelectedCardOwner === true;
        const battlefieldControllerMode = String((e as any).battlefieldControllerMode || '').trim().toLowerCase();
        const battlefieldControllerId = String((e as any).battlefieldControllerId || '').trim();
        const battlefieldTapped = (e as any).battlefieldTapped === true;
        const battlefieldCounters = (e as any).battlefieldCounters && typeof (e as any).battlefieldCounters === 'object'
          ? { ...((e as any).battlefieldCounters as Record<string, number>) }
          : {};
        const battlefieldFaceDown = (e as any).battlefieldFaceDown === true;
        const battlefieldTurnFaceUp = (e as any).battlefieldTurnFaceUp === true;
        const battlefieldSuspected = (e as any).battlefieldSuspected === true;
        const battlefieldSetTypeLine = String((e as any).battlefieldSetTypeLine || '').trim();
        const battlefieldSetOracleText = typeof (e as any).battlefieldSetOracleText === 'string'
          ? String((e as any).battlefieldSetOracleText)
          : undefined;
        const battlefieldLoseAllOtherTypes = (e as any).battlefieldLoseAllOtherTypes === true;
        const battlefieldGrantedTypes = Array.isArray((e as any).battlefieldGrantedTypes)
          ? ((e as any).battlefieldGrantedTypes as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
          : [];
        
        try {
          const zones = ctx.state.zones || {};
          const z = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
          zones[pid] = z;
          ctx.state.zones = zones;

          let movedAny = false;
          let movedCreatureCard: any | undefined;
          const touchedZoneOwners = new Set<string>();

          const findCardSourceOwner = (cardId: string): string | null => {
            const ownersToCheck = targetPlayerId
              ? [targetPlayerId, ...Object.keys(zones).filter((playerId) => playerId !== targetPlayerId)]
              : Object.keys(zones);
            for (const ownerId of ownersToCheck) {
              const graveyard = Array.isArray(zones[ownerId]?.graveyard) ? zones[ownerId].graveyard : [];
              if (graveyard.some((card: any) => String(card?.id || '') === String(cardId))) {
                return ownerId;
              }
            }
            return null;
          };
          
          for (const cardId of selectedCardIds) {
            const sourceOwnerId = findCardSourceOwner(cardId);
            if (!sourceOwnerId) continue;

            const sourceZones = zones[sourceOwnerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };
            zones[sourceOwnerId] = sourceZones;
            sourceZones.graveyard = Array.isArray(sourceZones.graveyard) ? sourceZones.graveyard : [];
            sourceZones.exile = Array.isArray(sourceZones.exile) ? sourceZones.exile : [];

            const graveyard = sourceZones.graveyard as any[];
            const cardIndex = graveyard.findIndex((c: any) => c?.id === cardId);
            if (cardIndex === -1) continue;
            
            const [card] = graveyard.splice(cardIndex, 1);
            movedAny = true;
            const tl = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
            if (!movedCreatureCard && tl.includes('creature')) movedCreatureCard = card;
            touchedZoneOwners.add(sourceOwnerId);
            
            switch (destination) {
              case 'hand':
                {
                  const destinationPlayerId = destinationUsesSelectedCardOwner ? sourceOwnerId : pid;
                  const destinationZones = (zones[destinationPlayerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 }) as any;
                  zones[destinationPlayerId] = destinationZones;
                  destinationZones.hand = Array.isArray(destinationZones.hand) ? destinationZones.hand : [];
                  (destinationZones.hand as any[]).push({ ...card, zone: 'hand' });
                  destinationZones.handCount = (destinationZones.hand as any[]).length;
                  touchedZoneOwners.add(destinationPlayerId);
                }
                break;
              case 'battlefield':
                {
                  ctx.state.battlefield = ctx.state.battlefield || [];
                  const typeLine = (card.type_line || '').toLowerCase();
                  const isCreature = typeLine.includes('creature');
                  const createdPermanentId = createdPermanentIds.shift() || generateDeterministicId(ctx, 'perm', cardId);
                  const controllerId = battlefieldControllerId || (battlefieldControllerMode === 'owner' ? sourceOwnerId : pid);
                  const permanent: any = battlefieldFaceDown
                    ? {
                        id: createdPermanentId,
                        controller: controllerId,
                        owner: sourceOwnerId,
                        tapped: battlefieldTapped,
                        counters: { ...battlefieldCounters },
                        basePower: 2,
                        baseToughness: 2,
                        summoningSickness: true,
                        card: {
                          name: 'Face-down Creature',
                          type_line: 'Creature',
                          zone: 'battlefield',
                          power: '2',
                          toughness: '2',
                        },
                        isFaceDown: true,
                        faceDownType: 'effect',
                        faceUpCard: { ...card, zone: 'battlefield' },
                        canTurnFaceUp: isCreature,
                      }
                    : {
                        id: createdPermanentId,
                        controller: controllerId,
                        owner: sourceOwnerId,
                        tapped: battlefieldTapped,
                        counters: { ...battlefieldCounters },
                        basePower: isCreature ? parseInt(card.power || '0', 10) : undefined,
                        baseToughness: isCreature ? parseInt(card.toughness || '0', 10) : undefined,
                        summoningSickness: isCreature,
                        card: { ...card, zone: 'battlefield' },
                      };
                  if (battlefieldSuspected) {
                    permanent.suspected = true;
                    permanent.isSuspected = true;
                    permanent.card = { ...(permanent.card || {}), suspected: true, isSuspected: true };
                  }
                  if (battlefieldTurnFaceUp && permanent.isFaceDown === true && permanent.faceUpCard) {
                    const actualCard = { ...(permanent.faceUpCard as any), zone: 'battlefield' };
                    const actualTypeLine = String(actualCard?.type_line || '').toLowerCase();
                    const actualIsCreature = actualTypeLine.includes('creature');
                    permanent.isFaceDown = false;
                    permanent.card = actualCard;
                    if (actualIsCreature) {
                      permanent.basePower = parseInt(actualCard.power || '0', 10);
                      permanent.baseToughness = parseInt(actualCard.toughness || '0', 10);
                      permanent.summoningSickness = true;
                    } else {
                      delete permanent.basePower;
                      delete permanent.baseToughness;
                      delete permanent.summoningSickness;
                    }
                    delete permanent.faceDownType;
                    delete permanent.faceUpCard;
                    delete permanent.canTurnFaceUp;
                  }
                  applyReplayBattlefieldReturnCharacteristics(permanent, {
                    battlefieldSetTypeLine,
                    battlefieldSetOracleText,
                    battlefieldLoseAllOtherTypes,
                    battlefieldGrantedTypes,
                  });
                  markReplayPermanentEnteredFromZone(permanent, 'graveyard');
                  ctx.state.battlefield.push(permanent as any);
                  stampPermanentEntryTimestamp(ctx.state, ctx.state.battlefield[ctx.state.battlefield.length - 1]);
                }
                break;
              case 'library_top':
                {
                  const destinationPlayerId = destinationUsesSelectedCardOwner ? sourceOwnerId : pid;
                  const lib = pickMutablePlayerLibrary(ctx, destinationPlayerId);
                  lib.unshift({ ...card, zone: 'library' });
                  writePlayerLibrary(ctx, destinationPlayerId, lib);
                  touchedZoneOwners.add(destinationPlayerId);
                }
                break;
              case 'library_bottom':
                {
                  const destinationPlayerId = destinationUsesSelectedCardOwner ? sourceOwnerId : pid;
                  const libBottom = pickMutablePlayerLibrary(ctx, destinationPlayerId);
                  libBottom.push({ ...card, zone: 'library' });
                  writePlayerLibrary(ctx, destinationPlayerId, libBottom);
                  touchedZoneOwners.add(destinationPlayerId);
                }
                break;
              case 'exile':
                (sourceZones.exile as any[]).push(
                  stampCardExiledWithSource(card, (e as any).exiledWithSourceId),
                );
                sourceZones.exileCount = (sourceZones.exile as any[]).length;
                break;
            }
          }

          for (const ownerId of touchedZoneOwners) {
            const ownerZones = (zones[ownerId] || {}) as any;
            ownerZones.graveyard = Array.isArray(ownerZones.graveyard) ? ownerZones.graveyard : [];
            ownerZones.hand = Array.isArray(ownerZones.hand) ? ownerZones.hand : [];
            ownerZones.exile = Array.isArray(ownerZones.exile) ? ownerZones.exile : [];
            ownerZones.library = Array.isArray(ownerZones.library) && ownerZones.library.length > 0
              ? ownerZones.library
              : pickMutablePlayerLibrary(ctx, ownerId);
            ownerZones.graveyardCount = ownerZones.graveyard.length;
            ownerZones.handCount = ownerZones.hand.length;
            ownerZones.exileCount = ownerZones.exile.length;
            ownerZones.libraryCount = ownerZones.library.length;
          }

          // Turn-tracking for intervening-if: a card left your graveyard this turn.
          if (movedAny) {
            try {
              recordCardLeftGraveyardThisTurn(ctx as any, String(targetPlayerId || pid), movedCreatureCard);

              const stateAny = ctx.state as any;

              // Turn-tracking for intervening-if: evidence was collected this turn.
              // Only set true on explicit positive evidence from persisted events.
              const evidenceCollected = (e as any)?.evidenceCollected === true;
              const purpose = String((e as any)?.purpose || '').toLowerCase();
              if (evidenceCollected || (purpose === 'collectevidence' && String(destination).toLowerCase() === 'exile')) {
                stateAny.evidenceCollectedThisTurn = stateAny.evidenceCollectedThisTurn || {};
                stateAny.evidenceCollectedThisTurnByPlayer = stateAny.evidenceCollectedThisTurnByPlayer || {};
                stateAny.evidenceCollectedThisTurnByPlayerCounts = stateAny.evidenceCollectedThisTurnByPlayerCounts || {};
                stateAny.evidenceCollectedThisTurn[String(pid)] = true;
                stateAny.evidenceCollectedThisTurnByPlayer[String(pid)] = true;
                stateAny.evidenceCollectedThisTurnByPlayerCounts[String(pid)] = (stateAny.evidenceCollectedThisTurnByPlayerCounts[String(pid)] || 0) + 1;
              }
            } catch {
              // best-effort only
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(confirmGraveyardTargets): failed", err);
        }
        break;
      }

      case "confirmForbiddenOrchardTarget": {
        try {
          const targetOpponentId = String((e as any).targetOpponentId || '').trim();
          const permanentId = String((e as any).permanentId || 'forbidden_orchard').trim() || 'forbidden_orchard';
          if (!targetOpponentId) break;

          ctx.state.battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const tokenId = generateDeterministicId(ctx, 'token_forbidden_orchard', `${permanentId}:${targetOpponentId}`);
          const spiritToken = {
            id: tokenId,
            controller: targetOpponentId,
            owner: targetOpponentId,
            tapped: false,
            summoningSickness: true,
            counters: {},
            card: {
              id: tokenId,
              name: 'Spirit',
              type_line: 'Token Creature — Spirit',
              oracle_text: '',
              mana_cost: '',
              cmc: 0,
              colors: [],
            },
            basePower: 1,
            baseToughness: 1,
            isToken: true,
          };
          (ctx.state.battlefield as any[]).push(spiritToken);
          triggerETBEffectsForToken(ctx as any, spiritToken as any, targetOpponentId as PlayerID);

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(confirmForbiddenOrchardTarget): failed", err);
        }
        break;
      }

      case "opponentMayPayResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const playerId = String((e as any).playerId || (e as any).decidingPlayer || '').trim();
          const promptId = String((e as any).promptId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any).opponentMayPayChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                (!promptId || String((step as any)?.promptId || '').trim() === promptId)
              );
            });
          }

          applyOpponentMayPayResolve(ctx as any, e as any);
        } catch (err) {
          debugWarn(1, 'applyEvent(opponentMayPayResolve): failed', err);
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
