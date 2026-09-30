// server/src/state/modules/apply-event-handlers/applyEventSacrificeChoiceEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Sacrifice-for-benefit choices, sacrifice-unless-pay, and reflexive sacrifice-when-you-do resolution.
// Public entry: applySacrificeChoiceEvents(ctx, e) -> true when it handled the event.
//
// Handles: sacrificeAnotherPermanentForBenefitChoiceResolve, sacrificeAnotherPermanentForBenefitResolve, sacrificeUnlessPayChoice, sacrificeWhenYouDoResolve, sacrificeSelectionResolve
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { drawCards } from "../zones";
import { movePermanentToGraveyard } from "../counters_tokens";
import {
  clearReplayQueuedSteps,
  addReplayQueuedStepIfMissing,
  matchesSacrificeSelectionResolveStep,
} from "../applyEventReplayZoneCommanderManaHelpers.js";
import {
  applyReplaySacrificedPermanent,
  consumeRecordedManaCostFromPool,
} from "../applyEventReplayCardMoveLibraryHelpers.js";
import { debugWarn } from "../../../utils/debug.js";
import { sacrificePermanent } from "../upkeep-triggers";
import { ResolutionQueueManager, ResolutionStepType } from "../../resolution/index.js";

export function applySacrificeChoiceEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "sacrificeUnlessPayChoice": {
        const pid = String((e as any).playerId || '').trim();
        const permId = String((e as any).permanentId || '').trim();
        const payMana = (e as any).payMana === true;
        const manaCost = String((e as any).manaCost || '').trim();

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
                (step as any).sacrificeUnlessPayChoice === true &&
                (!pid || String((step as any)?.playerId || '').trim() === pid) &&
                (!permId || String((step as any)?.permanentId || (step as any)?.sourceId || '').trim() === permId)
              );
            });
          }

          if (!pid || !permId) break;

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const permIndex = battlefield.findIndex((perm: any) => perm && String(perm.id || '') === permId);

          if (payMana) {
            try {
              const tapped = Array.isArray((e as any).tappedPermanents)
                ? ((e as any).tappedPermanents as any[]).map((id: any) => String(id)).filter(Boolean)
                : [];
              if (tapped.length > 0) {
                const tappedSet = new Set(tapped);
                for (const permanent of battlefield as any[]) {
                  if (permanent && tappedSet.has(String(permanent.id || ''))) {
                    (permanent as any).tapped = true;
                  }
                }
              }
            } catch {
              // best-effort only
            }

            const manaPool = (ctx.state as any).manaPool?.[pid];
            const manaDelta = (e as any).paymentManaDelta;
            if (manaPool && manaDelta && typeof manaDelta === 'object' && !Array.isArray(manaDelta)) {
              for (const [poolKey, rawAmount] of Object.entries(manaDelta as Record<string, unknown>)) {
                const amount = Number(rawAmount || 0);
                if (!Number.isFinite(amount) || amount === 0) continue;
                manaPool[poolKey] = Number(manaPool[poolKey] || 0) + amount;
              }
            } else if (manaPool && manaCost) {
              consumeRecordedManaCostFromPool(manaPool, manaCost);
            }

            const sacrificedPaymentPermanents = Array.isArray((e as any).sacrificedPaymentPermanents)
              ? ((e as any).sacrificedPaymentPermanents as any[]).map((id: any) => String(id)).filter(Boolean)
              : [];
            if (sacrificedPaymentPermanents.length > 0) {
              for (const permanentId of sacrificedPaymentPermanents) {
                const permanent = battlefield.find((entry: any) => entry && String((entry as any).id || '') === permanentId) as any;
                if (!permanent) continue;

                const tokenGraveyardSnapshot = permanent?.isToken && permanent?.card
                  ? { ...(permanent.card || {}), zone: 'graveyard' }
                  : null;
                const graveyardOwnerId = String(permanent?.owner || permanent?.controller || pid || '').trim();
                movePermanentToGraveyard(ctx as any, permanentId, true);

                if (tokenGraveyardSnapshot && graveyardOwnerId) {
                  const zones = ((ctx.state as any).zones = (ctx.state as any).zones || {});
                  const playerZones = (zones[graveyardOwnerId] = zones[graveyardOwnerId] || {
                    hand: [],
                    handCount: 0,
                    libraryCount: 0,
                    graveyard: [],
                    graveyardCount: 0,
                    exile: [],
                    exileCount: 0,
                  });
                  playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];

                  const alreadyPresent = (playerZones.graveyard as any[]).some((card: any) => {
                    if (!card) return false;
                    const cardId = String((card as any).id || '').trim();
                    const snapshotId = String((tokenGraveyardSnapshot as any).id || '').trim();
                    if (cardId && snapshotId) return cardId === snapshotId;
                    return String((card as any).name || '').trim() === String((tokenGraveyardSnapshot as any).name || '').trim();
                  });

                  if (!alreadyPresent) {
                    (playerZones.graveyard as any[]).push(tokenGraveyardSnapshot);
                    playerZones.graveyardCount = (playerZones.graveyard as any[]).length;
                  }
                }
              }
            }
          } else if (permIndex !== -1) {
            movePermanentToGraveyard(ctx as any, permId, true);
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(sacrificeUnlessPayChoice): failed', err);
        }
        break;
      }

      case "sacrificeAnotherPermanentForBenefitChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const controllerId = String((e as any).controllerId || playerId).trim() || playerId;
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const sourcePermanentId = String((e as any).sourcePermanentId || sourceId).trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.sacrificeAnotherPermanentForBenefitChoice === true &&
                String((step as any)?.sacrificeAnotherPermanentForBenefitStage || '') === 'ask' &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId || String((step as any)?.playerId || '').trim() === controllerId) &&
                (!sourcePermanentId || String((step as any)?.sacrificeAnotherPermanentForBenefitSourcePermanentId || (step as any)?.sourceId || '').trim() === sourcePermanentId) &&
                (!sourceName || String((step as any)?.sacrificeAnotherPermanentForBenefitSourceName || (step as any)?.sourceName || '').trim() === sourceName)
              );
            });

            addReplayQueuedStepIfMissing(replayGameId, (e as any).queuedResolutionStep, {
              playerId: controllerId,
              description: 'Choose a permanent to sacrifice',
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(sacrificeAnotherPermanentForBenefitChoiceResolve): failed', err);
        }
        break;
      }

      case "sacrificeAnotherPermanentForBenefitResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const controllerId = String((e as any).controllerId || playerId).trim() || playerId;
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const sacrificedPermanentId = String((e as any).sacrificedPermanentId || '').trim();
          const lifeGain = Number((e as any).lifeGain || 0);
          const drawCount = Math.max(0, Math.floor(Number((e as any).drawCount || 0)));

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.TARGET_SELECTION) &&
                (step as any)?.sacrificeAnotherPermanentForBenefitChoice === true &&
                String((step as any)?.sacrificeAnotherPermanentForBenefitStage || '') === 'select_sacrifice' &&
                (!controllerId || String((step as any)?.playerId || '').trim() === controllerId || String((step as any)?.sacrificeAnotherPermanentForBenefitController || '').trim() === controllerId) &&
                (!sourceId || String((step as any)?.sacrificeAnotherPermanentForBenefitSourcePermanentId || (step as any)?.sourceId || '').trim() === sourceId) &&
                (!sourceName || String((step as any)?.sacrificeAnotherPermanentForBenefitSourceName || (step as any)?.sourceName || '').trim() === sourceName)
              );
            });
          }

          if (sacrificedPermanentId) {
            applyReplaySacrificedPermanent(ctx, sacrificedPermanentId);
          }

          if (lifeGain) {
            const stateAny = ctx.state as any;
            stateAny.life = stateAny.life || {};
            const startingLife = Number(stateAny.startingLife || 40) || 40;
            const currentLife = Number(stateAny.life?.[controllerId] ?? startingLife);
            stateAny.life[controllerId] = currentLife + lifeGain;
            const playerObj = Array.isArray(stateAny.players)
              ? stateAny.players.find((player: any) => String(player?.id || '') === controllerId)
              : undefined;
            if (playerObj) playerObj.life = stateAny.life[controllerId];
          }

          if (drawCount > 0) {
            drawCards(ctx as any, controllerId as any, drawCount);
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(sacrificeAnotherPermanentForBenefitResolve): failed', err);
        }
        break;
      }

      case "sacrificeWhenYouDoResolve": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const sourceName = String((e as any).sourceName || 'Ability');
          const sourcePermanentId = (e as any).sourcePermanentId;
          const sourcePermanentSnapshot = (e as any).sourcePermanentSnapshot;
          const sacrificedPermanentId = String((e as any).sacrificedPermanentId || '').trim();
          const damage = Number((e as any).damage || 0);
          const lifeGain = Number((e as any).lifeGain || 0);
          const triggerId = String((e as any).triggerId || '').trim();
          const description = String((e as any).description || `${sourceName} deals ${damage} damage to any target and you gain ${lifeGain} life.`).trim();
          const effect = String((e as any).effect || description).trim();
          const card = (e as any).card || sourcePermanentSnapshot?.card;
          const requiresTarget = (e as any).requiresTarget === true;
          const targetType = String((e as any).targetType || (requiresTarget ? 'any_target' : '')).trim();
          const targetConstraint = String((e as any).targetConstraint || '').trim().toLowerCase();
          const targetDescription = String((e as any).targetDescription || (targetType ? (['any', 'any target', 'any_target'].includes(targetType.toLowerCase()) ? 'any target' : `target ${targetType}`) : 'target')).trim();
          const minTargets = typeof (e as any).minTargets === 'number' ? Number((e as any).minTargets) : 1;
          const maxTargets = typeof (e as any).maxTargets === 'number' ? Number((e as any).maxTargets) : 1;

          if (sacrificedPermanentId) {
            const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
            const stillOnBattlefield = battlefield.some((perm: any) => perm && String(perm.id || '') === sacrificedPermanentId);
            if (stillOnBattlefield) {
              sacrificePermanent({ ...(ctx as any), zones: ctx.state?.zones } as any, sacrificedPermanentId, playerId);
            }
          }

          if (triggerId) {
            ctx.state.stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
            const existingTrigger = (ctx.state.stack as any[]).find((item: any) => item && String(item.id || '') === triggerId);
            if (!existingTrigger) {
              (ctx.state.stack as any[]).push({
                id: triggerId,
                type: 'triggered_ability',
                controller: playerId,
                source: sourcePermanentId || null,
                ...(sourcePermanentId ? { permanentId: sourcePermanentId } : null),
                sourceName,
                description,
                effect,
                mandatory: true,
                ...(card && typeof card === 'object' ? { card } : null),
                ...(sourcePermanentSnapshot && typeof sourcePermanentSnapshot === 'object' ? { sourcePermanentSnapshot } : null),
                ...(Array.isArray((e as any).lastSacrificedPermanents) && (e as any).lastSacrificedPermanents.length > 0
                  ? { lastSacrificedPermanents: (e as any).lastSacrificedPermanents.map((entry: any) => ({ ...entry })) }
                  : null),
                ...(requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null),
                ...(targetType ? { targetType } : null),
                ...(targetConstraint ? { targetConstraint } : null),
                ...((e as any).targetZone ? { targetZone: (e as any).targetZone } : null),
                ...((e as any).targetDestination ? { targetDestination: (e as any).targetDestination } : null),
                ...((e as any).targetGraveyardScope ? { targetGraveyardScope: (e as any).targetGraveyardScope } : null),
                ...((e as any).destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
                ...((e as any).battlefieldControllerMode ? { battlefieldControllerMode: (e as any).battlefieldControllerMode } : null),
                ...((e as any).battlefieldCounters && typeof (e as any).battlefieldCounters === 'object' ? { battlefieldCounters: (e as any).battlefieldCounters } : null),
                ...((e as any).targetAction ? { targetAction: (e as any).targetAction } : null),
                ...(Array.isArray((e as any).targetFilterTypes) ? { targetFilterTypes: (e as any).targetFilterTypes } : null),
                ...(Array.isArray((e as any).targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords: (e as any).targetFilterRequiredTypeWords } : null),
                ...(Array.isArray((e as any).targetFilterExcludeTypes) ? { targetFilterExcludeTypes: (e as any).targetFilterExcludeTypes } : null),
                ...((e as any).targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
                ...(typeof (e as any).targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue: (e as any).targetFilterExactManaValue } : null),
                ...(typeof (e as any).targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue: (e as any).targetFilterMinManaValue } : null),
                ...(typeof (e as any).targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue: (e as any).targetFilterMaxManaValue } : null),
                ...(typeof (e as any).targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit: (e as any).targetTotalPowerLimit } : null),
                ...(typeof minTargets === 'number' ? { minTargets } : null),
                ...(typeof maxTargets === 'number' ? { maxTargets } : null),
              } as any);
            }

            if ((ctx as any).gameId && requiresTarget) {
              const queue = ResolutionQueueManager.getQueue((ctx as any).gameId);
              const normalizedTargetType = targetType.toLowerCase();
              const existingTargetStep = queue.steps.find((step: any) =>
                step &&
                String((step as any).type || '') === String(ResolutionStepType.TARGET_SELECTION) &&
                String((step as any).sourceId || '') === triggerId &&
                Array.isArray((step as any).targetTypes) &&
                (step as any).targetTypes.map((entry: any) => String(entry).toLowerCase()).includes(normalizedTargetType)
              );

              if (!existingTargetStep) {
                const permanentMatches = (perm: any): boolean => {
                  if (!perm) return false;
                  const typeLine = String(perm?.card?.type_line || '').toLowerCase();
                  if (targetConstraint === 'opponent' && String(perm.controller || '') === playerId) return false;
                  if (targetConstraint === 'you' && String(perm.controller || '') !== playerId) return false;
                  if (['any', 'any target', 'any_target', 'permanent'].includes(normalizedTargetType)) return true;
                  if (normalizedTargetType === 'creature or planeswalker') return typeLine.includes('creature') || typeLine.includes('planeswalker');
                  if (normalizedTargetType === 'artifact or enchantment') return typeLine.includes('artifact') || typeLine.includes('enchantment');
                  if (normalizedTargetType === 'nonland permanent') return !typeLine.includes('land');
                  if (normalizedTargetType === 'noncreature permanent') return !typeLine.includes('creature');
                  return normalizedTargetType.length > 0 && typeLine.includes(normalizedTargetType);
                };
                const targetsPlayers = ['any', 'any target', 'any_target', 'player', 'opponent'].includes(normalizedTargetType);
                const validPlayerTargets = targetsPlayers
                  ? ((ctx.state.players || []) as any[])
                      .filter((player: any) => player && player.id && (player as any).hasLost !== true)
                      .filter((player: any) => normalizedTargetType === 'opponent' || targetConstraint === 'opponent' ? String(player.id) !== playerId : true)
                      .map((player: any) => ({
                        id: player.id,
                        label: player.name || player.id,
                        description: 'player',
                      }))
                  : [];
                const validPermanentTargets = ((ctx.state.battlefield || []) as any[])
                  .filter(permanentMatches)
                  .map((perm: any) => ({
                    id: perm.id,
                    label: perm.card?.name || 'Permanent',
                    description: perm.card?.type_line || 'permanent',
                    imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
                  }));
                const validTargets = [...validPlayerTargets, ...validPermanentTargets];

                if (validTargets.length >= Math.max(0, minTargets)) {
                  const triggerItem = (ctx.state.stack as any[]).find((item: any) => item && String(item.id || '') === triggerId) || {
                    id: triggerId,
                    type: 'triggered_ability',
                    controller: playerId,
                    source: sourcePermanentId || null,
                    ...(sourcePermanentId ? { permanentId: sourcePermanentId } : null),
                    sourceName,
                    description,
                    effect,
                    mandatory: true,
                    ...(card && typeof card === 'object' ? { card } : null),
                    ...(sourcePermanentSnapshot && typeof sourcePermanentSnapshot === 'object' ? { sourcePermanentSnapshot } : null),
                    ...(requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null),
                    ...(targetType ? { targetType } : null),
                  };

                  ResolutionQueueManager.addStep((ctx as any).gameId, {
                    type: ResolutionStepType.TARGET_SELECTION,
                    playerId: playerId as any,
                    description: `${sourceName}: Choose ${targetDescription}`,
                    mandatory: true,
                    sourceId: triggerId,
                    sourceName,
                    validTargets,
                    targetTypes: [targetType],
                    minTargets,
                    maxTargets: Math.min(validTargets.length, Math.max(minTargets, maxTargets)),
                    targetDescription,
                    targetedTriggeredAbility: true,
                    triggerItem,
                    targetedTriggeredAbilitySourceName: sourceName,
                    targetedTriggeredAbilityDescription: description,
                    targetedTriggeredAbilityController: playerId,
                  } as any);
                }
              }
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(sacrificeWhenYouDoResolve): failed', err);
        }
        break;
      }

      case "sacrificeSelectionResolve": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const permanentIds = Array.isArray((e as any).permanentIds)
            ? ((e as any).permanentIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
            : [];

          if (gameId) {
            clearReplayQueuedSteps(gameId, (step: any) => {
              if (!step) return false;
              if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
              return matchesSacrificeSelectionResolveStep(step, e as any);
            });
          }

          for (const permanentId of permanentIds) {
            const stillOnBattlefield = Array.isArray(ctx.state?.battlefield)
              ? (ctx.state.battlefield as any[]).some((entry: any) => entry && String(entry.id || '') === permanentId)
              : false;
            if (!stillOnBattlefield) continue;
            const battlefield = Array.isArray(ctx.state?.battlefield) ? (ctx.state.battlefield as any[]) : [];
            const permanent = battlefield.find((entry: any) => entry && String((entry as any).id || '') === permanentId) as any;
            const tokenGraveyardSnapshot = permanent?.isToken && permanent?.card
              ? { ...(permanent.card || {}), zone: 'graveyard' }
              : null;
            const graveyardOwnerId = String(permanent?.owner || permanent?.controller || (e as any).playerId || '').trim();
            movePermanentToGraveyard(ctx as any, permanentId, true);

            if (tokenGraveyardSnapshot && graveyardOwnerId) {
              const zones = ((ctx.state as any).zones = (ctx.state as any).zones || {});
              const playerZones = (zones[graveyardOwnerId] = zones[graveyardOwnerId] || {
                hand: [],
                handCount: 0,
                libraryCount: 0,
                graveyard: [],
                graveyardCount: 0,
                exile: [],
                exileCount: 0,
              });
              playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];

              const alreadyPresent = (playerZones.graveyard as any[]).some((card: any) => {
                if (!card) return false;
                const cardId = String((card as any).id || '').trim();
                const snapshotId = String((tokenGraveyardSnapshot as any).id || '').trim();
                if (cardId && snapshotId) return cardId === snapshotId;
                return String((card as any).name || '').trim() === String((tokenGraveyardSnapshot as any).name || '').trim();
              });

              if (!alreadyPresent) {
                (playerZones.graveyard as any[]).push(tokenGraveyardSnapshot);
                playerZones.graveyardCount = (playerZones.graveyard as any[]).length;
              }
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(sacrificeSelectionResolve): failed', err);
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
