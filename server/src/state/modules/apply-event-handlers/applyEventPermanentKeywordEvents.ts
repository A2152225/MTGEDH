// server/src/state/modules/apply-event-handlers/applyEventPermanentKeywordEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Goad, ward prompts/payment, crew, station, enlist, exert and room door choices.
// Public entry: applyPermanentKeywordEvents(ctx, e) -> true when it handled the event.
//
// Handles: goadPermanent, battlefieldPermanentPatch, targetSelectionWardPrompt, wardPaymentResolve, targetSelectionTapUntapPrompt, crewVehicle, station_activated, enlist, exertChoice, roomDoorChoice
import type { GameContext } from "../../context";
import type { PlayerID, GameEvent } from "../../types";
import { updateCounters, movePermanentToGraveyard } from "../counters_tokens";
import { applyRoomDoorLockOrUnlockChoice } from "../triggers/room.js";
import { applyTemporaryGraveyardKeywordGrantFromText } from "../graveyard-permissions.js";
import {
  getCurrentCombatPowerSnapshot,
  clearReplayQueuedSteps,
  clearReplayQueuedStepById,
} from "../applyEventReplayZoneCommanderManaHelpers.js";
import { debugWarn } from "../../../utils/debug.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../resolution/index.js";
import { consumeReplayedTriggeredAbilityStackItems } from "../replay-prompt-cleanup.js";
import { applyBattlefieldPermanentReplayPatch } from "../../effects/battlefieldPermanentReplayPersistence.js";
import { getOrInitManaPool } from "../../../socket/util.js";
import { queueParsedSubjectEvent } from "../triggerEmissionFamilyUtils.js";
import { rollPlanarDie } from "../planarDie.js";

export function applyPermanentKeywordEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "goadPermanent": {
        try {
          if (
            (ctx as any).isReplaying
            && ((e as any).oracleIrReplayMutation === true || (e as any).effectProgramMutation === true)
          ) {
            consumeReplayedTriggeredAbilityStackItems(ctx, e as Record<string, unknown>);
          }

          const permanentId = String((e as any).permanentId || '').trim();
          const goaderId = String((e as any).goaderId || '').trim() as PlayerID;
          if (!permanentId || !goaderId) break;

          const idx = ctx.state.battlefield.findIndex((p: any) => String(p?.id || '') === permanentId);
          if (idx < 0) break;

          const perm = ctx.state.battlefield[idx] as any;
          const existing = Array.isArray(perm.goadedBy) ? perm.goadedBy : [];
          if (!existing.includes(goaderId)) {
            perm.goadedBy = [...existing, goaderId];
          }

          const persistedExpiryTurn = Number((e as any).expiryTurn ?? 0);
          const currentTurn = Number((ctx.state as any).turnNumber ?? 0) || 0;
          const expiryTurn = persistedExpiryTurn > 0 ? persistedExpiryTurn : currentTurn + 1;
          perm.goadedUntil = { ...(perm.goadedUntil || {}), [goaderId]: expiryTurn };

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(goadPermanent): failed', err);
        }
        break;
      }

      case "battlefieldPermanentPatch": {
        try {
          const permanentId = String((e as any).permanentId || '').trim();
          const patch = (e as any).patch;
          if (!permanentId || !patch || typeof patch !== 'object' || Array.isArray(patch)) break;

          const idx = ctx.state.battlefield.findIndex((p: any) => String(p?.id || '') === permanentId);
          if (idx < 0) break;

          applyBattlefieldPermanentReplayPatch(ctx.state.battlefield[idx] as any, patch as any);
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(battlefieldPermanentPatch): failed', err);
        }
        break;
      }

      case "targetSelectionWardPrompt": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const rawQueuedStep = (e as any).queuedResolutionStep;
          const rawQueuedSteps = Array.isArray((e as any).queuedResolutionSteps)
            ? ((e as any).queuedResolutionSteps as any[]).filter((step) => step && typeof step === 'object' && !Array.isArray(step))
            : [];
          const queuedStepsToReplay = rawQueuedSteps.length > 0
            ? rawQueuedSteps
            : (rawQueuedStep && typeof rawQueuedStep === 'object' && !Array.isArray(rawQueuedStep) ? [rawQueuedStep] : []);

          const targets = Array.isArray((e as any).targets)
            ? ((e as any).targets as any[]).map((targetId: any) => String(targetId || '').trim()).filter(Boolean)
            : [];

          if (sourceId && Array.isArray((ctx.state as any).stack)) {
            const stackItem = ((ctx.state as any).stack as any[]).find((item: any) => item && String(item.id || '') === sourceId);
            if (stackItem && targets.length > 0) {
              stackItem.targets = [...targets];
            }
          }

          if (replayGameId && queuedStepsToReplay.length > 0) {
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
                } as any);
              }
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(targetSelectionWardPrompt): failed', err);
        }
        break;
      }

      case "wardPaymentResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const stepId = String((e as any).stepId || '').trim();

          if (replayGameId && stepId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => String((step as any)?.id || '').trim() === stepId);
          }

          try {
            const tapped = Array.isArray((e as any).tappedPermanents)
              ? ((e as any).tappedPermanents as any[]).map((id: any) => String(id)).filter(Boolean)
              : [];
            if (tapped.length > 0) {
              const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
              const tappedSet = new Set(tapped);
              for (const permanent of battlefield as any[]) {
                if (permanent && tappedSet.has(String((permanent as any).id || ''))) {
                  (permanent as any).tapped = true;
                }
              }
            }
          } catch {
            // best-effort only
          }

          try {
            const manaDelta = (e as any).paymentManaDelta;
            if (playerId && manaDelta && typeof manaDelta === 'object' && !Array.isArray(manaDelta)) {
              const pool = getOrInitManaPool(ctx.state as any, playerId as any) as any;
              for (const [poolKey, rawAmount] of Object.entries(manaDelta as Record<string, unknown>)) {
                const amount = Number(rawAmount || 0);
                if (!Number.isFinite(amount) || amount === 0) continue;
                pool[poolKey] = Number(pool[poolKey] || 0) + amount;
              }
            }
          } catch {
            // best-effort only
          }

          try {
            const sacrificed = Array.isArray((e as any).sacrificedPermanents)
              ? ((e as any).sacrificedPermanents as any[]).map((id: any) => String(id)).filter(Boolean)
              : [];
            if (sacrificed.length > 0) {
              for (const permanentId of sacrificed) {
                const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
                const permanent = battlefield.find((entry: any) => entry && String((entry as any).id || '') === permanentId) as any;
                if (!permanent) continue;

                const tokenGraveyardSnapshot = permanent?.isToken && permanent?.card
                  ? { ...(permanent.card || {}), zone: 'graveyard' }
                  : null;
                const graveyardOwnerId = String(permanent?.owner || permanent?.controller || playerId || '').trim();
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
          } catch {
            // best-effort only
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(wardPaymentResolve): failed', err);
        }
        break;
      }

      case "targetSelectionTapUntapPrompt": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const rawQueuedStep = (e as any).queuedResolutionStep;
          if (!replayGameId || !rawQueuedStep || typeof rawQueuedStep !== 'object' || Array.isArray(rawQueuedStep)) {
            ctx.bumpSeq();
            break;
          }

          const queue = ResolutionQueueManager.getQueue(replayGameId) as any;
          const queuedStepId = String((rawQueuedStep as any)?.id || '').trim();
          const queuedStepType = String((rawQueuedStep as any)?.type || '').trim();
          const alreadyPresent = Boolean(
            (queue?.activeStep && String((queue.activeStep as any)?.id || '') === queuedStepId) ||
            (Array.isArray(queue?.steps) && queue.steps.some((step: any) => String((step as any)?.id || '') === queuedStepId))
          );

          if (!alreadyPresent && queuedStepType) {
            ResolutionQueueManager.addStep(replayGameId, {
              ...(rawQueuedStep as any),
              ...(queuedStepId ? { id: queuedStepId } : {}),
              type: queuedStepType as any,
              playerId: String((rawQueuedStep as any).playerId || playerId || '') as any,
              description: String((rawQueuedStep as any).description || ''),
              mandatory: (rawQueuedStep as any).mandatory !== false,
            } as any);
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(targetSelectionTapUntapPrompt): failed', err);
        }
        break;
      }

      case "crewVehicle": {
        try {
          const pid = String((e as any).playerId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const vehicleId = String((e as any).vehicleId || (e as any).sourceId || '').trim();
          const crewerIdsRaw = (e as any).crewerIds;
          const crewerIds = Array.isArray(crewerIdsRaw)
            ? crewerIdsRaw.map((id: any) => String(id ?? '')).filter((x: string) => x.length > 0)
            : [];

          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '') === String(ResolutionStepType.TARGET_SELECTION) &&
                (step as any)?.crewAbility === true &&
                (!pid || String((step as any)?.playerId || '').trim() === pid) &&
                (!vehicleId || String((step as any)?.vehicleId || (step as any)?.sourceId || '').trim() === vehicleId)
              );
            });
          }

          const battlefield = (ctx.state.battlefield || []) as any[];
          const vehicle = battlefield.find((p: any) => p && String(p.id) === vehicleId);
          if (!vehicle) break;

          // Mark vehicle as crewed until end of turn.
          (vehicle as any).crewed = true;
          (vehicle as any).grantedTypes = Array.isArray((vehicle as any).grantedTypes) ? (vehicle as any).grantedTypes : [];
          if (!(vehicle as any).grantedTypes.includes('Creature')) {
            (vehicle as any).grantedTypes.push('Creature');
          }

          // Tap the chosen crewers and record which creature subtypes crewed it.
          const crewedTypesLower: string[] = [];
          for (const crewerId of crewerIds) {
            const crewer = battlefield.find((p: any) => p && String(p.id) === String(crewerId));
            if (!crewer) continue;
            (crewer as any).tapped = true;

            const typeLine = String((crewer as any)?.card?.type_line || '');
            const dashIndex = typeLine.indexOf('—');
            if (dashIndex >= 0) {
              const subtypes = typeLine.substring(dashIndex + 1).trim();
              for (const t of subtypes.split(/\s+/)) {
                const lower = String(t || '').toLowerCase().trim();
                if (lower) crewedTypesLower.push(lower);
              }
            }
          }

          // Intervening-if support fields (best-effort today, but now deterministic when this event exists).
          (vehicle as any).crewedByCreatureCountThisTurn = crewerIds.length;
          queueParsedSubjectEvent(ctx, {
            event: 'becomes_crewed',
            subjectPermanent: vehicle,
            subjectControllerId: String(vehicle.controller || pid || ''),
            triggerType: 'becomes_crewed',
            effectData: { vehicleId },
          });
          if (crewedTypesLower.length > 0) {
            (vehicle as any).crewedByCreatureTypesThisTurn = Array.from(new Set(crewedTypesLower));
            (vehicle as any).crewedBySubtypesThisTurn = (vehicle as any).crewedByCreatureTypesThisTurn;
          }

          // Intervening-if support: track that this player tapped a nonland permanent this turn.
          if (pid) {
            const stateAny = ctx.state as any;
            stateAny.tappedNonlandPermanentThisTurnByPlayer = stateAny.tappedNonlandPermanentThisTurnByPlayer || {};
            stateAny.tappedNonlandPermanentThisTurnByPlayer[pid] = true;
          }

          applyTemporaryGraveyardKeywordGrantFromText(
            ctx as any,
            pid as any,
            String(vehicle?.card?.name || 'Vehicle'),
            String(vehicle?.card?.oracle_text || vehicle?.card?.oracleText || ''),
            {
              id: vehicleId,
              sourceId: vehicleId,
              source: vehicleId,
              permanentId: vehicleId,
              card: vehicle?.card,
            },
          );

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(crewVehicle): failed', err);
        }
        break;
      }

      case "station_activated": {
        try {
          const pid = String((e as any).playerId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const stationId = String((e as any).stationId || '').trim();
          const creatureId = String((e as any).creatureId || '').trim();
          const counterType = String((e as any).counterType || 'charge').trim() || 'charge';
          const countersAdded = Math.max(0, Math.floor(Number((e as any).countersAdded || 0)));
          const totalCountersRaw = (e as any).totalCounters;
          const stationed = Boolean((e as any).stationed);
          const grantedTypesRaw = (e as any).grantedTypes;

          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              const stepStationId = String(
                (step as any)?.tapForCountersSource?.id
                  || (step as any)?.station?.id
                  || (step as any)?.sourceId
                  || '',
              ).trim();
              return (
                String((step as any)?.type || '') === String(ResolutionStepType.STATION_CREATURE_SELECTION) &&
                (!pid || String((step as any)?.playerId || '').trim() === pid) &&
                (!stationId || stepStationId === stationId)
              );
            });
          }

          const battlefield = (ctx.state.battlefield || []) as any[];
          const station = stationId
            ? battlefield.find((p: any) => p && String(p.id) === stationId)
            : null;

          if (station) {
            // Idempotent sync: IR may already have applied an updateCounters event earlier.
            const current = Number((station as any).counters?.[counterType] || 0);
            const desired = totalCountersRaw != null && totalCountersRaw !== ''
              ? Math.max(0, Math.floor(Number(totalCountersRaw)))
              : current + countersAdded;
            const delta = desired - current;
            if (delta !== 0) {
              updateCounters(ctx as any, stationId, { [counterType]: delta }, {
                skipEventPersistence: true,
                skipCounterModifications: true,
              });
            }

            if (stationed) {
              (station as any).stationed = true;
              (station as any).grantedTypes = Array.isArray((station as any).grantedTypes)
                ? (station as any).grantedTypes
                : [];
              const typesToGrant = Array.isArray(grantedTypesRaw) && grantedTypesRaw.length > 0
                ? grantedTypesRaw.map((t: any) => String(t || '').trim()).filter(Boolean)
                : ['Creature'];
              for (const typeName of typesToGrant) {
                if (!(station as any).grantedTypes.includes(typeName)) {
                  (station as any).grantedTypes.push(typeName);
                }
              }
            }
          }

          if (creatureId) {
            const creature = battlefield.find((p: any) => p && String(p.id) === creatureId);
            if (creature) {
              (creature as any).tapped = true;
              if (pid) {
                const stateAny = ctx.state as any;
                stateAny.tappedNonlandPermanentThisTurnByPlayer =
                  stateAny.tappedNonlandPermanentThisTurnByPlayer || {};
                stateAny.tappedNonlandPermanentThisTurnByPlayer[pid] = true;
              }
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(station_activated): failed', err);
        }
        break;
      }

      case "enlist": {
        try {
          const pid = String((e as any).playerId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const attackerId = String((e as any).attackerId || (e as any).sourceId || '').trim();
          const enlistedCreatureId = String((e as any).enlistedCreatureId || '').trim();

          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '') === String(ResolutionStepType.TARGET_SELECTION) &&
                (step as any)?.enlistChoice === true &&
                (!pid || String((step as any)?.playerId || '').trim() === pid) &&
                (!attackerId || String((step as any)?.enlistAttackerId || (step as any)?.sourceId || '').trim() === attackerId)
              );
            });
          }

          if (!attackerId || !enlistedCreatureId) break;

          const battlefield = (ctx.state.battlefield || []) as any[];
          const attacker = battlefield.find((p: any) => p && String(p.id) === attackerId);
          const enlisted = battlefield.find((p: any) => p && String(p.id) === enlistedCreatureId);
          if (!attacker || !enlisted) break;

          const enlistedPower = getCurrentCombatPowerSnapshot(enlisted, ctx.state);

          // Tap the enlisted creature and record that enlist was used.
          (enlisted as any).tapped = true;
          (attacker as any).enlistedThisCombat = true;
          (attacker as any).enlistedCreatureThisCombat = true;
          (attacker as any).enlistedCreatureIdThisCombat = enlistedCreatureId;
          (attacker as any).temporaryPowerBoost = ((attacker as any).temporaryPowerBoost || 0) + enlistedPower;
          delete (attacker as any).effectivePower;
          delete (attacker as any).effectiveToughness;

          // Intervening-if support: track that this player tapped a nonland permanent this turn.
          if (pid) {
            const stateAny = ctx.state as any;
            stateAny.tappedNonlandPermanentThisTurnByPlayer = stateAny.tappedNonlandPermanentThisTurnByPlayer || {};
            stateAny.tappedNonlandPermanentThisTurnByPlayer[pid] = true;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(enlist): failed', err);
        }
        break;
      }

      case "exertChoice": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const attackerId = String((e as any).attackerId || (e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            if (resolvedStepId) {
              clearReplayQueuedStepById(replayGameId, resolvedStepId);
            } else {
              clearReplayQueuedSteps(replayGameId, (step: any) => {
                if (!step || String(step?.type || '') !== String(ResolutionStepType.OPTION_CHOICE)) return false;
                if (String(step?.playerId || '') !== playerId) return false;
                if ((step as any).exertChoice !== true) return false;
                const queuedAttackerId = String((step as any).exertAttackerId || (step as any).permanentId || (step as any).sourceId || '').trim();
                return !attackerId || queuedAttackerId === attackerId;
              });
            }
          }

          if ((e as any).cancelled === true || (e as any).exerted === false) break;
          if (!attackerId) break;

          const battlefield = (ctx.state.battlefield || []) as any[];
          const attacker = battlefield.find((permanent: any) => permanent && String(permanent.id || '') === attackerId);
          if (!attacker) break;

          (attacker as any).doesntUntapNextTurn = true;
          (attacker as any).exertedThisTurn = true;
          // "Whenever you exert" triggers are pushed (and persisted) by the live caller via
          // pushWheneverYouExertTriggersOntoStack; queuing here duplicated them live and on replay.
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(exertChoice): failed', err);
        }
        break;
      }

      case "roomDoorChoice": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const roomPermanentId = String((e as any).roomPermanentId || '').trim();
          const choiceId = String((e as any).choiceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            if (resolvedStepId) {
              clearReplayQueuedStepById(replayGameId, resolvedStepId);
            } else {
              clearReplayQueuedSteps(replayGameId, (step: any) => {
                if (!step || String(step?.type || '') !== String(ResolutionStepType.OPTION_CHOICE)) return false;
                if (String(step?.playerId || '') !== playerId) return false;
                if ((step as any).roomDoorLockOrUnlock !== true) return false;
                const queuedRoomId = String((step as any).roomPermanentId || (step as any).sourceId || '').trim();
                return !roomPermanentId || queuedRoomId === roomPermanentId;
              });
            }
          }

          if ((e as any).cancelled === true || !roomPermanentId || !choiceId) break;

          applyRoomDoorLockOrUnlockChoice(ctx as any, playerId as any, roomPermanentId, choiceId);
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(roomDoorChoice): failed', err);
        }
        break;
      }

      case "saddleMount": {
        try {
          const pid = String((e as any).playerId || '').trim();
          const mountId = String((e as any).vehicleId || (e as any).mountId || '').trim();
          const crewerIds = Array.isArray((e as any).crewerIds) ? (e as any).crewerIds.map((id: any) => String(id)) : [];
          const battlefield = (ctx.state.battlefield || []) as any[];
          const mount = battlefield.find((p: any) => p && String(p.id) === mountId);
          if (!mount) break;
          for (const crewerId of crewerIds) {
            const crewer = battlefield.find((p: any) => p && String(p.id) === String(crewerId));
            if (crewer) crewer.tapped = true;
          }
          mount.saddled = true;
          mount.saddledThisTurn = Number((ctx.state as any).turnNumber || (ctx.state as any).turn || 0);
          queueParsedSubjectEvent(ctx, {
            event: 'becomes_saddled',
            subjectPermanent: mount,
            subjectControllerId: String(mount.controller || pid || ''),
            triggerType: 'becomes_saddled',
            effectData: { mountId },
          });
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(saddleMount): failed', err);
        }
        break;
      }

      case "rollPlanarDie": {
        try {
          const pid = String((e as any).playerId || '').trim();
          const face = (e as any).face;
          if (pid) rollPlanarDie(ctx, pid, face);
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(rollPlanarDie): failed', err);
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
