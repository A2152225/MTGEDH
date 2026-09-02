// server/src/state/modules/apply-event-handlers/applyEventChoicePromptEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Generic look-at/choose prompts: mana colors, hand-to-library, equipment attach, discard plans, pile splits.
// Public entry: applyChoicePromptEvents(ctx, e) -> true when it handled the event.
//
// Handles: choosePlayerForLookedAtCardsChoiceResolve, payManaToLookAndChooseCardChoiceResolve, chooseManaColorsChoiceResolve, moveChosenHandCardToLibraryChoiceResolve, attachEquipmentToPermanentChoiceResolve, chooseDiscardPlanChoiceResolve, choosePlayerForTwoPileSplitChoiceResolve, forceOfWillExileChoiceResolve, chooseLookedAtCardsDestinationResolve
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { clearReplayQueuedSteps, addReplayQueuedStepIfMissing } from "../applyEventReplayZoneCommanderManaHelpers.js";
import { pickMutablePlayerLibrary, writePlayerLibrary } from "../applyEventReplayCardMoveLibraryHelpers.js";
import { debugWarn } from "../../../utils/debug.js";
import { ResolutionStepType } from "../../resolution/index.js";
import { addRestrictedManaToPool, getOrInitManaPool } from "../../../socket/util.js";

export function applyChoicePromptEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "choosePlayerForLookedAtCardsChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const controllerId = String((e as any).controllerId || playerId).trim() || playerId;
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const chosenPlayerId = String((e as any).chosenPlayerId || '').trim();
          const rawQueuedStep = (e as any).queuedResolutionStep;

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.choosePlayerForLookedAtCardsChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                (!sourceId || String((step as any)?.sourceId || '').trim() === sourceId) &&
                (!sourceName || String((step as any)?.sourceName || '').trim() === sourceName)
              );
            });

            addReplayQueuedStepIfMissing(replayGameId, rawQueuedStep, {
              playerId: chosenPlayerId || playerId || controllerId,
              description: `${sourceName || 'Ability'}: Choose a card`,
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(choosePlayerForLookedAtCardsChoiceResolve): failed', err);
        }
        break;
      }

      case "payManaToLookAndChooseCardChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const controllerId = String((e as any).controllerId || playerId).trim() || playerId;
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const rawQueuedStep = (e as any).queuedResolutionStep;
          const paymentManaDelta = (e as any).paymentManaDelta;

          if (controllerId && paymentManaDelta && typeof paymentManaDelta === 'object' && !Array.isArray(paymentManaDelta)) {
            const pool = getOrInitManaPool(ctx.state as any, controllerId as any) as any;
            for (const [poolKey, rawAmount] of Object.entries(paymentManaDelta as Record<string, unknown>)) {
              const amount = Number(rawAmount || 0);
              if (!Number.isFinite(amount) || amount === 0) continue;
              pool[poolKey] = Number(pool[poolKey] || 0) + amount;
            }
          }

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.payManaToLookAndChooseCardChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                (!sourceId || String((step as any)?.sourceId || '').trim() === sourceId) &&
                (!sourceName || String((step as any)?.sourceName || '').trim() === sourceName)
              );
            });

            addReplayQueuedStepIfMissing(replayGameId, rawQueuedStep, {
              playerId: controllerId || playerId,
              description: `${sourceName || 'Ability'}: Choose a card`,
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(payManaToLookAndChooseCardChoiceResolve): failed', err);
        }
        break;
      }

      case "chooseManaColorsChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const controllerId = String((e as any).controllerId || playerId).trim() || playerId;
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const restriction = (e as any).restriction || 'unrestricted';
          const amountPerSelection = Math.max(1, Number((e as any).amountPerSelection || 1));
          const rawQueuedStep = (e as any).queuedResolutionStep;

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.chooseManaColorsChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                (!sourceId || String((step as any)?.chooseManaColorsSourceId || (step as any)?.sourceId || '').trim() === sourceId) &&
                (!sourceName || String((step as any)?.chooseManaColorsSourceName || (step as any)?.sourceName || '').trim() === sourceName)
              );
            });

            addReplayQueuedStepIfMissing(replayGameId, rawQueuedStep, {
              playerId: controllerId || playerId,
              description: `${sourceName || 'Ability'}: Choose a color`,
            });
          }

          if (!rawQueuedStep && controllerId) {
            const isUnrestricted = restriction === 'unrestricted' || restriction === 'none' || restriction === null || restriction === undefined;
            const rawManaAdded = (e as any).manaAdded;
            const manaAdded = rawManaAdded && typeof rawManaAdded === 'object' && !Array.isArray(rawManaAdded)
              ? Object.entries(rawManaAdded as Record<string, unknown>)
                  .reduce((acc: Record<string, number>, [color, rawAmount]) => {
                    const amount = Number(rawAmount || 0);
                    if (Number.isFinite(amount) && amount > 0) acc[String(color).toLowerCase()] = amount;
                    return acc;
                  }, {})
              : (Array.isArray((e as any).chosenColors) ? ((e as any).chosenColors as any[]) : [])
                  .map((color: any) => String(color || '').toLowerCase())
                  .filter((color: string) => ['white', 'blue', 'black', 'red', 'green'].includes(color))
                  .reduce((acc: Record<string, number>, color: string) => {
                    acc[color] = Number(acc[color] || 0) + amountPerSelection;
                    return acc;
                  }, {});

            if (isUnrestricted) {
              const pool = getOrInitManaPool(ctx.state as any, controllerId as any) as any;
              for (const [color, amount] of Object.entries(manaAdded)) {
                pool[color] = Number(pool[color] || 0) + Number(amount || 0);
              }
            } else {
              for (const [color, amount] of Object.entries(manaAdded)) {
                addRestrictedManaToPool(ctx.state as any, controllerId, color as any, Number(amount || 0), restriction, undefined, sourceId || undefined, sourceName || undefined);
              }
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(chooseManaColorsChoiceResolve): failed', err);
        }
        break;
      }

      case "moveChosenHandCardToLibraryChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const controllerId = String((e as any).controllerId || playerId).trim() || playerId;
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const chosenCardId = String((e as any).chosenCardId || '').trim();
          const position = String((e as any).position || 'top').toLowerCase() === 'bottom' ? 'bottom' : 'top';

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.moveChosenHandCardToLibraryChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                (!sourceId || String((step as any)?.sourceId || '').trim() === sourceId) &&
                (!sourceName || String((step as any)?.moveChosenHandCardToLibrarySourceName || (step as any)?.sourceName || '').trim() === sourceName)
              );
            });
          }

          if (controllerId && chosenCardId) {
            const stateAny = ctx.state as any;
            const zones = (stateAny.zones = stateAny.zones || {});
            const zone = (zones[controllerId] = zones[controllerId] || { hand: [], handCount: 0, library: [], libraryCount: 0 });
            zone.hand = Array.isArray(zone.hand) ? zone.hand : [];

            const library = pickMutablePlayerLibrary(ctx, controllerId);
            const handIndex = (zone.hand as any[]).findIndex((card: any) => String(card?.id || '') === chosenCardId);
            let movedCard = handIndex >= 0
              ? (zone.hand as any[]).splice(handIndex, 1)[0]
              : undefined;

            if (!movedCard && (e as any).movedCardSnapshot && typeof (e as any).movedCardSnapshot === 'object') {
              const alreadyInLibrary = (library as any[]).some((card: any) => String(card?.id || '') === chosenCardId);
              if (!alreadyInLibrary) {
                movedCard = { ...((e as any).movedCardSnapshot as any) };
              }
            }

            if (movedCard) {
              const libraryCard = { ...movedCard, zone: 'library' };
              if (position === 'bottom') {
                (library as any[]).push(libraryCard);
              } else {
                (library as any[]).unshift(libraryCard);
              }
            }

            zone.handCount = (zone.hand as any[]).length;
            writePlayerLibrary(ctx, controllerId, library);
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(moveChosenHandCardToLibraryChoiceResolve): failed', err);
        }
        break;
      }

      case "attachEquipmentToPermanentChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const controllerId = String((e as any).controllerId || playerId).trim() || playerId;
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const targetPermanentId = String((e as any).targetPermanentId || '').trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.attachEquipmentToPermanentChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId || String((step as any)?.playerId || '').trim() === controllerId) &&
                (!sourceId || String((step as any)?.sourceId || '').trim() === sourceId || String((step as any)?.attachEquipmentToPermanentTargetPermanentId || '').trim() === sourceId) &&
                (!targetPermanentId || String((step as any)?.attachEquipmentToPermanentTargetPermanentId || '').trim() === targetPermanentId) &&
                (!sourceName || String((step as any)?.attachEquipmentToPermanentSourceName || (step as any)?.sourceName || '').trim() === sourceName)
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(attachEquipmentToPermanentChoiceResolve): failed', err);
        }
        break;
      }

      case "chooseDiscardPlanChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const controllerId = String((e as any).controllerId || playerId).trim() || playerId;
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const preferredOptionId = String((e as any).preferredOptionId || '').trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.chooseDiscardPlanChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId || String((step as any)?.playerId || '').trim() === controllerId) &&
                (!sourceId || String((step as any)?.sourceId || '').trim() === sourceId) &&
                (!sourceName || String((step as any)?.chooseDiscardPlanSourceName || (step as any)?.sourceName || '').trim() === sourceName) &&
                (!preferredOptionId || String((step as any)?.chooseDiscardPlanPreferredOptionId || '').trim() === preferredOptionId)
              );
            });

            addReplayQueuedStepIfMissing(replayGameId, (e as any).queuedResolutionStep, {
              playerId: controllerId,
              description: `${sourceName || 'Ability'}: Discard cards`,
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(chooseDiscardPlanChoiceResolve): failed', err);
        }
        break;
      }

      case "choosePlayerForTwoPileSplitChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const controllerId = String((e as any).controllerId || playerId).trim() || playerId;
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const chosenOpponentId = String((e as any).chosenOpponentId || '').trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.choosePlayerForTwoPileSplitChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId || String((step as any)?.playerId || '').trim() === controllerId) &&
                (!sourceId || String((step as any)?.sourceId || '').trim() === sourceId) &&
                (!sourceName || String((step as any)?.choosePlayerForTwoPileSplitSourceName || (step as any)?.sourceName || '').trim() === sourceName)
              );
            });

            addReplayQueuedStepIfMissing(replayGameId, (e as any).queuedResolutionStep, {
              playerId: chosenOpponentId,
              description: `${sourceName || 'Ability'}: Separate the items into two piles`,
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(choosePlayerForTwoPileSplitChoiceResolve): failed', err);
        }
        break;
      }

      case "forceOfWillExileChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || (e as any).spellName || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const spellCardId = String((e as any).spellCardId || sourceId).trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.forceOfWillExileChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                (!spellCardId || String((step as any)?.forceSpellCardId || (step as any)?.sourceId || '').trim() === spellCardId) &&
                (!sourceName || String((step as any)?.forceSpellName || (step as any)?.sourceName || '').trim() === sourceName)
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(forceOfWillExileChoiceResolve): failed', err);
        }
        break;
      }

      case "chooseLookedAtCardsDestinationResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const controllerId = String((e as any).controllerId || playerId).trim() || playerId;
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const chosenCardId = String((e as any).chosenCardId || '').trim();
          const topCardIds = Array.isArray((e as any).topCardIds)
            ? (e as any).topCardIds.map((id: any) => String(id || '').trim()).filter(Boolean)
            : [];
          const chosenZone = String((e as any).chosenZone || '').trim().toLowerCase();
          const otherZone = String((e as any).otherZone || '').trim().toLowerCase();
          const chosenCardSnapshot = (e as any).chosenCard && typeof (e as any).chosenCard === 'object' && !Array.isArray((e as any).chosenCard)
            ? { ...((e as any).chosenCard as Record<string, any>) }
            : undefined;
          const otherCardSnapshots = Array.isArray((e as any).otherCards)
            ? (e as any).otherCards.filter((card: any) => card && typeof card === 'object' && !Array.isArray(card)).map((card: any) => ({ ...card }))
            : [];
          const otherCardPatch = (e as any).otherCardPatch && typeof (e as any).otherCardPatch === 'object' && !Array.isArray((e as any).otherCardPatch)
            ? { ...((e as any).otherCardPatch as Record<string, any>) }
            : undefined;

          if (!controllerId || !chosenCardId || !chosenZone || !otherZone) {
            break;
          }

          const zones = (ctx.state as any).zones = (ctx.state as any).zones || {};
          const z = (zones[controllerId] = zones[controllerId] || {
            library: [],
            libraryCount: 0,
            hand: [],
            handCount: 0,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          });

          const lib: any[] = pickMutablePlayerLibrary(ctx, controllerId);
          const hand: any[] = Array.isArray(z.hand) ? z.hand : (z.hand = []);
          const graveyard: any[] = Array.isArray(z.graveyard) ? z.graveyard : (z.graveyard = []);
          const exile: any[] = Array.isArray(z.exile) ? z.exile : (z.exile = []);
          const idsToRemove = topCardIds.length > 0
            ? topCardIds
            : [chosenCardId, ...otherCardSnapshots.map((card: any) => String(card?.id || '').trim()).filter(Boolean)];
          const removedCards: any[] = [];

          for (const cardId of idsToRemove) {
            const cardIndex = lib.findIndex((card: any) => String(card?.id || '') === cardId);
            if (cardIndex >= 0) {
              removedCards.push(lib.splice(cardIndex, 1)[0]);
            }
          }

          const removedById = new Map(removedCards.map((card: any) => [String(card?.id || ''), card]));
          const chosenCard = removedById.get(chosenCardId) || chosenCardSnapshot || { id: chosenCardId };
          const otherCards = otherCardSnapshots.length > 0
            ? otherCardSnapshots.map((card: any) => removedById.get(String(card?.id || '')) || card)
            : removedCards.filter((card: any) => String(card?.id || '') !== chosenCardId);
          const normalizeDestinationZone = (destination: string): string => (
            destination === 'top_library' || destination === 'bottom_library' ? 'library' : destination
          );
          const cloneForDestination = (card: any, destination: string): any => {
            const destinationZone = normalizeDestinationZone(destination);
            return {
              ...(card || {}),
              zone: destinationZone,
              ...(destinationZone === 'exile' && otherCardPatch ? otherCardPatch : {}),
            };
          };
          const moveCard = (card: any, destination: string) => {
            const destinationZone = normalizeDestinationZone(destination);
            const movedCard = cloneForDestination(card, destination);
            if (destinationZone === 'hand') {
              hand.push(movedCard);
            } else if (destinationZone === 'graveyard') {
              graveyard.unshift(movedCard);
            } else if (destination === 'top_library') {
              lib.unshift(movedCard);
            } else if (destination === 'bottom_library') {
              lib.push(movedCard);
            } else if (destinationZone === 'exile') {
              exile.push(movedCard);
            }
          };

          moveCard(chosenCard, chosenZone);
          for (const otherCard of otherCards) {
            moveCard(otherCard, otherZone);
          }

          writePlayerLibrary(ctx, controllerId, lib);
          z.hand = hand;
          z.graveyard = graveyard;
          z.exile = exile;
          z.handCount = hand.length;
          z.graveyardCount = graveyard.length;
          z.exileCount = exile.length;

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              const stepCardIds = Array.isArray((step as any)?.chooseLookedAtCardsDestinationTopCardIds)
                ? (step as any).chooseLookedAtCardsDestinationTopCardIds.map((id: any) => String(id || '').trim())
                : [];
              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.chooseLookedAtCardsDestinationChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                (!sourceId || String((step as any)?.sourceId || '').trim() === sourceId) &&
                (!sourceName || String((step as any)?.sourceName || '').trim() === sourceName) &&
                (stepCardIds.length === 0 || stepCardIds.includes(chosenCardId))
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(chooseLookedAtCardsDestinationResolve): failed', err);
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
