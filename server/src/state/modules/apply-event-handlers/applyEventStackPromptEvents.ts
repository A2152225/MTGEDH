// server/src/state/modules/apply-event-handlers/applyEventStackPromptEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Cast continuation and top-of-stack prompt resolution, miracle/mutate/optional-payment choices.
// Public entry: applyStackPromptEvents(ctx, e) -> true when it handled the event.
//
// Handles: castSpellContinuation, resolveTopOfStackPrompt, optionalTriggeredAbilityChoice, optionalPaymentPromptResolve, miraclePromptResolve, mutateCastModeChoiceResolve, mirrormindCrownTokenReplacementChoiceResolve
import type { GameContext } from "../../context";
import type { PlayerID, GameEvent } from "../../types";
import { repairAllDualZoneGhosts } from "../stackReplayUtils.js";
import { updateCounters } from "../counters_tokens";
import { resolveTopOfStack } from "../stackResolveTopOfStackUtils.js";
import { applyGraveyardPermissionEffectsFromText } from "../graveyard-permissions.js";
import {
  normalizeReplayEffectProgramMetadata,
  clearReplayQueuedSteps,
  clearReplayQueuedStepById,
  restoreMirrormindReplayTokens,
  applyRecordedLifePayment,
} from "../applyEventReplayZoneCommanderManaHelpers.js";
import {
  applyReplayHandCardMove,
  applyReplayCardUpdatesInHand,
  applyReplaySacrificedPermanent,
  consumeRecordedManaCostFromPool,
  cloneLibraryCards,
  getPlayerLibraryFromContext,
  buildLibraryFromRemainingIds,
  eventHasOwnField,
} from "../applyEventReplayCardMoveLibraryHelpers.js";
import { debug, debugWarn } from "../../../utils/debug.js";
import { markEchoPaid, sacrificePermanent } from "../upkeep-triggers";
import { replayCumulativeUpkeepChoice } from "../cumulativeUpkeepPayment.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../resolution/index.js";
import { applyEffectProgramChoiceBindingOnReplay } from "../../effects/effectProgramReplayRestore.js";
import { ensureDeferredOracleIrStackItem } from "../oracleIrDeferredStackFinalize.js";
import { replayEnsureAsEntersPermanentFromPromptSteps } from "../replay-prompt-cleanup.js";
import { resolvePromptZoneHandRestore } from "../promptZoneHandSnapshot.js";

export function applyStackPromptEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "castSpellContinuation": {
        const playerId = String((e as any).playerId || '').trim();
        const cardId = String((e as any).cardId || '').trim();

        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          clearReplayQueuedStepById(replayGameId, String((e as any).resolvedStepId || '').trim());

          const rawQueuedStep = (e as any).queuedResolutionStep;
          const rawQueuedSteps = Array.isArray((e as any).queuedResolutionSteps)
            ? ((e as any).queuedResolutionSteps as any[]).filter((step) => step && typeof step === 'object' && !Array.isArray(step))
            : [];
          const pendingSpellCast = (e as any).pendingSpellCast;
          const pendingEffectId = String((e as any).effectId || (pendingSpellCast as any)?.effectId || '').trim();
          const queuedStepsToReplayRaw = rawQueuedSteps.length > 0
            ? rawQueuedSteps
            : (rawQueuedStep && typeof rawQueuedStep === 'object' && !Array.isArray(rawQueuedStep) ? [rawQueuedStep] : []);
          const effectProgramMetadata = normalizeReplayEffectProgramMetadata((e as any).effectProgram);
          const queuedStepsToReplay = queuedStepsToReplayRaw.map((queuedStep) => (
            effectProgramMetadata
              ? {
                  ...(queuedStep as any),
                  effectProgramPrompt: true,
                  ...effectProgramMetadata,
                }
              : queuedStep
          ));
          const hasQueuedStepsToReplay = replayGameId
            && queuedStepsToReplay.length > 0
            && queuedStepsToReplay.every((step: any) => String(step?.type || '').trim().length > 0);
          if (hasQueuedStepsToReplay) {
            if (pendingEffectId && pendingSpellCast && typeof pendingSpellCast === 'object' && !Array.isArray(pendingSpellCast)) {
              const stateAny = ctx.state as any;
              stateAny.pendingSpellCasts = stateAny.pendingSpellCasts || {};
              stateAny.pendingSpellCasts[pendingEffectId] = { ...(pendingSpellCast as any) };
            }

            const queue = ResolutionQueueManager.getQueue(replayGameId) as any;
            for (const queuedStep of queuedStepsToReplay) {
              const queuedStepType = String((queuedStep as any)?.type || '').trim();
              const queuedStepId = String((queuedStep as any)?.id || '').trim();
              const alreadyPresent = Boolean(
                (queue?.activeStep && String((queue.activeStep as any)?.id || '') === queuedStepId) ||
                (Array.isArray(queue?.steps) && queue.steps.some((step: any) => String((step as any)?.id || '') === queuedStepId))
              );

              if (!alreadyPresent) {
                ResolutionQueueManager.addStep(replayGameId, {
                  ...(queuedStep as any),
                  ...(queuedStepId ? { id: queuedStepId } : {}),
                  type: queuedStepType as any,
                  playerId: String((queuedStep as any).playerId || playerId || '') as any,
                  description: String((queuedStep as any).description || ''),
                  mandatory: (queuedStep as any).mandatory !== false,
                } as any, { allowDuringReplay: true, skipEmit: true });
              }
            }

            ctx.bumpSeq();
            break;
          }

          if (playerId && (e as any).lifePaid != null) {
            applyRecordedLifePayment(ctx, playerId, (e as any).lifePaid);
          }

          const moveHandCards = Array.isArray((e as any).moveHandCards) ? (e as any).moveHandCards : [];
          for (const moveSpec of moveHandCards) {
            applyReplayHandCardMove(ctx, playerId, moveSpec);
          }

          if (playerId && cardId && (e as any).cardUpdates && typeof (e as any).cardUpdates === 'object') {
            applyReplayCardUpdatesInHand(ctx, playerId, cardId, (e as any).cardUpdates);
          }

          const sacrificedPermanentIds = Array.isArray((e as any).sacrificedPermanentIds)
            ? (e as any).sacrificedPermanentIds
            : (Array.isArray((e as any).sacrificedPermanents) ? (e as any).sacrificedPermanents : []);
          // Additional-cost sacrifices are deferred until castSpell commits. Store the
          // selection on the card for the later cast; do not sac here or a cancelled /
          // aborted cast leaves the permanent dead while the spell remains in hand.
          if ((e as any).deferAdditionalCostSacrifice === true && playerId && cardId) {
            const pendingIds = sacrificedPermanentIds.map((id: any) => String(id || '').trim()).filter(Boolean);
            applyReplayCardUpdatesInHand(ctx, playerId, cardId, {
              pendingAdditionalCostSacrificeIds: pendingIds,
              additionalCostPaid: true,
            });
          } else {
            for (const permanentId of sacrificedPermanentIds) {
              applyReplaySacrificedPermanent(ctx, String(permanentId || ''));
            }
          }

          const removedCountersForCost = Array.isArray((e as any).removedCountersForCost) ? (e as any).removedCountersForCost : [];
          for (const entry of removedCountersForCost) {
            const permanentId = String(entry?.permanentId || '').trim();
            const counterType = String(entry?.counterType || '').trim();
            const count = Number(entry?.count || 0);
            if (!permanentId || !counterType || !Number.isFinite(count) || count <= 0) continue;
            updateCounters(ctx as any, permanentId, { [counterType]: -count });
          }

          const revealedCardIdsForCost = Array.isArray((e as any).revealedCardIdsForCost)
            ? (e as any).revealedCardIdsForCost.map((id: any) => String(id || '').trim()).filter(Boolean)
            : [];
          if (playerId && cardId && revealedCardIdsForCost.length > 0) {
            const stateAny = ctx.state as any;
            stateAny.revealedCardIdsForCostBySpell = stateAny.revealedCardIdsForCostBySpell || {};
            stateAny.revealedCardIdsForCostBySpell[cardId] = revealedCardIdsForCost;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(castSpellContinuation): failed', err);
        }
        break;
      }

      case "resolveTopOfStackPrompt": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          let stateMutated = false;
          const rawQueuedStep = (e as any).queuedResolutionStep;
          const rawQueuedSteps = Array.isArray((e as any).queuedResolutionSteps)
            ? ((e as any).queuedResolutionSteps as any[]).filter((step) => step && typeof step === 'object' && !Array.isArray(step))
            : [];
          const queuedStepsToReplayRaw = rawQueuedSteps.length > 0
            ? rawQueuedSteps
            : (rawQueuedStep && typeof rawQueuedStep === 'object' && !Array.isArray(rawQueuedStep) ? [rawQueuedStep] : []);
          const effectProgramMetadata = normalizeReplayEffectProgramMetadata((e as any).effectProgram);
          const queuedStepsToReplay = queuedStepsToReplayRaw.map((queuedStep) => (
            effectProgramMetadata
              ? {
                  ...(queuedStep as any),
                  effectProgramPrompt: true,
                  ...effectProgramMetadata,
                }
              : queuedStep
          ));

          for (const queuedStep of queuedStepsToReplay) {
            const stepPlayerId = String((queuedStep as any)?.playerId || playerId || '').trim();
            // Prefer zoneHandSnapshot (full cards). Never restore ChoiceOption `hand` stubs.
            const handSnapshot = resolvePromptZoneHandRestore(queuedStep);
            if (stepPlayerId && handSnapshot) {
              const stateAny = ctx.state as any;
              const zones = stateAny.zones = stateAny.zones || {};
              const z = zones[stepPlayerId] = zones[stepPlayerId] || {};
              z.hand = handSnapshot.map((card: any) => ({ ...card, zone: 'hand' }));
              z.handCount = z.hand.length;
              // Prompt hand snapshots can predate a sacrifice/fetch. After undo/replay,
              // strip any restored hand cards that already live in GY/exile/BF.
              const repaired = repairAllDualZoneGhosts(ctx);
              if (repaired > 0) {
                debug(1, `applyEvent(resolveTopOfStackPrompt): scrubbed ${repaired} dual-zone hand ghost(s) for ${stepPlayerId}`);
              }
              stateMutated = true;
            }
          }

          const deferredSourceId = String(
            (e as any).sourceId
            || (queuedStepsToReplay[0] as any)?.sourceId
            || (queuedStepsToReplay[0] as any)?.oracleIrSourceId
            || '',
          ).trim();
          const hasOracleIrQueuedChoice = queuedStepsToReplay.some(
            (step: any) => String(step?.oracleIrChoiceStepJson || step?.oracleIrResumeStepsJson || '').trim(),
          );
          if (hasOracleIrQueuedChoice) {
            ensureDeferredOracleIrStackItem(ctx, deferredSourceId || undefined);
            stateMutated = true;
          }

          const pendingCascadeEntry = (e as any).pendingCascadeEntry && typeof (e as any).pendingCascadeEntry === 'object' && !Array.isArray((e as any).pendingCascadeEntry)
            ? { ...((e as any).pendingCascadeEntry as Record<string, any>) }
            : undefined;
          const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
          const hasRemainingLibraryIdsField = eventHasOwnField(e, 'remainingLibraryIds');
          const remainingLibraryIds = Array.isArray((e as any).remainingLibraryIds)
            ? ((e as any).remainingLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
            : [];
          const shouldSyncCascadeLibrary = Boolean(
            playerId && (pendingCascadeEntry || hasLibraryAfterField || hasRemainingLibraryIdsField),
          );

          if (shouldSyncCascadeLibrary) {
            const stateAny = ctx.state as any;
            const zones = stateAny.zones = stateAny.zones || {};
            const z = zones[playerId] = zones[playerId] || {
              hand: [],
              handCount: 0,
              library: [],
              libraryCount: 0,
              graveyard: [],
              graveyardCount: 0,
              exile: [],
              exileCount: 0,
            };

            let libraryAfter: any[] | undefined;
            if (hasLibraryAfterField) {
              libraryAfter = cloneLibraryCards((e as any).libraryAfter as any[]);
            } else if (hasRemainingLibraryIdsField || pendingCascadeEntry) {
              const exiledCards = Array.isArray(pendingCascadeEntry?.exiledCards)
                ? (pendingCascadeEntry.exiledCards as any[])
                : [];
              libraryAfter = buildLibraryFromRemainingIds(
                getPlayerLibraryFromContext(ctx, playerId),
                exiledCards,
                remainingLibraryIds,
              );
            }
            if (libraryAfter) {
              z.library = cloneLibraryCards(libraryAfter);
              z.libraryCount = libraryAfter.length;
              if (ctx.libraries?.set) {
                ctx.libraries.set(playerId as any, cloneLibraryCards(libraryAfter));
              }
              stateMutated = true;
            }

            if (pendingCascadeEntry) {
              stateAny.pendingCascade = stateAny.pendingCascade || {};
              const playerQueue = Array.isArray(stateAny.pendingCascade[playerId]) ? stateAny.pendingCascade[playerId] : [];
              const normalizedEntry: any = {
                ...pendingCascadeEntry,
                hitCard: pendingCascadeEntry.hitCard && typeof pendingCascadeEntry.hitCard === 'object'
                  ? { ...(pendingCascadeEntry.hitCard as any) }
                  : pendingCascadeEntry.hitCard,
                exiledCards: Array.isArray(pendingCascadeEntry.exiledCards)
                  ? (pendingCascadeEntry.exiledCards as any[]).map((card: any) => ({ ...card }))
                  : [],
                awaiting: pendingCascadeEntry.awaiting === true,
              };

              const effectId = String(normalizedEntry.effectId || '').trim();
              const sourceCardId = String(normalizedEntry.sourceCardId || '').trim();
              const sourceName = String(normalizedEntry.sourceName || '').trim();
              const instance = Number(normalizedEntry.instance || 0);
              const existingIndex = playerQueue.findIndex((entry: any) => {
                if (!entry || typeof entry !== 'object') return false;
                if (effectId && String(entry.effectId || '').trim() === effectId) return true;
                if (sourceCardId && String(entry.sourceCardId || '').trim() === sourceCardId) {
                  return instance <= 0 || Number(entry.instance || 0) === instance;
                }
                return Boolean(sourceName) && String(entry.sourceName || '').trim() === sourceName;
              });

              if (existingIndex >= 0) {
                playerQueue[existingIndex] = normalizedEntry;
              } else {
                playerQueue.unshift(normalizedEntry);
              }

              stateAny.pendingCascade[playerId] = playerQueue;
              stateMutated = true;
            }
          }

          if (replayGameId && queuedStepsToReplay.length > 0) {
            if ((ctx as any).isReplaying) {
              replayEnsureAsEntersPermanentFromPromptSteps(
                ctx as any,
                queuedStepsToReplay,
                deferredSourceId,
              );
            }
            const queue = ResolutionQueueManager.getQueue(replayGameId) as any;
            for (const queuedStep of queuedStepsToReplay) {
              const queuedStepId = String((queuedStep as any)?.id || '').trim();
              const queuedStepType = String((queuedStep as any)?.type || '').trim();
              if (!queuedStepType) continue;

              const alreadyPresent = Boolean(
                (queue?.activeStep && String((queue.activeStep as any)?.id || '') === queuedStepId) ||
                (Array.isArray(queue?.steps) && queue.steps.some((step: any) => String((step as any)?.id || '') === queuedStepId))
              );

              if (!alreadyPresent) {
                ResolutionQueueManager.addStep(replayGameId, {
                  ...(queuedStep as any),
                  ...(queuedStepId ? { id: queuedStepId } : {}),
                  type: queuedStepType as any,
                  playerId: String((queuedStep as any).playerId || playerId || '') as any,
                  description: String((queuedStep as any).description || ''),
                  mandatory: (queuedStep as any).mandatory !== false,
                } as any, { allowDuringReplay: true, skipEmit: true });
                stateMutated = true;
              }
            }
          }

          if (stateMutated) {
            ctx.bumpSeq();
          }
        } catch (err) {
          debugWarn(1, 'applyEvent(resolveTopOfStackPrompt): failed', err);
        }
        break;
      }

      case "optionalTriggeredAbilityChoice": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const choice = String((e as any).choice || 'no').trim().toLowerCase();
          const deferredTriggeredAbilityItem = (e as any).deferredTriggeredAbilityItem;
          const sourceName = String((e as any).sourceName || 'Ability').trim() || 'Ability';
          const effectProgramMetadata = normalizeReplayEffectProgramMetadata((e as any).effectProgram);

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              if (effectProgramMetadata?.effectProgramId) {
                return (
                  (step as any)?.effectProgramPrompt === true &&
                  String((step as any)?.effectProgramId || '').trim() === effectProgramMetadata.effectProgramId
                );
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.optionalTriggeredAbilityPrompt === true &&
                sourceId.length > 0 &&
                String((step as any)?.sourceId || '').trim() === sourceId
              );
            });
          }

          if (choice !== 'yes') {
            ctx.bumpSeq();
            break;
          }

          const choiceBinding = (e as any).choiceBinding;
          if (
            !deferredTriggeredAbilityItem
            && effectProgramMetadata
            && choiceBinding
            && typeof choiceBinding === 'object'
          ) {
            applyEffectProgramChoiceBindingOnReplay(ctx, replayGameId, {
              playerId: String((e as any).playerId || '').trim(),
              sourceId,
              sourceName,
              resolvedStepId,
              effectProgram: effectProgramMetadata as any,
              choiceBinding,
              deferredTriggeredAbilityItem,
            }, { queuePendingChoices: false });
            ctx.bumpSeq();
            break;
          }

          if (!deferredTriggeredAbilityItem || typeof deferredTriggeredAbilityItem !== 'object') {
            debugWarn(1, `applyEvent(optionalTriggeredAbilityChoice): missing deferred trigger payload for ${sourceName}`);
            break;
          }

          const directEffectText = String(
            (deferredTriggeredAbilityItem as any)?.effect
            || (deferredTriggeredAbilityItem as any)?.description
            || ''
          ).trim();
          const controllerId = String((deferredTriggeredAbilityItem as any)?.controller || (e as any)?.playerId || '').trim();
          // Temporarily restore the stored turn number so the graveyard permission
          // marker is set to the correct turn (important for replay-from-scratch).
          const eventTurnNumber = Number((e as any).turnNumber || 0);
          const prevTurnNumber = Number((ctx.state as any).turnNumber ?? (ctx.state as any).turn ?? 0) || 0;
          const prevTurnPlayer = String((ctx.state as any).turnPlayer || '').trim();
          // Temporarily restore turn context so graveyard permission checks (e.g. "it's your turn")
          // see the correct values from when the event was originally applied.
          if (eventTurnNumber > 0 && eventTurnNumber !== prevTurnNumber) {
            (ctx.state as any).turnNumber = eventTurnNumber;
            (ctx.state as any).turn = eventTurnNumber;
          }
          if (controllerId && (!prevTurnPlayer || prevTurnPlayer !== controllerId)) {
            (ctx.state as any).turnPlayer = controllerId;
          }
          if (
            controllerId &&
            applyGraveyardPermissionEffectsFromText(
              ctx as any,
              controllerId as PlayerID,
              sourceName,
              directEffectText,
              deferredTriggeredAbilityItem,
            ) > 0
          ) {
            // Restore original turn context after setting the permission
            if (eventTurnNumber > 0 && eventTurnNumber !== prevTurnNumber) {
              (ctx.state as any).turnNumber = prevTurnNumber || undefined;
              (ctx.state as any).turn = prevTurnNumber || undefined;
            }
            if (controllerId && (!prevTurnPlayer || prevTurnPlayer !== controllerId)) {
              (ctx.state as any).turnPlayer = prevTurnPlayer || '';
            }
            ctx.bumpSeq();
            break;
          }
          if (eventTurnNumber > 0 && eventTurnNumber !== prevTurnNumber) {
            (ctx.state as any).turnNumber = prevTurnNumber || undefined;
            (ctx.state as any).turn = prevTurnNumber || undefined;
          }
          if (controllerId && (!prevTurnPlayer || prevTurnPlayer !== controllerId)) {
            (ctx.state as any).turnPlayer = prevTurnPlayer || '';
          }

          // Full event-log replay must not live-resolve the deferred trigger.
          // Live resolveTopOfStack re-runs ETB/cast side effects (Altar of the Brood,
          // Aura Shards, token factories, etc.) which push *new* triggers that are
          // not balanced by later resolveTopOfStack events — leaving 10–20+ orphans
          // after restart even though the player's yes/no was already persisted.
          // Outcomes for the accepted ability live in subsequent mutation events.
          if ((ctx as any).isReplaying) {
            ctx.bumpSeq();
            break;
          }

          ctx.state.stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
          (ctx.state.stack as any[]).push({
            ...(deferredTriggeredAbilityItem as any),
            optionalTriggeredAbilityDecisionApplied: true,
          });

          resolveTopOfStack(ctx as any);
        } catch (err) {
          debugWarn(1, 'applyEvent(optionalTriggeredAbilityChoice): failed', err);
        }
        break;
      }

      case "optionalPaymentPromptResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const choiceId = String((e as any).choiceId || '').trim().toLowerCase();
          const paid = choiceId.startsWith('pay');
          const echoChoice = (e as any).echoChoice === true;

          if (paid) {
            const playerId = String((e as any).playerId || '').trim();
            const stateAny = ctx.state as any;
            const validationKind = String((e as any).optionalPaymentValidationKind || '').trim().toLowerCase();
            const energyCost = Number((e as any).energyCost || 0);
            const manaCost = String((e as any).manaCost || '').trim();
            if (playerId && energyCost > 0) {
              stateAny.energy = stateAny.energy || {};
              const currentEnergy = Number(stateAny.energy[playerId] || 0);
              stateAny.energy[playerId] = Math.max(0, currentEnergy - energyCost);
              stateAny.energyCount = stateAny.energyCount || {};
              stateAny.energyCount[playerId] = stateAny.energy[playerId];
            } else if (playerId && validationKind === 'mana' && manaCost) {
              stateAny.manaPool = stateAny.manaPool || {};
              stateAny.manaPool[playerId] = stateAny.manaPool[playerId] || { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
              consumeRecordedManaCostFromPool(stateAny.manaPool[playerId], manaCost);
            }

            if (echoChoice && sourceId) {
              markEchoPaid({ ...(ctx as any), zones: ctx.state?.zones } as any, sourceId);
            }
          }
          if ((e as any).cumulativeUpkeepChoice === true) {
            replayCumulativeUpkeepChoice(ctx as any, e, paid);
          } else if (!paid && echoChoice && sourceId) {
            const playerId = String((e as any).playerId || '').trim();
            if (playerId) {
              sacrificePermanent({ ...(ctx as any), zones: ctx.state?.zones } as any, sourceId, playerId);
            }
          }

          if (replayGameId) {
            const effectProgramMetadata = normalizeReplayEffectProgramMetadata((e as any).effectProgram);
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              if (effectProgramMetadata?.effectProgramId) {
                return (
                  (step as any)?.effectProgramPrompt === true &&
                  String((step as any)?.effectProgramId || '').trim() === effectProgramMetadata.effectProgramId
                );
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.optionalPaymentPrompt === true &&
                sourceId.length > 0 &&
                String((step as any)?.sourceId || '').trim() === sourceId
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(optionalPaymentPromptResolve): failed', err);
        }
        break;
      }

      case "miraclePromptResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const sourceId = String((e as any).sourceId || (e as any).miracleCardId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const accepted = (e as any).accepted === true || String((e as any).choiceId || '').trim() === 'cast_miracle';

          if (!accepted && playerId && sourceId) {
            const zones = (ctx.state as any)?.zones?.[playerId];
            const hand: any[] = Array.isArray(zones?.hand) ? zones.hand : [];
            const card = hand.find((entry: any) => entry && String(entry.id || '') === sourceId);
            if (card) {
              delete (card as any).isFirstDrawnThisTurn;
              delete (card as any).drawnAt;
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
                (step as any)?.miraclePrompt === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                sourceId.length > 0 &&
                String((step as any)?.miracleCardId || (step as any)?.sourceId || '').trim() === sourceId
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(miraclePromptResolve): failed', err);
        }
        break;
      }

      case "mutateCastModeChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const sourceId = String((e as any).sourceId || (e as any).mutateCardId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.mutateCastModeChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                sourceId.length > 0 &&
                String((step as any)?.mutateCardId || (step as any)?.sourceId || '').trim() === sourceId
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(mutateCastModeChoiceResolve): failed', err);
        }
        break;
      }

      case "mirrormindCrownTokenReplacementChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const sourceId = String((e as any).sourceId || (e as any).mirrormindCrownEquipmentId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.mirrormindCrownTokenReplacementChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                (!sourceId || String((step as any)?.mirrormindCrownEquipmentId || (step as any)?.sourceId || '').trim() === sourceId)
              );
            });
          }

          restoreMirrormindReplayTokens(ctx as any, e as any);
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(mirrormindCrownTokenReplacementChoiceResolve): failed', err);
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
