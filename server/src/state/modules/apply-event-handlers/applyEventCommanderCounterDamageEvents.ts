// server/src/state/modules/apply-event-handlers/applyEventCommanderCounterDamageEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Commander zone transitions, counter/token bookkeeping and direct damage application.
// Public entry: applyCommanderCounterDamageEvents(ctx, e) -> true when it handled the event.
//
// Handles: setCommander, castCommander, moveCommanderToCZ, commanderZoneChoice, updateCounters, updateCountersBulk, createToken, removePermanent, dealDamage
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { setCommander, castCommander, moveCommanderToCZ } from "../commander";
import {
  updateCounters,
  applyUpdateCountersBulk,
  createToken,
  removePermanent,
  applyEngineEffects,
  runSBA,
} from "../counters_tokens";
import { pushStack } from "../stackPushUtils.js";
import {
  resolveReplayCommanderId,
  resolveReplayCommanderCard,
  generateDeterministicId,
  clearReplayQueuedSteps,
  removeReplayCommanderCardFromZones,
  putReplayCommanderCardInDestination,
} from "../applyEventReplayZoneCommanderManaHelpers.js";
import { evaluateAction } from "../../../rules-engine/index";
import { debug, debugWarn, debugError } from "../../../utils/debug.js";
import { ResolutionStepType } from "../../resolution/index.js";
import {
  applyCreatureDamageFromSource,
  inferInfectWitherFlags,
  resolvePlayerDamage,
} from "../combat-damage-processing.js";

import { applyResolveIdenticalCounterRun } from "../identicalCounterRunApply.js";

function isReplayCounterMutation(ev: any): boolean {
  return Boolean(ev) && ev.type === "updateCounters" && ev.oracleIrReplayMutation === true;
}

/**
 * Replay only: one resolving effect (Cathars' Crusade on 250 creatures) persists one
 * updateCounters mutation per permanent. Live resolution checks state-based actions once
 * after the effect; replaying each mutation with its own full SBA pass made restores
 * O(events x board). Defer SBA while the next event continues the same source's batch;
 * the batch's last mutation runs SBA as usual (SBAs never run mid-resolution, CR 704.3).
 */
function replayCounterBatchContinues(ctx: GameContext, e: GameEvent): boolean {
  const c = ctx as any;
  if (!c?.isReplaying || !isReplayCounterMutation(e)) return false;
  const sourceId = String((e as any).oracleIrSourceId || "");
  if (!sourceId) return false;
  const events = c._replayEvents;
  const index = c._replayEventIndex;
  if (!Array.isArray(events) || typeof index !== "number") return false;
  const next = events[index + 1];
  return isReplayCounterMutation(next) && String(next.oracleIrSourceId || "") === sourceId;
}

export function applyCommanderCounterDamageEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "setCommander": {
        const pid = (e as any).playerId;
        // Check hand count BEFORE calling setCommander to know if we need opening draw
        const zones = ctx.state.zones || {};
        const zonesBefore = zones[pid];
        const handCountBefore = zonesBefore
          ? (typeof zonesBefore.handCount === "number" ? zonesBefore.handCount : (Array.isArray(zonesBefore.hand) ? zonesBefore.hand.length : 0))
          : 0;
        
        setCommander(
          ctx as any,
          pid,
          (e as any).commanderNames || [],
          (e as any).commanderIds || [],
          (e as any).colorIdentity || []
        );
        
        // For backward compatibility with old games that don't have separate shuffle/draw events:
        // If hand was empty before and is still empty after setCommander, we need to check if
        // the next events include shuffleLibrary/drawCards. If not, we'll do it here.
        // This flag can be checked by the replay function to decide.
        // For now, mark that setCommander was called with empty hand for potential follow-up.
        if (handCountBefore === 0) {
          (ctx as any)._setCommanderCalledWithEmptyHand = pid;
        }
        break;
      }

      case "castCommander": {
        const playerId = (e as any).playerId;
        const commanderId = resolveReplayCommanderId(ctx, e);
        const commanderCard = resolveReplayCommanderCard(ctx, e, commanderId);
        debug(1, `[applyEvent] Replaying castCommander event:`, { playerId, commanderId });

        if (!(e as any).commanderId && commanderId) {
          debugWarn(1, `[applyEvent] Recovered legacy castCommander replay event without commanderId`, {
            playerId,
            commanderId,
            cardId: (e as any).cardId,
            cardName: (e as any).cardName,
          });
        }
        
        if (!commanderId) {
          debugError(1, `[applyEvent] CRITICAL: castCommander event has undefined commanderId!`, {
            event: e,
            playerId
          });
          debugWarn(1, `[applyEvent] Skipping castCommander event with undefined commanderId to prevent infinite loop`);
          break;
        }
        
        if (playerId && commanderCard) {
          pushStack(ctx as any, {
            id: generateDeterministicId(ctx as any, 'stack', commanderId),
            type: 'spell',
            controller: playerId,
            source: 'command',
            fromZone: 'command',
            castSourceZone: 'command',
            card: {
              ...commanderCard,
              zone: 'stack',
              isCommander: true,
              source: 'command',
              fromZone: 'command',
              castSourceZone: 'command',
            },
            targets: [],
          } as any);
        } else {
          debugWarn(1, `[applyEvent] Unable to rebuild commander stack item during castCommander replay`, {
            playerId,
            commanderId,
            hasCardSnapshot: !!(e as any).card,
          });
        }

        castCommander(
          ctx as any,
          playerId,
          commanderId
        );
        break;
      }

      case "moveCommanderToCZ": {
        moveCommanderToCZ(
          ctx as any,
          (e as any).playerId,
          (e as any).commanderId
        );
        break;
      }

      case "commanderZoneChoice": {
        const pid = String((e as any).playerId || '').trim();
        const commanderId = String((e as any).commanderId || '').trim();
        const moveToCommandZone = (e as any).moveToCommandZone === true;
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        const destinationZone = String((e as any).destinationZone || (e as any).fromZone || 'graveyard').trim().toLowerCase();
        const libraryPosition = String((e as any).libraryPosition || 'shuffle').trim().toLowerCase();
        const card = (e as any).card && typeof (e as any).card === 'object' ? (e as any).card : undefined;
        const cardId = String(card?.id || '').trim();

        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.commanderZoneChoice === true &&
                (!pid || String((step as any)?.playerId || '').trim() === pid) &&
                (!commanderId || String((step as any)?.commanderId || (step as any)?.card?.id || '').trim() === commanderId)
              );
            });
          }

          if (moveToCommandZone) {
            // Mirror live resolution.ts commander->CZ path. Previously only
            // moveCommanderToCZ ran, leaving BF/stack/zone ghosts after undo/replay
            // which made getCommandZoneCommanderCandidates exclude the commander.
            moveCommanderToCZ(ctx as any, pid, commanderId || cardId);

            const stateAny = ctx.state as any;
            const ids = new Set(
              [commanderId, cardId, String((e as any).sourceId || '').trim()]
                .map((id) => String(id || '').trim())
                .filter(Boolean),
            );

            // Remove from destination/source zones and battlefield (same helper used
            // by the non-CZ branch). This also clears a stale zones.commandZone entry
            // so we can re-insert a clean card below.
            removeReplayCommanderCardFromZones(stateAny, pid, commanderId, cardId);

            // Also drop an actual commander SPELL still on the stack (not triggers).
            if (Array.isArray(stateAny.stack) && ids.size > 0) {
              stateAny.stack = stateAny.stack.filter((item: any) => {
                const itemType = String(item?.type || '').toLowerCase();
                if (itemType && itemType !== 'spell') return true;
                const spellCard = item?.card || item?.spell?.card;
                const spellCardId = String(spellCard?.id || '').trim();
                const spellId = String(item?.id || '').trim();
                return !ids.has(spellCardId) && !ids.has(spellId);
              });
            }

            // Ensure the card object is present in zones.commandZone for UI/view.
            if (pid) {
              stateAny.zones = stateAny.zones || {};
              const zones = stateAny.zones[pid] = stateAny.zones[pid] || {};
              zones.commandZone = Array.isArray(zones.commandZone) ? zones.commandZone : [];
              const czCard = card && typeof card === 'object'
                ? { ...card, zone: 'command' }
                : { id: commanderId || cardId, zone: 'command' };
              const czCardId = String(czCard?.id || '').trim();
              const alreadyInZonesCZ = zones.commandZone.some(
                (c: any) => czCardId && String(c?.id || '').trim() === czCardId,
              );
              if (!alreadyInZonesCZ && (czCardId || czCard?.name)) {
                zones.commandZone.push(czCard);
              }
              zones.commandZoneCount = zones.commandZone.length;

              // Keep commanderCards snapshot in sync if somehow missing.
              const czInfo = stateAny.commandZone?.[pid];
              if (czInfo && Array.isArray(czInfo.commanderCards) && czCardId) {
                const hasSnapshot = czInfo.commanderCards.some(
                  (c: any) => String(c?.id || '').trim() === czCardId,
                );
                if (!hasSnapshot) {
                  czInfo.commanderCards.push({ ...czCard });
                }
              }
            }
          } else if (pid && (commanderId || cardId)) {
            removeReplayCommanderCardFromZones(ctx.state as any, pid, commanderId, cardId);
            putReplayCommanderCardInDestination(ctx as any, pid, destinationZone, libraryPosition, card || { id: commanderId }, (e as any).exileTag);

            const commandZoneInfo = (ctx.state as any)?.commandZone?.[pid];
            if (commandZoneInfo && Array.isArray(commandZoneInfo.inCommandZone)) {
              commandZoneInfo.inCommandZone = commandZoneInfo.inCommandZone.filter((id: any) => String(id || '') !== commanderId && String(id || '') !== cardId);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(commanderZoneChoice): failed", err);
        }
        break;
      }

      case "updateCounters": {
        updateCounters(
          ctx as any,
          (e as any).permanentId,
          (e as any).deltas || {},
          {
            skipCounterModifications: (e as any).skipCounterModifications === true,
            deferRunSBA: (e as any).deferRunSBA === true || replayCounterBatchContinues(ctx, e),
            skipEventPersistence: true,
          },
        );
        break;
      }

      case "resolveIdenticalCounterRun": {
        applyResolveIdenticalCounterRun(ctx, e);
        break;
      }

      case "updateCountersBulk": {
        applyUpdateCountersBulk(ctx as any, (e as any).updates || [], {
          skipCounterModifications: (e as any).skipCounterModifications === true,
          deferRunSBA: (e as any).deferRunSBA === true,
          skipEventPersistence: true,
        });
        break;
      }

      case "createToken": {
        createToken(
          ctx as any,
          (e as any).controller,
          (e as any).name,
          (e as any).count,
          (e as any).basePower,
          (e as any).baseToughness,
          { skipEventPersistence: true },
        );
        break;
      }

      case "removePermanent": {
        removePermanent(ctx as any, (e as any).permanentId);
        break;
      }

      case "dealDamage": {
        // Handle both legacy effects format and new action format
        let effects: any[] = (e as any).effects || [];
        const amount = Math.max(0, Number((e as any).amount ?? 0));
        const targetPermanentId = String((e as any).targetPermanentId || '').trim();
        const targetPlayerId = String((e as any).targetPlayerId || '').trim();
        const sourcePermanentId = String((e as any).sourcePermanentId || (e as any).sourceCreatureId || '').trim();
        const infectWither = inferInfectWitherFlags(ctx as any, {
          sourcePermanentId,
          infect: Boolean((e as any).infect),
          wither: Boolean((e as any).wither),
        });

        if (targetPlayerId && amount > 0) {
          resolvePlayerDamage(ctx as any, {
            targetPlayerId,
            amount,
            isCombatDamage: Boolean((e as any).combatDamage),
            sourcePermanent: infectWither.sourcePermanent || undefined,
            sourceCard: (e as any).sourceCard,
          });
        } else if (targetPermanentId && amount > 0) {
          // Turn-tracking for intervening-if: creature→creature damage relationships for engine-driven damage events.
          // Best-effort: only records when the event explicitly provides a source permanent id and both are creatures.
          try {
            const stateAny = ctx.state as any;
            const targetId = String(targetPermanentId);
            const dmg = amount;

            if (sourcePermanentId && targetId && dmg > 0) {
              const battlefield = (ctx.state as any).battlefield || [];
              const sourcePerm = battlefield.find((p: any) => String(p?.id) === sourcePermanentId);
              const targetPerm = battlefield.find((p: any) => String(p?.id) === targetId);
              const sourceTL = String(sourcePerm?.card?.type_line || '').toLowerCase();
              const targetTL = String(targetPerm?.card?.type_line || '').toLowerCase();
              if (sourcePerm && targetPerm && sourceTL.includes('creature') && targetTL.includes('creature')) {
                stateAny.creaturesDamagedByThisCreatureThisTurn = stateAny.creaturesDamagedByThisCreatureThisTurn || {};
                stateAny.creaturesDamagedByThisCreatureThisTurn[sourcePermanentId] =
                  stateAny.creaturesDamagedByThisCreatureThisTurn[sourcePermanentId] || {};
                stateAny.creaturesDamagedByThisCreatureThisTurn[sourcePermanentId][targetId] = true;
              }
            }
          } catch {
            // best-effort only
          }

          const battlefield = (ctx.state as any).battlefield || [];
          const targetPerm = battlefield.find((p: any) => String(p?.id) === targetPermanentId);
          if (targetPerm && infectWither.sourcePermanent && (infectWither.infect || infectWither.wither)) {
            applyCreatureDamageFromSource(
              ctx as any,
              infectWither.sourcePermanent,
              targetPerm,
              amount,
              'damageMarked',
            );
          } else {
            const action = {
              type: 'DEAL_DAMAGE' as const,
              targetPermanentId,
              amount,
              wither: infectWither.wither,
              infect: infectWither.infect,
            };
            effects = [...evaluateAction(ctx.state, action)];
          }
        }
        
        try {
          applyEngineEffects(ctx as any, effects);
        } catch {}
        try {
          runSBA(ctx as any);
        } catch {}
        break;
      }

      default:
        return false;
  }

  return true;
}
