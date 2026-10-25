// server/src/state/modules/turn-handlers/turnCombatDamageBlockersToAttacker.ts
// Origin parent: turnCombatDamageAttackerLoop.ts (Batch 21 extraction for size).
// Cluster moved: blockers dealing combat damage back to the attacker they block
// (first strike phase filter, prevention, excess-damage tracking, deathtouch/lethal, lifelink).
// Public entry symbols: applyBlockersCombatDamageToAttacker.

import type { GameContext } from "../../context.js";
import type { PlayerID } from "../../../../../shared/src/types.js";
import { parseCreatureKeywords } from "../combat-mechanics.js";
import { applyCreatureCombatDamageFromSource, creatureDiesFromCombatDamage } from "../combat-damage-processing.js";
import { debug, debugError } from "../../../utils/debug.js";
import { applyLifeGainViaProcessLifeChange } from "./turnCombatDamageLifeGain.js";
import { applyCombatDamagePreventionEffects, getCombatCreatureStats } from "./turnCombatDamageStatsPrevention.js";
import { combatDamageAssignmentAmount } from "./turnCombatDamageByToughness.js";
import { combatDamagePreventedThisTurnLogged } from "./turnCombatDamagePreventedThisTurnLog.js";
import { modifyCombatDamageToPermanentAmount } from "./turnCombatDamagePermanentApply.js";
import { queueDamageReceivedTrigger } from "./turnCombatDamageReceivedQueue.js";
import type { DealCombatDamageResult } from "./turnCombatDamageAttackerLoop.js";

function ts() {
  return new Date().toISOString();
}

/** Each blocker of `attacker` deals its combat damage to the attacker (called once per attacker per damage step). */
export function applyBlockersCombatDamageToAttacker(
  ctx: GameContext,
  attacker: any,
  blockedBy: string[],
  battlefield: any[],
  state: any,
  result: DealCombatDamageResult,
  attackerStats: { power: number; toughness: number },
  isFirstStrikePhase?: boolean,
): void {
        const card = attacker.card || {};
        // Blockers deal damage back to attackers
        debug(2, `${ts()} [COMBAT_DAMAGE] Processing ${blockedBy.length} blocker(s) dealing damage to attacker ${card.name || attacker.id}`);
        
        for (const blockerId of blockedBy) {
          debug(2, `${ts()} [COMBAT_DAMAGE] Processing blocker: ${blockerId}`);
          const blocker = battlefield.find((p: any) => p?.id === blockerId);
          if (!blocker) {
            debug(2, `${ts()} [COMBAT_DAMAGE] Blocker ${blockerId} not found on battlefield, skipping`);
            continue;
          }
          
          // Skip blockers that were already killed (e.g., by deathtouch in first strike phase)
          if (blocker.markedForDestruction) {
            debug(2, `${ts()} [COMBAT_DAMAGE] Skipping blocker ${blockerId} - marked for destruction`);
            continue;
          }
          
          const blockerCard = blocker.card || {};
          debug(2, `${ts()} [COMBAT_DAMAGE] Found blocker: ${blockerCard.name || blockerId}, parsing keywords...`);
          
          let blockerKeywords;
          try {
            blockerKeywords = parseCreatureKeywords(blockerCard, blocker, state);
            debug(2, `${ts()} [COMBAT_DAMAGE] Blocker keywords parsed successfully`);
          } catch (err) {
            debugError(1, `${ts()} [COMBAT_DAMAGE] CRASH parsing keywords for blocker ${blockerCard.name || blockerId}:`, err);
            blockerKeywords = {
              flying: false, reach: false, shadow: false, horsemanship: false,
              fear: false, intimidate: false, menace: false, skulk: false,
              unblockable: false, firstStrike: false, doubleStrike: false,
              lifelink: false, deathtouch: false, trample: false, vigilance: false,
              indestructible: false, hexproof: false, shroud: false, haste: false,
              defender: false, cantAttack: false, cantBlock: false,
            };
          }
          
            if (combatDamagePreventedThisTurnLogged(ctx, attacker, blocker)) {
              debug(2, `${ts()} [COMBAT_DAMAGE] Combat damage to attacker ${card.name || attacker.id} was prevented`);
              continue;
            }
          // Calculate effective blocker power including +1/+1 counters, modifiers, and static effects
          const blockerStats = getCombatCreatureStats(ctx, blocker);
          const blockerPower = combatDamageAssignmentAmount(ctx, blocker, blockerStats);
          debug(2, `${ts()} [COMBAT_DAMAGE] Blocker ${blockerCard.name || blockerId} has power ${blockerPower}`);
          
          // Check if this blocker should deal damage in this phase based on first strike rules
          const blockerHasFirstStrike = blockerKeywords.firstStrike || blockerKeywords.doubleStrike;
          
          if (isFirstStrikePhase === true) {
            // First strike phase - only first strike or double strike blockers deal damage
            if (!blockerHasFirstStrike) {
              debug(2, `${ts()} [COMBAT_DAMAGE] Skipping blocker ${blockerCard.name || blockerId} in first strike phase (no first/double strike)`);
              continue;
            }
          } else if (isFirstStrikePhase === false) {
            // Regular damage phase after first strike - skip first strike-only blockers
            // but double strike blockers deal damage again
            if (blockerKeywords.firstStrike && !blockerKeywords.doubleStrike) {
              debug(2, `${ts()} [COMBAT_DAMAGE] Skipping blocker ${blockerCard.name || blockerId} in regular phase (first strike only, already dealt)`);
              continue;
            }
          }
          
          if (blockerPower > 0) {
            const modifiedBlockerDamage = modifyCombatDamageToPermanentAmount(ctx, blockerPower, blocker, attacker);
            const preventionResult = applyCombatDamagePreventionEffects(ctx, modifiedBlockerDamage, String(blocker.id || ''), blockerCard, { targetPermanentId: String(attacker.id || '') });
            const blockerDamageAfterPrevention = preventionResult.remainingDamage;
            if (preventionResult.prevented > 0 && blockerDamageAfterPrevention <= 0) {
              debug(2, `${ts()} [COMBAT_DAMAGE] Combat damage to attacker ${card.name || attacker.id} was prevented`);
              continue;
            }

            // Track excess damage to attacker (best-effort): damage beyond remaining toughness in this event.
            try {
              const stateAny = (ctx as any).state as any;
              const attackerToughnessForExcess = parseInt(String(attacker.baseToughness ?? card.toughness ?? '0'), 10) || 0;
              const prevMarked = attacker.markedDamage || 0;
              const remaining = Math.max(0, attackerToughnessForExcess - prevMarked);
              if (remaining > 0 && blockerDamageAfterPrevention > remaining) {
                stateAny.excessDamageThisTurnByCreatureId = stateAny.excessDamageThisTurnByCreatureId || {};
                stateAny.excessDamageThisTurnByCreatureId[String(attacker.id)] = true;

                // Legacy alias used by some intervening-if templates.
                stateAny.excessDamageThisTurnByPermanentId = stateAny.excessDamageThisTurnByPermanentId || {};
                stateAny.excessDamageThisTurnByPermanentId[String(attacker.id)] = true;
                (attacker as any).wasDealtExcessDamageThisTurn = true;
              }
            } catch {}

            // Deal damage to attacker
            const damageResult = applyCreatureCombatDamageFromSource(
              ctx,
              blocker,
              attacker,
              blockerDamageAfterPrevention,
              'markedDamage',
            );
            if (damageResult.prevented || damageResult.damageReplaced) {
              continue;
            }
            // Track damage dealt to this permanent this turn (for intervening-if clauses).
            attacker.damageThisTurn = (attacker.damageThisTurn || 0) + damageResult.appliedAmount;
            attacker.combatDamageThisTurn = (attacker.combatDamageThisTurn || 0) + damageResult.appliedAmount;
            attacker.tookDamageThisTurn = true;

            // Best-effort: track creature damaged by this creature this turn (for intervening-if templates).
            try {
              const stateAny = (ctx as any).state as any;
              const srcId = String(blocker?.id || '').trim();
              const victimId = String(attacker?.id || '').trim();
              if (srcId && victimId) {
                stateAny.creaturesDamagedByThisCreatureThisTurn = stateAny.creaturesDamagedByThisCreatureThisTurn || {};
                stateAny.creaturesDamagedByThisCreatureThisTurn[srcId] = stateAny.creaturesDamagedByThisCreatureThisTurn[srcId] || {};
                stateAny.creaturesDamagedByThisCreatureThisTurn[srcId][victimId] = true;
              }
            } catch {
              // best-effort only
            }
            
            debug(2, `${ts()} [COMBAT_DAMAGE] Blocker ${blockerCard.name || blockerId} dealt ${damageResult.appliedAmount} damage to attacker ${card.name || attacker.id}`);
            
            // Check for damage-received triggers (Brash Taunter, Boros Reckoner, etc.)
            queueDamageReceivedTrigger(ctx, attacker, damageResult.appliedAmount);
            
            // Check if attacker dies
            const attackerToughness = attackerStats.toughness;
            const totalDamageOnAttacker = attacker.markedDamage || 0;
            const isDead = creatureDiesFromCombatDamage(
              ctx,
              attacker,
              totalDamageOnAttacker,
              blockerKeywords.deathtouch,
              damageResult.usedMinusCounters,
              attackerToughness,
            );
            
            debug(2, `${ts()} [COMBAT_DAMAGE] Attacker ${card.name || attacker.id}: toughness=${attackerToughness}, totalDamage=${totalDamageOnAttacker}, isDead=${isDead}`);
            
            if (isDead && !result.creaturesDestroyed.includes(attacker.id)) {
              result.creaturesDestroyed.push(attacker.id);
              debug(1, `${ts()} [COMBAT_DAMAGE] Attacker ${card.name || attacker.id} received lethal damage`);
            }
            
            // Lifelink for blocker
            if (blockerKeywords.lifelink) {
              const blockerController = blocker.controller;
              const lifeGainResult = applyLifeGainViaProcessLifeChange(ctx, blockerController as PlayerID, damageResult.appliedAmount, `${blockerCard.name || 'Blocker'} (lifelink)`);
              
              result.lifeGainForPlayers[blockerController] = 
                (result.lifeGainForPlayers[blockerController] || 0) + lifeGainResult.actualChange;
              
              debug(2, `${ts()} [COMBAT_DAMAGE] Blocker ${blockerCard.name || blockerId} lifelink: ${lifeGainResult.message}`);
            }
          }
        }
}
