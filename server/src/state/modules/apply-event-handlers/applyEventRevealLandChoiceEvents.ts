// server/src/state/modules/apply-event-handlers/applyEventRevealLandChoiceEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Reveal-until-nonland casting, hideaway, and land ETB choices (shock, Mox Diamond, bounce).
// Public entry: applyRevealLandChoiceEvents(ctx, e) -> true when it handled the event.
//
// Handles: spellBottomRevealUntilNonlandResolve, castRevealedFromLibraryResolve, grantPlayableFromExileChoiceResolve, hideawayChoice, moxDiamondChoice, bounceLandChoice, landWouldEnterSacrificeChoice, shockLandChoice, revealLandChoice
import type { GameContext } from "../../context";
import type { PlayerID, GameEvent } from "../../types";
import { movePermanentToHand } from "../zones";
import { removePlayableFromExileForCard, stripPlayableFromExileTags } from "../playable-from-exile";
import { storeHideawayExiledCard } from "../hideawayExile.js";
import {
  resolveLandWouldEnterSacrificeChoice,
  resolveWouldEnterDiscardLandChoice,
} from "../land-would-enter-replacement.js";
import { buildDurablePlayableFromExilePermission, upsertDurablePermission } from "../durable-permissions.js";
import { clearReplayQueuedSteps, ensureReplayPlayerZones } from "../applyEventReplayZoneCommanderManaHelpers.js";
import {
  cloneLibraryCards,
  getPlayerLibraryFromContext,
  buildLibraryAfterCascadeResolve,
  eventHasOwnField,
} from "../applyEventReplayCardMoveLibraryHelpers.js";
import { debugWarn } from "../../../utils/debug.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../resolution/index.js";

export function applyRevealLandChoiceEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "spellBottomRevealUntilNonlandResolve": {
        const playerId = String((e as any).playerId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        const choice = String((e as any).choice || 'no').trim().toLowerCase();
        const triggeringStackItemId = String((e as any).triggeringStackItemId || '').trim();
        const spellOwnerId = String((e as any).spellOwnerId || playerId || '').trim();
        const revealPlayerId = String((e as any).revealFromLibraryPlayerId || playerId || '').trim();
        const ownerLibraryAfter = Array.isArray((e as any).ownerLibraryAfter)
          ? cloneLibraryCards((e as any).ownerLibraryAfter as any[])
          : undefined;
        const revealLibraryAfter = Array.isArray((e as any).revealLibraryAfter)
          ? cloneLibraryCards((e as any).revealLibraryAfter as any[])
          : undefined;
        const revealExileAfter = Array.isArray((e as any).revealExileAfter)
          ? ((e as any).revealExileAfter as any[]).map((card: any) => ({ ...card, zone: 'exile' }))
          : undefined;
        const rawQueuedStep = (e as any).queuedResolutionStep;

        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.spellBottomRevealUntilNonlandChoice === true &&
                triggeringStackItemId.length > 0 &&
                String((step as any)?.triggeringStackItemId || '').trim() === triggeringStackItemId
              );
            });
          }

          if (choice === 'yes') {
            if (triggeringStackItemId) {
              ctx.state.stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
              const stackIndex = (ctx.state.stack as any[]).findIndex((item: any) => String(item?.id || '') === triggeringStackItemId);
              if (stackIndex !== -1) {
                (ctx.state.stack as any[]).splice(stackIndex, 1);
              }
            }

            if (spellOwnerId && ownerLibraryAfter) {
              const ownerZones = ensureReplayPlayerZones(ctx.state as any, spellOwnerId);
              ownerZones.library = cloneLibraryCards(ownerLibraryAfter);
              ownerZones.libraryCount = ownerLibraryAfter.length;
              ctx.libraries.set(spellOwnerId as any, cloneLibraryCards(ownerLibraryAfter));
            }

            if (revealPlayerId && revealLibraryAfter) {
              const revealZones = ensureReplayPlayerZones(ctx.state as any, revealPlayerId);
              revealZones.library = cloneLibraryCards(revealLibraryAfter);
              revealZones.libraryCount = revealLibraryAfter.length;
              ctx.libraries.set(revealPlayerId as any, cloneLibraryCards(revealLibraryAfter));
            }

            if (revealPlayerId && revealExileAfter) {
              const revealZones = ensureReplayPlayerZones(ctx.state as any, revealPlayerId);
              revealZones.exile = revealExileAfter.map((card: any) => ({ ...card, zone: 'exile' }));
              revealZones.exileCount = revealExileAfter.length;
            }

            const replayGameId = String((ctx as any).gameId || '').trim();
            const queuedStepType = String((rawQueuedStep as any)?.type || '').trim();
            if (replayGameId && rawQueuedStep && typeof rawQueuedStep === 'object' && !Array.isArray(rawQueuedStep) && queuedStepType) {
              const queue = ResolutionQueueManager.getQueue(replayGameId) as any;
              const queuedStepId = String((rawQueuedStep as any)?.id || '').trim();
              const alreadyPresent = Boolean(
                (queue?.activeStep && String((queue.activeStep as any)?.id || '') === queuedStepId) ||
                (Array.isArray(queue?.steps) && queue.steps.some((step: any) => String((step as any)?.id || '') === queuedStepId))
              );

              if (!alreadyPresent) {
                ResolutionQueueManager.addStep(replayGameId, {
                  ...(rawQueuedStep as any),
                  ...(queuedStepId ? { id: queuedStepId } : {}),
                  type: queuedStepType as any,
                  playerId: String((rawQueuedStep as any).playerId || revealPlayerId || playerId || '') as any,
                  description: String((rawQueuedStep as any).description || ''),
                  mandatory: (rawQueuedStep as any).mandatory !== false,
                } as any);
              }
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(spellBottomRevealUntilNonlandResolve): failed", err);
        }
        break;
      }

      case "castRevealedFromLibraryResolve": {
        const playerId = String((e as any).playerId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        const cardId = String((e as any).cardId || '').trim();
        const remainingLibraryIds = Array.isArray((e as any).remainingLibraryIds)
          ? ((e as any).remainingLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const bottomCardIds = Array.isArray((e as any).bottomCardIds)
          ? ((e as any).bottomCardIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const bottomCards = Array.isArray((e as any).bottomCards) ? (e as any).bottomCards as any[] : [];
        const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
        const libraryAfterSnapshot = hasLibraryAfterField
          ? cloneLibraryCards((e as any).libraryAfter as any[])
          : undefined;
        const libraryAfter = libraryAfterSnapshot ?? (
          remainingLibraryIds.length > 0 || bottomCardIds.length > 0
            ? buildLibraryAfterCascadeResolve(
                getPlayerLibraryFromContext(ctx, playerId),
                bottomCards,
                remainingLibraryIds,
                bottomCardIds,
              )
            : undefined
        );
        const stackItem = (e as any).stackItem && typeof (e as any).stackItem === 'object' && !Array.isArray((e as any).stackItem)
          ? { ...(e as any).stackItem }
          : undefined;

        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.castRevealedFromLibraryChoice === true &&
                cardId.length > 0 &&
                String((step as any)?.castRevealedFromLibraryCard?.id || '').trim() === cardId
              );
            });
          }

          if (playerId && libraryAfter) {
            const playerZones = ensureReplayPlayerZones(ctx.state as any, playerId);
            playerZones.library = cloneLibraryCards(libraryAfter);
            playerZones.libraryCount = libraryAfter.length;
            ctx.libraries.set(playerId as any, cloneLibraryCards(libraryAfter));
          }

          if (stackItem) {
            ctx.state.stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
            const stackItemId = String((stackItem as any).id || '').trim();
            const alreadyPresent = stackItemId.length > 0 && (ctx.state.stack as any[]).some((item: any) => String(item?.id || '').trim() === stackItemId);
            if (!alreadyPresent) {
              (ctx.state.stack as any[]).push(stackItem as any);
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(castRevealedFromLibraryResolve): failed", err);
        }
        break;
      }

      case "shockLandChoice": {
        // Shock land enters tapped or player pays 2 life
        const pid = (e as any).playerId;
        const permId = (e as any).permanentId;
        const payLife = (e as any).payLife;
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any).shockLandChoice === true &&
                (!pid || String((step as any)?.playerId || '').trim() === String(pid || '').trim()) &&
                (!permId || String((step as any)?.permanentId || '').trim() === String(permId || '').trim())
              );
            });
          }

          if (payLife && pid && ctx.life) {
            (ctx.state as any).life = (ctx.state as any).life || {};
            (ctx as any).life = (ctx as any).life || {};
            const players = (ctx.state as any).players || [];
            const player = players.find((p: any) => String(p?.id) === String(pid));
            const startingLife = (ctx.state as any).startingLife ?? 40;
            const current = (ctx.state as any).life?.[pid] ?? (ctx as any).life?.[pid] ?? player?.life ?? startingLife;
            const next = Number(current) - 2;
            (ctx.state as any).life[pid] = next;
            (ctx as any).life[pid] = next;
            if (player) player.life = next;

            if (permId) {
              const battlefield = ctx.state.battlefield || [];
              const perm = battlefield.find((p: any) => p.id === permId);
              if (perm) {
                (perm as any).tapped = false;
              }
            }

            // Track life lost this turn.
            try {
              (ctx.state as any).lifeLostThisTurn = (ctx.state as any).lifeLostThisTurn || {};
              (ctx.state as any).lifeLostThisTurn[String(pid)] = ((ctx.state as any).lifeLostThisTurn[String(pid)] || 0) + 2;
            } catch {}
          }
          if (!payLife && permId) {
            // Land enters tapped
            const battlefield = ctx.state.battlefield || [];
            const perm = battlefield.find((p: any) => p.id === permId);
            if (perm) {
              (perm as any).tapped = true;
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(shockLandChoice): failed", err);
        }
        break;
      }

      case "revealLandChoice": {
        const pid = String((e as any).playerId || '').trim();
        const permId = String((e as any).permanentId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        const revealCardId = String((e as any).revealCardId || '').trim();

        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any).revealLandChoice === true &&
                (!pid || String((step as any)?.playerId || '').trim() === pid) &&
                (!permId || String((step as any)?.permanentId || '').trim() === permId)
              );
            });
          }

          if (!permId) break;

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const perm = battlefield.find((entry: any) => entry && String(entry.id || '') === permId);
          if (perm) {
            (perm as any).tapped = !revealCardId;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(revealLandChoice): failed', err);
        }
        break;
      }

      case "grantPlayableFromExileChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const controllerId = String((e as any).controllerId || playerId).trim() || playerId;
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || 'Ability').trim() || 'Ability';
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const chosenCardId = String((e as any).chosenCardId || (e as any).cardId || '').trim();
          const cardIds = Array.isArray((e as any).cardIds)
            ? (e as any).cardIds.map((id: any) => String(id || '').trim()).filter(Boolean)
            : [];
          const allChoiceCardIds = cardIds.length > 0 ? cardIds : (chosenCardId ? [chosenCardId] : []);
          const stateAny = ctx.state as any;
          const turnAppliedRaw = Number((e as any).turnApplied);
          const turnApplied = Number.isFinite(turnAppliedRaw) ? turnAppliedRaw : Number(stateAny.turnNumber || 0) || 0;
          const playableUntilTurnRaw = Number((e as any).playableUntilTurn);
          const playableUntilTurn = Number.isFinite(playableUntilTurnRaw) ? playableUntilTurnRaw : turnApplied;

          if (!chosenCardId || !controllerId) {
            break;
          }

          const choiceCardIdSet = new Set(allChoiceCardIds);
          const zones = stateAny.zones && typeof stateAny.zones === 'object' ? stateAny.zones : {};
          for (const zoneOwnerId of Object.keys(zones)) {
            const exileZone = Array.isArray(zones[zoneOwnerId]?.exile) ? zones[zoneOwnerId].exile : [];
            for (const exiledCard of exileZone) {
              const exiledCardId = String(exiledCard?.id || '').trim();
              if (!exiledCardId || !choiceCardIdSet.has(exiledCardId)) continue;

              removePlayableFromExileForCard(stateAny, exiledCardId);
              stripPlayableFromExileTags(exiledCard);

              if (exiledCardId === chosenCardId) {
                exiledCard.canBePlayedBy = controllerId;
                exiledCard.playableUntilTurn = playableUntilTurn;
              }
            }
          }

          stateAny.playableFromExile = stateAny.playableFromExile || {};
          const pfe = (stateAny.playableFromExile[controllerId] = stateAny.playableFromExile[controllerId] || {});
          pfe[chosenCardId] = playableUntilTurn;
          upsertDurablePermission(stateAny, buildDurablePlayableFromExilePermission({
            playerId: controllerId as PlayerID,
            cardIds: [chosenCardId],
            action: 'play',
            duration: playableUntilTurn > turnApplied ? 'until_end_of_next_turn' : 'this_turn',
            turnApplied,
            expiresAtTurn: playableUntilTurn,
            sourceName,
          }));

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              const stepCardIds = Array.isArray((step as any)?.grantPlayableFromExileCardIds)
                ? (step as any).grantPlayableFromExileCardIds.map((id: any) => String(id || '').trim())
                : [];
              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.grantPlayableFromExileChoice === true &&
                (!sourceId || String((step as any)?.sourceId || '').trim() === sourceId) &&
                (stepCardIds.length === 0 || stepCardIds.includes(chosenCardId))
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(grantPlayableFromExileChoiceResolve): failed', err);
        }
        break;
      }

      case "landWouldEnterSacrificeChoice": {
        const pid = (e as any).playerId;
        const sacrificePermanentIds = (e as any).sacrificePermanentIds;
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any).landWouldEnterSacrificeChoice === true &&
                (!pid || String((step as any)?.playerId || '').trim() === String(pid || '').trim())
              );
            });
          }

          const selectionIds = Array.isArray(sacrificePermanentIds)
            ? sacrificePermanentIds.map((id: any) => String(id)).filter(Boolean)
            : [];
          const declined = selectionIds.length === 0;

          resolveLandWouldEnterSacrificeChoice(
            ctx,
            pid as PlayerID,
            declined ? ['decline_land_would_enter'] : selectionIds,
            false,
          );
        } catch (err) {
          debugWarn(1, "applyEvent(landWouldEnterSacrificeChoice): failed", err);
        }
        break;
      }

      case "moxDiamondChoice": {
        const pid = (e as any).playerId;
        const discardLandId = (e as any).discardLandId;
        const stackItemId = String((e as any).stackItemId || '').trim();
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any).moxDiamondChoice === true &&
                (!pid || String((step as any)?.playerId || '').trim() === String(pid || '').trim()) &&
                (!stackItemId || String((step as any)?.stackItemId || (step as any)?.sourceId || '').trim() === stackItemId)
              );
            });
          }

          const choiceId = discardLandId ? String(discardLandId) : null;
          const resolved = resolveWouldEnterDiscardLandChoice(ctx, pid as PlayerID, stackItemId, choiceId, !choiceId);
          if (resolved.ok) {
            ctx.bumpSeq();
          }
        } catch (err) {
          debugWarn(1, "applyEvent(moxDiamondChoice): failed", err);
        }
        break;
      }

      case "bounceLandChoice": {
        // Bounce land: return a land to hand
        const pid = (e as any).playerId;
        const returnedLandId = (e as any).returnedLandId || (e as any).returnPermanentId;
        const destination = String((e as any).destination || 'hand').toLowerCase();
        const stackItemId = String((e as any).stackItemId || '').trim();
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === String(ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE) &&
                (!pid || String((step as any)?.playerId || '').trim() === String(pid || '').trim()) &&
                (!stackItemId || String((step as any)?.stackItemId || '').trim() === stackItemId)
              );
            });
          }

          if (returnedLandId && pid) {
            const battlefield = ctx.state.battlefield || [];
            const idx = battlefield.findIndex((p: any) => p.id === returnedLandId);
            if (idx !== -1) {
              if (destination === 'hand') {
                movePermanentToHand(ctx as any, String(returnedLandId));
              }
            }
          }

          if (stackItemId) {
            ctx.state.stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
            const stackIndex = (ctx.state.stack as any[]).findIndex((item: any) => String(item?.id || '') === stackItemId);
            if (stackIndex !== -1) {
              (ctx.state.stack as any[]).splice(stackIndex, 1);
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(bounceLandChoice): failed", err);
        }
        break;
      }

      case "hideawayChoice": {
        const pid = String((e as any).playerId || '').trim();
        const permanentId = String((e as any).permanentId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        const selectedCardId = String((e as any).selectedCardId || '').trim();
        const bottomOrderIds = Array.isArray((e as any).bottomOrderIds)
          ? (e as any).bottomOrderIds.map((id: any) => String(id || '').trim()).filter(Boolean)
          : [];
        const lookedAtCardIds = Array.isArray((e as any).lookedAtCardIds)
          ? (e as any).lookedAtCardIds.map((id: any) => String(id || '').trim()).filter(Boolean)
          : [];
        const stackItemId = String((e as any).stackItemId || '').trim();

        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === String(ResolutionStepType.HIDEAWAY_CHOICE) &&
                (!pid || String((step as any)?.playerId || '').trim() === pid) &&
                (!permanentId || String((step as any)?.permanentId || (step as any)?.sourceId || '').trim() === permanentId)
              );
            });
          }

          if (pid && permanentId && selectedCardId) {
            const library = ctx.libraries.get(pid) || [];
            const lookedAtCount = Math.min(lookedAtCardIds.length || 0, library.length);
            const topCards = library.splice(0, lookedAtCount);
            const selectedCard = topCards.find((card: any) => String(card?.id || '') === selectedCardId);
            const orderedBottomCards = bottomOrderIds
              .map((cardId: string) => topCards.find((card: any) => String(card?.id || '') === cardId))
              .filter(Boolean);
            const leftoverBottomCards = topCards.filter((card: any) => {
              const cardId = String(card?.id || '');
              return cardId && cardId !== selectedCardId && !bottomOrderIds.includes(cardId);
            });

            for (const card of [...orderedBottomCards, ...leftoverBottomCards]) {
              library.push({ ...(card as any), zone: 'library' });
            }

            ctx.libraries.set(pid, library);

            ctx.state.zones = ctx.state.zones || {};
            const z: any = ctx.state.zones[pid] || { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };
            ctx.state.zones[pid] = z;
            z.library = library.map((card: any) => ({ ...(card as any), zone: 'library' }));
            z.libraryCount = library.length;

            const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
            const permanent = battlefield.find((entry: any) => String(entry?.id || '') === permanentId) as any;
            if (permanent && selectedCard) {
              storeHideawayExiledCard({
                state: ctx.state,
                playerId: pid,
                permanent,
                selectedCard,
                sourceName: String((e as any).sourceName || permanent.card?.name || 'Hideaway'),
              });
            }
          }

          if (stackItemId) {
            ctx.state.stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
            const stackIndex = (ctx.state.stack as any[]).findIndex((item: any) => String(item?.id || '') === stackItemId);
            if (stackIndex !== -1) {
              (ctx.state.stack as any[]).splice(stackIndex, 1);
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(hideawayChoice): failed', err);
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
