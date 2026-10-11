// server/src/state/modules/turn-handlers/turnCombatDamageAttackerLoop.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: the per-attacker combat-damage assignment loop inside
// dealCombatDamage (unblocked, blocked, trample, first strike skip).
// Public entry symbols: applyDealCombatDamageAttackerLoop.
// Called from dealCombatDamage in the parent; leaf must not import turn.ts
// or turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import type { PlayerID } from "../../../../../shared/src/types.js";
import { drawCards } from "../zones.js";
import { resolveCombatDamageToOpponent } from "../game-state-effects.js";
import { parseCreatureKeywords } from "../combat-mechanics.js";
import {
  applyCreatureCombatDamageFromSource,
  creatureDiesFromCombatDamage,
  resolvePlayerCombatDamage,
} from "../combat-damage-processing.js";
import { debug, debugError } from "../../../utils/debug.js";
import { applyLifeGainViaProcessLifeChange } from "./turnCombatDamageLifeGain.js";
import { applyCombatDamagePreventionEffects, getCombatCreatureStats } from "./turnCombatDamageStatsPrevention.js";
import {
  isCombatDamagePreventedForPermanent,
  modifyCombatDamageToPermanentAmount,
  applyCombatDamageToPlaneswalker,
} from "./turnCombatDamagePermanentApply.js";
import { queueDamageReceivedTrigger } from "./turnCombatDamageReceivedQueue.js";
import { trackCommanderDamage, trackCreatureDamageToPlayer } from "./turnCombatDamageTracking.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

export type DealCombatDamageResult = {
  damageToPlayers: Record<string, number>;
  lifeGainForPlayers: Record<string, number>;
  creaturesDestroyed: string[];
  attackersThatDealtDamage?: Record<string, Set<string>>;
  attackersThatDealtCreatureDamage?: string[];
  attackerDamageToPlayers?: Record<string, Record<string, number>>;
};

/**
 * Per-attacker combat damage assignment from dealCombatDamage.
 * dealCombatDamage remains the dispatcher and supplies shared locals.
 */
export function applyDealCombatDamageAttackerLoop(
  ctx: GameContext,
  attackers: any[],
  battlefield: any[],
  state: any,
  life: Record<string, number>,
  startingLife: number,
  result: DealCombatDamageResult,
  isFirstStrikePhase?: boolean,
): void {
    for (const attacker of attackers) {
      debug(2, `${ts()} [COMBAT_DAMAGE] Processing attacker: ${attacker.card?.name || attacker.id}`);
      
      // Skip creatures that were already killed (e.g., by deathtouch in first strike phase)
      if (attacker.markedForDestruction) {
        debug(2, `${ts()} [COMBAT_DAMAGE] Skipping attacker ${attacker.card?.name || attacker.id} - marked for destruction`);
        continue;
      }
      
      // Get attacker's power and keywords
      const card = attacker.card || {};
      let keywords;
      try {
        keywords = parseCreatureKeywords(card, attacker, state);
      } catch (err) {
        debugError(1, `${ts()} [dealCombatDamage] CRASH parsing keywords for ${card.name || attacker.id}:`, err);
        // Fallback to empty keywords to prevent crash
        keywords = {
          flying: false, reach: false, shadow: false, horsemanship: false,
          fear: false, intimidate: false, menace: false, skulk: false,
          unblockable: false, firstStrike: false, doubleStrike: false,
          lifelink: false, deathtouch: false, trample: false, vigilance: false,
          indestructible: false, hexproof: false, shroud: false, haste: false,
          defender: false, cantAttack: false, cantBlock: false,
        };
      }
      
      // Calculate effective power including +1/+1 counters, modifiers, and static effects
      // This includes anthems, lords, equipment, auras, and enchantments like Leyline of Hope
      const attackerStats = getCombatCreatureStats(ctx, attacker);
      const attackerPower = attackerStats.power;
      debug(2, `${ts()} [dealCombatDamage] ${card?.name || attacker.id} combat stats: power=${attackerStats.power}, toughness=${attackerStats.toughness}`);
      
      const attackerController = attacker.controller;
      const defendingTarget = attacker.attacking; // Player ID or attacked permanent ID
      const defendingPermanent = battlefield.find((perm: any) => perm && String(perm.id || '') === String(defendingTarget || ''));
      const defendingTypeLine = String(defendingPermanent?.card?.type_line || defendingPermanent?.type_line || '').toLowerCase();
      const isPlaneswalkerTarget = defendingTypeLine.includes('planeswalker');
      const isPermanentCombatTarget = Boolean(defendingPermanent);
      
      // Check if this attacker should deal damage in this phase based on first strike rules
      // First strike phase: only first strike and double strike creatures deal damage
      // Regular damage phase: all creatures deal damage EXCEPT first strike-only (they already dealt)
      //   Double strike creatures deal damage in BOTH phases
      const hasFirstStrike = keywords.firstStrike || keywords.doubleStrike;
      let attackerDealsDamageThisPhase = true;
      
      if (isFirstStrikePhase === true) {
        // First strike phase - only first strike or double strike creatures deal damage
        if (!hasFirstStrike) {
          debug(2, `${ts()} [dealCombatDamage] Skipping ${card.name || attacker.id} in first strike phase (no first/double strike)`);
          attackerDealsDamageThisPhase = false;
        }
      } else if (isFirstStrikePhase === false) {
        // Regular damage phase after first strike - skip first strike-only creatures
        // but double strike creatures deal damage again
        if (keywords.firstStrike && !keywords.doubleStrike) {
          debug(2, `${ts()} [dealCombatDamage] Skipping ${card.name || attacker.id} in regular phase (first strike only, already dealt)`);
          attackerDealsDamageThisPhase = false;
        }
      }
      // If isFirstStrikePhase is undefined, this is a normal combat with no first strikers, all creatures deal damage
      
      // Check if this attacker is blocked
      const blockedBy = attacker.blockedBy || [];
      const isBlocked = blockedBy.length > 0;
      const attackerCanAssignDamage = attackerDealsDamageThisPhase && attackerPower > 0;
      
      if (!isBlocked) {
        if (!attackerCanAssignDamage) {
          if (attackerPower <= 0) {
            debug(2, `${ts()} [dealCombatDamage] Skipping ${card.name || attacker.id} - power ${attackerPower} deals no combat damage`);
          }
          continue;
        }

        if (isPlaneswalkerTarget && defendingPermanent) {
          const damageResult = applyCombatDamageToPlaneswalker(ctx, defendingPermanent, attackerPower, card, attacker);

          if (damageResult.appliedAmount > 0) {
            debug(2, `${ts()} [dealCombatDamage] ${card.name || 'Attacker'} dealt ${damageResult.appliedAmount} combat damage to planeswalker ${defendingPermanent.card?.name || defendingPermanent.id} (${damageResult.remainingLoyalty} loyalty remaining)`);

            if (keywords.lifelink) {
              const lifeGainResult = applyLifeGainViaProcessLifeChange(ctx, attackerController as PlayerID, damageResult.appliedAmount, `${card.name || 'Attacker'} (lifelink)`);

              result.lifeGainForPlayers[attackerController] =
                (result.lifeGainForPlayers[attackerController] || 0) + lifeGainResult.actualChange;

              debug(2, `${ts()} [dealCombatDamage] ${card.name || 'Attacker'} lifelink: ${lifeGainResult.message}`);
            }
          } else if (damageResult.prevented) {
            debug(2, `${ts()} [dealCombatDamage] ${card.name || 'Attacker'}'s ${attackerPower} combat damage to planeswalker ${defendingPermanent.card?.name || defendingPermanent.id} was prevented`);
          }
        } else if (!isPermanentCombatTarget && defendingTarget) {
          // UNBLOCKED ATTACKER: Deal damage to defending player
          const defendingPlayerId = defendingTarget;

          const replacementResult = resolveCombatDamageToOpponent(ctx, {
            attackerCard: card,
            attackerPermanent: attacker,
            attackerController,
            damageAmount: attackerPower,
            defendingPlayerId,
          });

          let actualDamage = replacementResult.damageDealt;

          for (const modifier of replacementResult.damageModifiers) {
            debug(2, `${ts()} [dealCombatDamage] ${modifier}`);
          }
          for (const effect of replacementResult.effectsApplied) {
            debug(2, `${ts()} [dealCombatDamage] ${effect}`);
          }

          if (replacementResult.drawAmount && replacementResult.drawTargets) {
            for (const playerId of replacementResult.drawTargets) {
              const drawn = drawCards(ctx, playerId as any, replacementResult.drawAmount);
              debug(1, `${ts()} [dealCombatDamage] ${card.name || 'Attacker'} caused ${playerId} to draw ${drawn.length} card(s)`);
            }
          }
          
          const preventionResult = applyCombatDamagePreventionEffects(ctx, actualDamage, String(attacker.id || ''), card, { targetPlayerId: defendingPlayerId });
          if (preventionResult.prevented > 0) {
            actualDamage = preventionResult.remainingDamage;
          }

          // Deal actual damage (may be 0 if prevented)
          if (actualDamage > 0) {
            const lifeBefore = life[defendingPlayerId] ?? startingLife;
            const resolvedPlayerDamage = resolvePlayerCombatDamage(
              ctx,
              attacker,
              defendingPlayerId,
              actualDamage,
            );
            const effectiveDamage = resolvedPlayerDamage.damageDealt;

            // Track "been dealt combat damage since your last turn".
            // Conservative: only sets true on positive evidence.
            try {
              const stateAny = state as any;
              stateAny.tookCombatDamageSinceLastTurn = stateAny.tookCombatDamageSinceLastTurn || {};
              stateAny.tookCombatDamageSinceLastTurn[String(defendingPlayerId)] = true;
              stateAny.combatDamageDealtToPlayerSinceLastTurn = stateAny.combatDamageDealtToPlayerSinceLastTurn || {};
              stateAny.combatDamageDealtToPlayerSinceLastTurn[String(defendingPlayerId)] = true;
            } catch {}

            // Track damage dealt to each player this turn (for intervening-if clauses like
            // "if an opponent was dealt damage this turn" / "if you were dealt N or more damage this turn").
            try {
              (state as any).damageTakenThisTurnByPlayer = (state as any).damageTakenThisTurnByPlayer || {};
              (state as any).damageTakenThisTurnByPlayer[defendingPlayerId] =
                ((state as any).damageTakenThisTurnByPlayer[defendingPlayerId] || 0) + effectiveDamage;
            } catch {}

            // Track life lost this turn for common oracle checks.
            try {
              if (resolvedPlayerDamage.lifeLost > 0) {
                state.lifeLostThisTurn = state.lifeLostThisTurn || {};
                state.lifeLostThisTurn[defendingPlayerId] =
                  (state.lifeLostThisTurn[defendingPlayerId] || 0) + resolvedPlayerDamage.lifeLost;
              }
            } catch {}
            
            result.damageToPlayers[defendingPlayerId] = 
              (result.damageToPlayers[defendingPlayerId] || 0) + effectiveDamage;
            
            // Track which attacker dealt damage to which player (for batched triggers)
            if (!result.attackersThatDealtDamage[defendingPlayerId]) {
              result.attackersThatDealtDamage[defendingPlayerId] = new Set();
            }
            result.attackersThatDealtDamage[defendingPlayerId].add(attacker.id);
            result.attackerDamageToPlayers[defendingPlayerId] = result.attackerDamageToPlayers[defendingPlayerId] || {};
            result.attackerDamageToPlayers[defendingPlayerId][attacker.id] =
              (result.attackerDamageToPlayers[defendingPlayerId][attacker.id] || 0) + effectiveDamage;
            
            const currentLife = life[defendingPlayerId] ?? startingLife;
            debug(2, `${ts()} [dealCombatDamage] ${card.name || 'Attacker'} dealt ${effectiveDamage} combat damage to ${defendingPlayerId} (${lifeBefore} -> ${currentLife}, poison +${resolvedPlayerDamage.poisonAdded})`);
            
            // Track commander damage (Rule 903.10a)
            trackCommanderDamage(ctx, attackerController, card, attacker, defendingPlayerId, effectiveDamage);
            
            // Track that this creature dealt damage to this player this turn
            // This is used for cards like Reciprocate that can only target creatures that dealt damage to you
            trackCreatureDamageToPlayer(ctx, attacker.id, card.name || 'Unknown Creature', defendingPlayerId, effectiveDamage);
            
            // Track combat damage for X abilities that require it
            // Generic tracking for any card with oracle text containing "combat damage"
            const oracleText = (card.oracle_text || '').toLowerCase();
            if (oracleText.includes('{x}') && oracleText.includes('combat damage')) {
              // Initialize or update the set of players dealt damage this turn
              let dealtDamageTo = (attacker as any).dealtCombatDamageTo as Set<string> | undefined;
              if (!dealtDamageTo) {
                dealtDamageTo = new Set<string>();
                (attacker as any).dealtCombatDamageTo = dealtDamageTo;
              }
              dealtDamageTo.add(defendingPlayerId);
              debug(3, `${ts()} [dealCombatDamage] ${card.name || 'Creature'} tracked combat damage to player ${defendingPlayerId} (for X ability)`);
            }
            
            // Lifelink: Controller gains life equal to damage dealt
            if (keywords.lifelink) {
              const lifeGainResult = applyLifeGainViaProcessLifeChange(ctx, attackerController as PlayerID, effectiveDamage, `${card.name || 'Attacker'} (lifelink)`);
              
              result.lifeGainForPlayers[attackerController] = 
                (result.lifeGainForPlayers[attackerController] || 0) + lifeGainResult.actualChange;
              
              debug(2, `${ts()} [dealCombatDamage] ${card.name || 'Attacker'} lifelink: ${lifeGainResult.message}`);
            }
            
            // Check for auras that grant life gain on combat damage (Spirit Loop, etc.)
            // Pattern: "Whenever enchanted creature deals damage to a player, you gain life equal to that damage."
            const attachedAuras = battlefield.filter((p: any) => 
              p?.attachedTo === attacker.id && 
              (p.card?.type_line || '').toLowerCase().includes('aura')
            );
            
            for (const aura of attachedAuras) {
              const auraOracle = (aura.card?.oracle_text || '').toLowerCase();
              const auraName = (aura.card?.name || '').toLowerCase();
              
              // Spirit Loop and similar: "Whenever enchanted creature deals damage to a player, you gain life equal to that damage."
              if ((auraName.includes('spirit loop') || 
                   (auraOracle.includes('enchanted creature deals') && auraOracle.includes('damage to') && 
                    auraOracle.includes('gain life equal')))) {
                const auraController = aura.controller || attackerController;
                const lifeGainResult = applyLifeGainViaProcessLifeChange(ctx, auraController as PlayerID, effectiveDamage, aura.card?.name || 'Aura');
                
                result.lifeGainForPlayers[auraController] = 
                  (result.lifeGainForPlayers[auraController] || 0) + lifeGainResult.actualChange;
                
                debug(2, `${ts()} [dealCombatDamage] ${aura.card?.name || 'Aura'}: ${lifeGainResult.message}`);
              }
            }
          } else if (replacementResult.prevented || preventionResult.prevented > 0) {
            debug(2, `${ts()} [dealCombatDamage] ${card.name || 'Attacker'}'s ${attackerPower} combat damage was prevented`);
          }
        }
      } else {
        if (attackerCanAssignDamage) {
          // BLOCKED ATTACKER: Deal damage to blockers
          let remainingDamage = attackerPower;
          
          for (let blockerIndex = 0; blockerIndex < blockedBy.length; blockerIndex++) {
            const blockerId = blockedBy[blockerIndex];
            const isLastBlocker = blockerIndex === blockedBy.length - 1;
            const blocker = battlefield.find((p: any) => p?.id === blockerId);
            if (!blocker) continue;
            
            const blockerCard = blocker.card || {};
            const blockerStats = getCombatCreatureStats(ctx, blocker);
            const blockerToughness = blockerStats.toughness;
            const blockerDamage = blocker.markedDamage || 0;
            const remainingToughness = Math.max(0, blockerToughness - blockerDamage);
            
            // Calculate damage to assign to this blocker
            // MTG Rule 510.1c: When assigning damage, attacker must assign at least lethal damage
            // to each blocker in order before moving to the next (unless attacker has deathtouch,
            // in which case 1 damage counts as lethal for assignment purposes)
            // 
            // DEATHTOUCH + TRAMPLE INTERACTION (Rule 702.2b + 702.19c):
            // When a creature has both deathtouch and trample, it only needs to assign 1 damage
            // to each blocker (since that's lethal with deathtouch), and all excess tramples through.
            let lethalDamage: number;
            if (keywords.deathtouch) {
              // With deathtouch, 1 damage is considered lethal for damage assignment
              // If blocker already has lethal damage marked, no need to assign more
              lethalDamage = remainingToughness > 0 ? 1 : 0;
            } else {
              // Without deathtouch, need to assign enough to kill (remaining toughness)
              lethalDamage = remainingToughness;
            }
            
            // CR 510.1c: earlier blockers get lethal before any later blocker is assigned damage.
            // Trample may stop at lethal and send the excess to the player or planeswalker.
            // Without trample the last blocker is assigned every remaining point, including
            // damage above its toughness (a 7/7 blocked by a 1/1 deals 7).
            const assignAllRemainingToBlocker = !keywords.trample && isLastBlocker;
            if (lethalDamage <= 0 && !assignAllRemainingToBlocker) {
              debug(1, `${ts()} [dealCombatDamage] Blocker ${blockerCard.name || blockerId} already has lethal damage, skipping`);
              continue;
            }

            const damageToBlocker = assignAllRemainingToBlocker
              ? remainingDamage
              : Math.min(lethalDamage, remainingDamage);
            
            if (damageToBlocker > 0) {
              if (isCombatDamagePreventedForPermanent(blocker)) {
                remainingDamage -= damageToBlocker;
                debug(2, `${ts()} [dealCombatDamage] Combat damage to blocker ${blockerCard.name || blockerId} was prevented`);
                continue;
              }
              // Assignment uses power; replacements apply when the assigned amount would be dealt.
              const modifiedDamageToBlocker = modifyCombatDamageToPermanentAmount(ctx, damageToBlocker, attacker, blocker);
              const preventionResult = applyCombatDamagePreventionEffects(ctx, modifiedDamageToBlocker, String(attacker.id || ''), card, { targetPermanentId: String(blocker.id || '') });
              const damageToBlockerAfterPrevention = preventionResult.remainingDamage;
              if (preventionResult.prevented > 0 && damageToBlockerAfterPrevention <= 0) {
                remainingDamage -= damageToBlocker;
                debug(2, `${ts()} [dealCombatDamage] Combat damage to blocker ${blockerCard.name || blockerId} was prevented`);
                continue;
              }
              const damageResult = applyCreatureCombatDamageFromSource(
                ctx,
                attacker,
                blocker,
                damageToBlockerAfterPrevention,
                'markedDamage',
              );
              if (damageResult.damageReplaced) {
                remainingDamage -= damageToBlocker;
                continue;
              }
              if (damageResult.prevented) {
                continue;
              }
              // Track damage dealt to this permanent this turn (for intervening-if clauses).
              blocker.damageThisTurn = (blocker.damageThisTurn || 0) + damageResult.appliedAmount;
              result.attackersThatDealtCreatureDamage = result.attackersThatDealtCreatureDamage || [];
              if (!result.attackersThatDealtCreatureDamage.includes(String(attacker.id))) {
                result.attackersThatDealtCreatureDamage.push(String(attacker.id));
              }
              blocker.combatDamageThisTurn = (blocker.combatDamageThisTurn || 0) + damageResult.appliedAmount;
              blocker.tookDamageThisTurn = true;

              // Best-effort: track creature damaged by this creature this turn (for intervening-if templates).
              try {
                const stateAny = (ctx as any).state as any;
                const srcId = String(attacker?.id || '').trim();
                const victimId = String(blocker?.id || '').trim();
                if (srcId && victimId) {
                  stateAny.creaturesDamagedByThisCreatureThisTurn = stateAny.creaturesDamagedByThisCreatureThisTurn || {};
                  stateAny.creaturesDamagedByThisCreatureThisTurn[srcId] = stateAny.creaturesDamagedByThisCreatureThisTurn[srcId] || {};
                  stateAny.creaturesDamagedByThisCreatureThisTurn[srcId][victimId] = true;
                }
              } catch {
                // best-effort only
              }
              remainingDamage -= damageToBlocker;
              
              debug(2, `${ts()} [dealCombatDamage] ${card.name || 'Attacker'} dealt ${damageResult.appliedAmount} damage to blocker ${blockerCard.name || blockerId}`);
              
              // Check for damage-received triggers (Brash Taunter, Boros Reckoner, etc.)
              queueDamageReceivedTrigger(ctx, blocker, damageResult.appliedAmount);
              
              // Check if blocker dies
              const totalDamageOnBlocker = blocker.markedDamage || 0;
              const isDead = creatureDiesFromCombatDamage(
                ctx,
                blocker,
                totalDamageOnBlocker,
                keywords.deathtouch,
                damageResult.usedMinusCounters,
                blockerToughness,
              );
              
              if (isDead) {
                result.creaturesDestroyed.push(blockerId);
                debug(1, `${ts()} [dealCombatDamage] Blocker ${blockerCard.name || blockerId} received lethal damage`);
              }
              
              // Lifelink for damage dealt to blocker
              if (keywords.lifelink) {
                const lifeGainResult = applyLifeGainViaProcessLifeChange(ctx, attackerController as PlayerID, damageResult.appliedAmount, `${card.name || 'Attacker'} (lifelink)`);
                
                result.lifeGainForPlayers[attackerController] = 
                  (result.lifeGainForPlayers[attackerController] || 0) + lifeGainResult.actualChange;
              }
            }
            
            if (remainingDamage <= 0 && !keywords.trample) break;
          }
          
          // Trample: Excess damage goes to defending player or planeswalker
          if (keywords.trample && remainingDamage > 0) {
            if (isPlaneswalkerTarget && defendingPermanent) {
              const damageResult = applyCombatDamageToPlaneswalker(ctx, defendingPermanent, remainingDamage, card, attacker);

              if (damageResult.appliedAmount > 0) {
                debug(2, `${ts()} [dealCombatDamage] ${card.name || 'Attacker'} trample: dealt ${damageResult.appliedAmount} excess damage to planeswalker ${defendingPermanent.card?.name || defendingPermanent.id} (${damageResult.remainingLoyalty} loyalty remaining)`);

                if (keywords.lifelink) {
                  const lifeGainResult = applyLifeGainViaProcessLifeChange(ctx, attackerController as PlayerID, damageResult.appliedAmount, `${card.name || 'Attacker'} (lifelink trample)`);

                  result.lifeGainForPlayers[attackerController] =
                    (result.lifeGainForPlayers[attackerController] || 0) + lifeGainResult.actualChange;
                }
              } else if (damageResult.prevented) {
                debug(2, `${ts()} [dealCombatDamage] ${card.name || 'Attacker'}'s ${remainingDamage} trample damage to planeswalker ${defendingPermanent.card?.name || defendingPermanent.id} was prevented`);
              }
            } else if (!isPermanentCombatTarget && defendingTarget) {
              const defendingPlayerId = defendingTarget;
              const trampleReplacement = resolveCombatDamageToOpponent(ctx, {
                attackerCard: card,
                attackerPermanent: attacker,
                attackerController,
                damageAmount: remainingDamage,
                defendingPlayerId,
              });
              for (const modifier of trampleReplacement.damageModifiers) {
                debug(2, `${ts()} [dealCombatDamage] ${modifier}`);
              }
              for (const effect of trampleReplacement.effectsApplied) {
                debug(2, `${ts()} [dealCombatDamage] ${effect}`);
              }

              const preventionResult = applyCombatDamagePreventionEffects(
                ctx,
                trampleReplacement.damageDealt,
                String(attacker.id || ''),
                card,
                { targetPlayerId: defendingPlayerId }
              );
              const trampleDamageToPlayer = preventionResult.remainingDamage;
              if (preventionResult.prevented > 0 && trampleDamageToPlayer <= 0) {
                debug(2, `${ts()} [dealCombatDamage] ${card.name || 'Attacker'}'s ${remainingDamage} trample damage to ${defendingPlayerId} was prevented`);
                continue;
              }

              const lifeBeforeTrample = life[defendingPlayerId] ?? startingLife;
              const resolvedTrampleDamage = resolvePlayerCombatDamage(
                ctx,
                attacker,
                defendingPlayerId,
                trampleDamageToPlayer,
              );
              const effectiveTrampleDamage = resolvedTrampleDamage.damageDealt;

              // Track damage dealt to each player this turn.
              try {
                (state as any).damageTakenThisTurnByPlayer = (state as any).damageTakenThisTurnByPlayer || {};
                (state as any).damageTakenThisTurnByPlayer[defendingPlayerId] =
                  ((state as any).damageTakenThisTurnByPlayer[defendingPlayerId] || 0) + effectiveTrampleDamage;
              } catch {}

              // Track life lost this turn for common oracle checks.
              try {
                if (resolvedTrampleDamage.lifeLost > 0) {
                  state.lifeLostThisTurn = state.lifeLostThisTurn || {};
                  state.lifeLostThisTurn[defendingPlayerId] =
                    (state.lifeLostThisTurn[defendingPlayerId] || 0) + resolvedTrampleDamage.lifeLost;
                }
              } catch {}
              
              result.damageToPlayers[defendingPlayerId] = 
                (result.damageToPlayers[defendingPlayerId] || 0) + effectiveTrampleDamage;
              
              // Track which attacker dealt damage to which player (for batched triggers)
              if (!result.attackersThatDealtDamage[defendingPlayerId]) {
                result.attackersThatDealtDamage[defendingPlayerId] = new Set();
              }
              result.attackersThatDealtDamage[defendingPlayerId].add(attacker.id);
              result.attackerDamageToPlayers[defendingPlayerId] = result.attackerDamageToPlayers[defendingPlayerId] || {};
              result.attackerDamageToPlayers[defendingPlayerId][attacker.id] =
                (result.attackerDamageToPlayers[defendingPlayerId][attacker.id] || 0) + effectiveTrampleDamage;
              
              debug(2, `${ts()} [dealCombatDamage] ${card.name || 'Attacker'} trample: dealt ${effectiveTrampleDamage} excess damage to ${defendingPlayerId} (${lifeBeforeTrample} -> ${life[defendingPlayerId] ?? startingLife}, poison +${resolvedTrampleDamage.poisonAdded})`);
              
              // Track commander trample damage (Rule 903.10a)
              trackCommanderDamage(ctx, attackerController, card, attacker, defendingPlayerId, effectiveTrampleDamage);
              
              // Track that this creature dealt damage to this player this turn (for Reciprocate-style effects)
              trackCreatureDamageToPlayer(ctx, attacker.id, card.name || 'Unknown Creature', defendingPlayerId, effectiveTrampleDamage);
              
              // Lifelink for trample damage
              if (keywords.lifelink) {
                const lifeGainResult = applyLifeGainViaProcessLifeChange(ctx, attackerController as PlayerID, effectiveTrampleDamage, `${card.name || 'Attacker'} (lifelink trample)`);
                
                result.lifeGainForPlayers[attackerController] = 
                  (result.lifeGainForPlayers[attackerController] || 0) + lifeGainResult.actualChange;
              }
            }
          }
        } else if (attackerPower <= 0) {
          debug(2, `${ts()} [dealCombatDamage] ${card.name || attacker.id} is blocked but assigns no combat damage because power is ${attackerPower}`);
        }
        
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
          
            if (isCombatDamagePreventedForPermanent(attacker)) {
              debug(2, `${ts()} [COMBAT_DAMAGE] Combat damage to attacker ${card.name || attacker.id} was prevented`);
              continue;
            }
          // Calculate effective blocker power including +1/+1 counters, modifiers, and static effects
          const blockerStats = getCombatCreatureStats(ctx, blocker);
          const blockerPower = blockerStats.power;
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
    }
}
