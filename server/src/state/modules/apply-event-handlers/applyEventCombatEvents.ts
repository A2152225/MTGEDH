// server/src/state/modules/apply-event-handlers/applyEventCombatEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Attacker/blocker declaration (including controlled variants) and fight effects.
// Public entry: applyCombatEvents(ctx, e) -> true when it handled the event.
//
// Handles: declareAttackers, declareControlledAttackers, declareBlockers, declareControlledBlockers, fight
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { movePermanentToGraveyard, runSBA } from "../counters_tokens";
import { permanentHasKeyword } from "../keyword-handlers";
import { clearReplayQueuedSteps } from "../applyEventReplayZoneCommanderManaHelpers.js";
import { debug, debugWarn } from "../../../utils/debug.js";
import { dispatchDamageReceivedTrigger, processDamageReceivedTriggers } from "../triggers/damage-received.js";
import { ResolutionStepType } from "../../resolution/index.js";
import { getOrInitManaPool } from "../../../socket/util.js";
import { applyFightDamageBetweenCreatures } from "../combat-damage-processing.js";

export function applyCombatEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "declareAttackers":
      case "declareControlledAttackers": {
        // Set attackers for combat
        const attackers = ((e as any).attackers as any[]) || [];
        try {
          const battlefield = ctx.state.battlefield || [];
          const playerId = String((e as any).playerId || "").trim();

          if ((e as any).attackCostPaid === true) {
            const replayGameId = String((ctx as any).gameId || '').trim();
            if (replayGameId) {
              clearReplayQueuedSteps(replayGameId, (step: any) => {
                if (!step) return false;
                return (
                  String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                  (step as any)?.attackCostPayment === true &&
                  (!playerId || String((step as any)?.playerId || '').trim() === playerId)
                );
              });
            }
          }

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

          // Best-effort combat trackers consumed by intervening-if.
          try {
            const stateAny = ctx.state as any;
            if (playerId) {
              stateAny.attackedPlayersThisTurnByPlayer = stateAny.attackedPlayersThisTurnByPlayer || {};
              stateAny.attackedPlayersThisTurnByPlayer[playerId] = Array.isArray(stateAny.attackedPlayersThisTurnByPlayer[playerId])
                ? stateAny.attackedPlayersThisTurnByPlayer[playerId]
                : [];

              stateAny.attackedDefendingPlayersThisCombatByPlayer = stateAny.attackedDefendingPlayersThisCombatByPlayer || {};
              // Reset per-combat (not per-turn) so extra combats are evaluated correctly.
              stateAny.attackedDefendingPlayersThisCombatByPlayer[playerId] = [];
            }
            stateAny.mustAttackThisCombatByPermanentId = {};

            // Per-combat tracker used by intervening-if templates like
            // "if this creature attacked or blocked this combat".
            stateAny.attackedOrBlockedThisCombatByPermanentId = {};

            // Per-combat snapshot used by intervening-if templates like
            // "if a Pirate and a Vehicle attacked this combat".
            {
              const players = Array.isArray((ctx.state as any)?.players) ? ((ctx.state as any).players as any[]) : [];
              const ids = players
                .map((p: any) => String(p?.id ?? p?.playerId ?? '').trim())
                .filter((id: string) => Boolean(id));

              // Reset per-combat snapshots so extra combats are evaluated correctly.
              stateAny.attackersDeclaredThisCombatByPlayer = {};
              stateAny.blockersDeclaredThisCombatByPlayer = {};
              for (const pid of ids) {
                stateAny.attackersDeclaredThisCombatByPlayer[pid] = [];
                stateAny.blockersDeclaredThisCombatByPlayer[pid] = [];
              }
              if (playerId && !stateAny.attackersDeclaredThisCombatByPlayer[playerId]) stateAny.attackersDeclaredThisCombatByPlayer[playerId] = [];
              if (playerId && !stateAny.blockersDeclaredThisCombatByPlayer[playerId]) stateAny.blockersDeclaredThisCombatByPlayer[playerId] = [];
            }

            // Per-turn tracker used by intervening-if templates like
            // "if no creatures attacked this turn".
            stateAny.creaturesAttackedThisTurn = stateAny.creaturesAttackedThisTurn || {};

            for (const atk of attackers) {
              const attackerId = String(atk?.attackerId || atk?.creatureId || "").trim();
              if (!attackerId) continue;

              // Track who was attacked (player-only, not planeswalkers).
              const targetPlayerId = String(atk?.defendingPlayer || atk?.defendingPlayerId || atk?.targetPlayerId || "").trim();
              if (playerId && targetPlayerId) {
                const list: string[] = stateAny.attackedPlayersThisTurnByPlayer[playerId];
                if (Array.isArray(list) && !list.includes(targetPlayerId)) list.push(targetPlayerId);
              }

              // Track who is being attacked as the defending player for this combat.
              // Includes planeswalker/battle targets by resolving their controller.
              if (playerId) {
                const list: string[] = stateAny.attackedDefendingPlayersThisCombatByPlayer?.[playerId];
                if (Array.isArray(list)) {
                  let defendingPid = targetPlayerId;
                  if (!defendingPid) {
                    const targetPermId = String(atk?.targetPermanentId || "").trim();
                    if (targetPermId) {
                      const targetPerm = battlefield.find((p: any) => p?.id === targetPermId);
                      const targetController = String((targetPerm as any)?.controller || '').trim();
                      if (targetController) defendingPid = targetController;
                    }
                  }
                  if (defendingPid && !list.includes(defendingPid)) list.push(defendingPid);
                }
              }

              const perm = battlefield.find((p: any) => p?.id === attackerId);
              if (!perm) continue;

              // Per-combat marker for this attacker.
              stateAny.attackedOrBlockedThisCombatByPermanentId[attackerId] = true;

              // Per-combat snapshot entry for this attacker.
              if (playerId && Array.isArray(stateAny.attackersDeclaredThisCombatByPlayer?.[playerId])) {
                stateAny.attackersDeclaredThisCombatByPlayer[playerId].push({
                  id: attackerId,
                  name: String((perm as any)?.card?.name ?? (perm as any)?.name ?? ''),
                  type_line: String((perm as any)?.card?.type_line ?? ''),
                });
              }

              // Track "they were attacked this turn by an Assassin you controlled".
              // Conservative: only set true on positive evidence.
              try {
                const tl = String((perm as any)?.card?.type_line || '').toLowerCase();
                if (tl && /\bassassin\b/i.test(tl) && playerId) {
                  let defendingPid = targetPlayerId;
                  if (!defendingPid) {
                    const targetPermId = String(atk?.targetPermanentId || "").trim();
                    if (targetPermId) {
                      const targetPerm = battlefield.find((p: any) => p?.id === targetPermId);
                      const targetController = String((targetPerm as any)?.controller || '').trim();
                      if (targetController) defendingPid = targetController;
                    }
                  }
                  if (defendingPid) {
                    stateAny.attackedByAssassinThisTurnByPlayer = stateAny.attackedByAssassinThisTurnByPlayer || {};
                    stateAny.attackedByAssassinThisTurnByPlayer[playerId] = stateAny.attackedByAssassinThisTurnByPlayer[playerId] || {};
                    stateAny.attackedByAssassinThisTurnByPlayer[playerId][defendingPid] = true;
                  }
                }
              } catch {
                // best-effort only
              }

              // Track whether this attacker was under a must-attack requirement this combat.
              // Conservative: only mark `true` on positive evidence.
              const isForced =
                Boolean((perm as any).mustAttackEachCombat) ||
                Boolean((perm as any).mustAttack) ||
                (Array.isArray((perm as any).goadedBy) && (perm as any).goadedBy.length > 0) ||
                (typeof (perm as any).goaded === 'object' && (perm as any).goaded !== null && Object.keys((perm as any).goaded).length > 0);
              if (isForced) {
                stateAny.mustAttackThisCombatByPermanentId[attackerId] = true;
              }
            }
          } catch {
            // best-effort only
          }

          // Clear previous attackers
          for (const perm of battlefield) {
            if (perm) (perm as any).attacking = undefined;
          }
          // Set new attackers
          for (const atk of attackers) {
            const attackerId = String((atk as any)?.attackerId || (atk as any)?.creatureId || "").trim();
            if (!attackerId) continue;
            const perm = battlefield.find((p: any) => p.id === attackerId);
            if (perm) {
              const defendingPlayer = (atk as any)?.defendingPlayer || (atk as any)?.defendingPlayerId || (atk as any)?.targetPlayerId;
              const targetPermanentId = (atk as any)?.targetPermanentId;
              (perm as any).attacking = defendingPlayer || targetPermanentId || true;

              // Match live combat: mark that this permanent attacked this turn.
              (perm as any).attackedThisTurn = true;

              // Track total creatures attacked this turn for the attacking player.
              try {
                const stateAny = ctx.state as any;
                const attackerPid = String((e as any).playerId || '').trim();
                if (attackerPid) {
                  stateAny.creaturesAttackedThisTurn = stateAny.creaturesAttackedThisTurn || {};
                  stateAny.creaturesAttackedThisTurn[attackerPid] = (stateAny.creaturesAttackedThisTurn[attackerPid] || 0) + 1;
                }
              } catch {
                /* ignore */
              }

              // Attacking creatures tap unless they have vigilance.
              // Keep replay deterministic and aligned with live combat logic.
              const hasVigilance = permanentHasKeyword(perm, 'vigilance');
              if (!hasVigilance) {
                (perm as any).tapped = true;
                try {
                  const attackerPid = String((e as any).playerId || '').trim();
                  if (attackerPid) {
                    const stateAny = ctx.state as any;
                    stateAny.tappedNonlandPermanentThisTurnByPlayer = stateAny.tappedNonlandPermanentThisTurnByPlayer || {};
                    stateAny.tappedNonlandPermanentThisTurnByPlayer[attackerPid] = true;
                  }
                } catch {
                  /* ignore */
                }
              }
            }
          }
          if (playerId) {
            const stateAny = ctx.state as any;
            stateAny.attackersDeclaredBy = Array.isArray(stateAny.attackersDeclaredBy) ? stateAny.attackersDeclaredBy : [];
            if (!stateAny.attackersDeclaredBy.includes(playerId)) {
              stateAny.attackersDeclaredBy.push(playerId);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(declareAttackers): failed", err);
        }
        break;
      }

      case "declareBlockers":
      case "declareControlledBlockers": {
        // Set blockers for combat
        const blockers = (e as any).blockers as Array<{ blockerId: string; attackerId: string }> || [];
        try {
          const battlefield = ctx.state.battlefield || [];
          const stateAny = ctx.state as any;
          const playerId = String((e as any).playerId || '').trim();

          stateAny.attackedOrBlockedThisCombatByPermanentId = stateAny.attackedOrBlockedThisCombatByPermanentId || {};

          // Clear only THIS player's prior blocker assignments so multiplayer
          // declareBlockers / replay cannot wipe other defenders' blocks.
          if (playerId) {
            for (const perm of battlefield) {
              if (!perm) continue;
              if (String(perm.controller || '') === playerId) {
                (perm as any).blocking = undefined;
              }
            }
            for (const attacker of battlefield) {
              if (!attacker || !Array.isArray((attacker as any).blockedBy)) continue;
              const remaining = ((attacker as any).blockedBy as string[]).filter((blockerId) => {
                const blocker = battlefield.find((p: any) => p && String(p.id || '') === String(blockerId || ''));
                return blocker && String(blocker.controller || '') !== playerId;
              });
              (attacker as any).blockedBy = remaining.length > 0 ? remaining : undefined;
            }
          } else {
            for (const perm of battlefield) {
              if (perm) {
                (perm as any).blocking = undefined;
                (perm as any).blockedBy = undefined;
              }
            }
          }
          // Set new blockers
          for (const blk of blockers) {
            const blocker = battlefield.find((p: any) => p.id === blk.blockerId);
            const attacker = battlefield.find((p: any) => p.id === blk.attackerId);
            if (blocker) {
              (blocker as any).blocking = blk.attackerId;

              // Intervening-if support: blocker "blocked this turn" and "attacked or blocked this combat".
              (blocker as any).blockedThisTurn = true;
              stateAny.attackedOrBlockedThisCombatByPermanentId[String(blk.blockerId)] = true;

              // Per-combat snapshot entry for this blocker.
              if (playerId) {
                stateAny.blockersDeclaredThisCombatByPlayer = stateAny.blockersDeclaredThisCombatByPlayer || {};
                stateAny.blockersDeclaredThisCombatByPlayer[playerId] = Array.isArray(stateAny.blockersDeclaredThisCombatByPlayer[playerId])
                  ? stateAny.blockersDeclaredThisCombatByPlayer[playerId]
                  : [];
                const list = stateAny.blockersDeclaredThisCombatByPlayer[playerId];
                const bid = String(blk.blockerId || '').trim();
                if (bid && !list.some((e: any) => String(e?.id ?? e?.creatureId ?? e).trim() === bid)) {
                  list.push({
                    id: bid,
                    name: String((blocker as any)?.card?.name ?? (blocker as any)?.name ?? ''),
                    type_line: String((blocker as any)?.card?.type_line ?? ''),
                  });
                }
              }
            }
            if (attacker) {
              (attacker as any).blockedBy = (attacker as any).blockedBy || [];
              (attacker as any).blockedBy.push(blk.blockerId);

              // Intervening-if support: attacker "was blocked this turn".
              (attacker as any).wasBlockedThisTurn = true;
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(declareBlockers): failed", err);
        }
        break;
      }

      case "fight": {
        // Two creatures fight - each deals damage to the other equal to their power
        const sourceId = (e as any).sourceId;
        const targetId = (e as any).targetId;
        const sourcePower = (e as any).sourcePower;
        const targetPower = (e as any).targetPower;
        
        try {
          const battlefield = ctx.state.battlefield || [];
          const source = battlefield.find((p: any) => p.id === sourceId);
          const target = battlefield.find((p: any) => p.id === targetId);
          
          if (source && target) {
            // Best-effort per-turn damage tracking for intervening-if clauses.
            try {
              const stateAny = ctx.state as any;
              const srcId = String(sourceId || '').trim();
              const tgtId = String(targetId || '').trim();
              if (srcId && tgtId) {
                stateAny.creaturesDamagedByThisCreatureThisTurn = stateAny.creaturesDamagedByThisCreatureThisTurn || {};
                stateAny.creaturesDamagedByThisCreatureThisTurn[srcId] = stateAny.creaturesDamagedByThisCreatureThisTurn[srcId] || {};
                stateAny.creaturesDamagedByThisCreatureThisTurn[srcId][tgtId] = true;
                stateAny.creaturesDamagedByThisCreatureThisTurn[tgtId] = stateAny.creaturesDamagedByThisCreatureThisTurn[tgtId] || {};
                stateAny.creaturesDamagedByThisCreatureThisTurn[tgtId][srcId] = true;
              }
            } catch {
              // best-effort only
            }

            applyFightDamageBetweenCreatures(
              ctx as any,
              source,
              Math.max(0, Number(sourcePower || 0)),
              target,
              Math.max(0, Number(targetPower || 0)),
              'damageMarked',
            );

            const queueDamageTrigger = (perm: any, damageAmount: number) => {
              processDamageReceivedTriggers(ctx as any, perm, damageAmount, (triggerInfo) => {
                if (dispatchDamageReceivedTrigger(ctx as any, triggerInfo)) {
                  return;
                }

                const stateAny = ctx.state as any;
                stateAny.pendingDamageTriggers = stateAny.pendingDamageTriggers || {};
                stateAny.pendingDamageTriggers[triggerInfo.triggerId] = {
                  sourceId: triggerInfo.sourceId,
                  sourceName: triggerInfo.sourceName,
                  controller: triggerInfo.controller,
                  damageAmount: triggerInfo.damageAmount,
                  triggerType: 'dealt_damage',
                  targetType: triggerInfo.targetType,
                  effect: triggerInfo.effect,
                  ...(triggerInfo.effectMode ? { effectMode: triggerInfo.effectMode } : {}),
                  ...(triggerInfo.attackingPlayerId ? { attackingPlayerId: triggerInfo.attackingPlayerId } : {}),
                  ...(triggerInfo.targetRestriction ? { targetRestriction: triggerInfo.targetRestriction } : {}),
                };
              });
            };

            queueDamageTrigger(source, targetPower);
            queueDamageTrigger(target, sourcePower);
            
            // Run SBA to check for lethal damage
            try {
              runSBA(ctx as any);
            } catch (sbaErr) {
              // SBA may not be available during replay - this is expected
              debug(1, "applyEvent(fight): SBA skipped during replay:", sbaErr);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(fight): failed", err);
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
