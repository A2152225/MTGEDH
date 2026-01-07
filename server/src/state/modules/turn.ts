// server/src/state/modules/turn.ts
// Turn / priority helpers used by server state. Full-file defensive implementation.
// Exports:
//  - passPriority(ctx, playerId)
//  - setTurnDirection(ctx, dir)
//  - nextTurn(ctx)
//  - nextStep(ctx)
//  - scheduleStepsAfterCurrent(ctx, steps)
//  - scheduleStepsAtEndOfTurn(ctx, steps)
//  - clearScheduledSteps(ctx)
//  - getScheduledSteps(ctx)
//  - removeScheduledSteps(ctx, steps)
//
// This implementation is intentionally defensive: it tolerates missing ctx fields,
// ensures ctx.seq exists, and avoids throwing when replaying older event streams.

import type { GameContext } from "../context.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { drawCards } from "./zones.js";
import { recalculatePlayerEffects, applyCombatDamageReplacement, clearTemporaryLandBonuses } from "./game-state-effects.js";
import { 
  getBeginningOfCombatTriggers, 
  getEndStepTriggers, 
  getDrawStepTriggers,
  getEndOfCombatTriggers,
  getUntapStepEffects,
  applyUntapStepEffect,
  isPermanentPreventedFromUntapping,
  detectCombatDamageTriggers,
  getTriggersForTiming,
  checkDamageReceivedTrigger
} from "./triggered-abilities.js";
import { processDamageReceivedTriggers } from "./triggers/damage-received.js";
import { getUpkeepTriggersForPlayer, autoProcessCumulativeUpkeepMana } from "./upkeep-triggers.js";
import { parseCreatureKeywords } from "./combat-mechanics.js";
import { runSBA, createToken } from "./counters_tokens.js";
import { calculateAllPTBonuses, parsePT, uid, applyLifeGain } from "../utils.js";
import { canAct, canRespond } from "./can-respond.js";
import { removeExpiredGoads } from "./goad-effects.js";
import { tryAutoPass } from "./priority.js";
import { ResolutionQueueManager } from "../resolution/index.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

/**
 * Queue a damage received trigger for later processing by the socket layer.
 * This is used when a creature with a "whenever this creature is dealt damage" trigger
 * is dealt damage during combat, from spells, or from any other source.
 * 
 * The trigger is added to game.state.pendingDamageTriggers and will be processed
 * by the socket layer which will emit the appropriate UI prompts to the player.
 * 
 * @param ctx Game context
 * @param permanent The permanent that was dealt damage
 * @param damageAmount Amount of damage dealt
 */
function queueDamageReceivedTrigger(ctx: GameContext, permanent: any, damageAmount: number): void {
  if (!permanent || damageAmount <= 0) return;
  
  // Use the centralized damage trigger system
  processDamageReceivedTriggers(ctx, permanent, damageAmount, (triggerInfo) => {
    // Initialize pendingDamageTriggers if needed
    if (!(ctx as any).state.pendingDamageTriggers) {
      (ctx as any).state.pendingDamageTriggers = {};
    }
    
    // Add the trigger to the pending list
    (ctx as any).state.pendingDamageTriggers[triggerInfo.triggerId] = {
      sourceId: triggerInfo.sourceId,
      sourceName: triggerInfo.sourceName,
      controller: triggerInfo.controller,
      damageAmount: triggerInfo.damageAmount,
      triggerType: 'dealt_damage',
      targetType: triggerInfo.targetType,
      targetRestriction: triggerInfo.targetRestriction,
    };
    
    debug(2, `${ts()} [queueDamageReceivedTrigger] Queued damage trigger: ${triggerInfo.sourceName} was dealt ${damageAmount} damage`);
  });
}

/**
 * Ensure seq helper object present on ctx
 */
function ensureSeq(ctx: any) {
  if (!ctx) return;
  if (!ctx.seq) {
    ctx.seq = { value: 0 };
  } else if (typeof ctx.seq === "number") {
    ctx.seq = { value: ctx.seq };
  } else if (typeof ctx.seq === "object" && !("value" in ctx.seq)) {
    (ctx.seq as any).value = 0;
  }
}

/**
 * Bump sequence safely
 */
function safeBumpSeq(ctx: any) {
  try {
    ensureSeq(ctx);
    if (ctx.seq && typeof ctx.seq === "object") ctx.seq.value++;
    else if (typeof ctx.seq === "number") ctx.seq++;
  } catch {
    // ignore
  }
}

/**
 * Check if there are any pending interactions that need to be resolved
 * before the game can advance to the next step/phase.
 * 
 * This ensures UI popups, modals, and player choices are fully resolved
 * before game state transitions, maintaining proper game flow order.
 * 
 * This function checks both:
 * 1. The new unified ResolutionQueue (preferred)
 * 2. Legacy pending* state fields (for backward compatibility)
 * 
 * @param ctx Game context
 * @returns Object with hasPending flag and details about what's pending
 */
function checkPendingInteractions(ctx: GameContext): {
  hasPending: boolean;
  pendingTypes: string[];
  details: Record<string, any>;
} {
  const result = {
    hasPending: false,
    pendingTypes: [] as string[],
    details: {} as Record<string, any>,
  };
  
  try {
    const state = ctx.state as any;  // Use 'as any' for accessing dynamic pending* fields
    if (!state) return result;
    
    // =========================================================================
    // Check the unified ResolutionQueue first (new system)
    // =========================================================================
    const gameId = ctx.gameId;
    if (gameId) {
      const queueSummary = ResolutionQueueManager.getPendingSummary(gameId);
      if (queueSummary.hasPending) {
        result.hasPending = true;
        for (const type of queueSummary.pendingTypes) {
          if (!result.pendingTypes.includes(type)) {
            result.pendingTypes.push(type);
          }
        }
        result.details.resolutionQueue = {
          pendingCount: queueSummary.pendingCount,
          pendingByPlayer: queueSummary.pendingByPlayer,
        };
      }
    }
    
    // =========================================================================
    // DEPRECATED Legacy pending* field checks - Clean up any stale state
    // These are now handled by the Resolution Queue system.
    // =========================================================================
    
    // Clean up deprecated pendingTargets (now handled by Resolution Queue TARGET_SELECTION)
    if (state.pendingTargets && Object.keys(state.pendingTargets).length > 0) {
      debugWarn(1, `${ts()} [checkPendingInteractions] Found deprecated pendingTargets state - cleaning up`);
      delete state.pendingTargets;
    }
    
    // Clean up deprecated pendingKynaiosChoice (now handled by Resolution Queue KYNAIOS_CHOICE)
    const pendingKynaiosChoice = (state as any).pendingKynaiosChoice;
    if (pendingKynaiosChoice && Object.keys(pendingKynaiosChoice).length > 0) {
      debugWarn(1, `${ts()} [checkPendingInteractions] Found deprecated pendingKynaiosChoice state - cleaning up`);
      delete (state as any).pendingKynaiosChoice;
    }
    
    // =========================================================================
    // Keep legacy checks for state that is NOT yet migrated to Resolution Queue
    // These should eventually be migrated as well.
    // =========================================================================
    
    // Check for pending discard selection (cleanup step)
    if (state.pendingDiscardSelection && Object.keys(state.pendingDiscardSelection).length > 0) {
      result.hasPending = true;
      result.pendingTypes.push('discard_selection');
      result.details.pendingDiscardSelection = state.pendingDiscardSelection;
    }
    
    // Check for pending commander zone choice (destruction/exile)
    if (state.pendingCommanderZoneChoice && Object.keys(state.pendingCommanderZoneChoice).length > 0) {
      result.hasPending = true;
      result.pendingTypes.push('commander_zone_choice');
      result.details.pendingCommanderZoneChoice = state.pendingCommanderZoneChoice;
    }
    
    // Check for pending trigger ordering (multiple simultaneous triggers)
    // NOTE: Being migrated to Resolution Queue TRIGGER_ORDER step
    if (state.pendingTriggerOrdering && Object.keys(state.pendingTriggerOrdering).length > 0) {
      result.hasPending = true;
      result.pendingTypes.push('trigger_ordering');
      result.details.pendingTriggerOrdering = state.pendingTriggerOrdering;
    }
    
    // Check for pending Entrapment Maneuver selection
    // NOTE: Being migrated to Resolution Queue ENTRAPMENT_MANEUVER step
    if (state.pendingEntrapmentManeuver && Object.keys(state.pendingEntrapmentManeuver).length > 0) {
      result.hasPending = true;
      result.pendingTypes.push('entrapment_maneuver');
      result.details.pendingEntrapmentManeuver = state.pendingEntrapmentManeuver;
    }
    
    // Check for pending modal choices (Retreat to Emeria, Abiding Grace, etc.)
    if (state.pendingModalChoice && Object.keys(state.pendingModalChoice).length > 0) {
      result.hasPending = true;
      result.pendingTypes.push('modal_choice');
      result.details.pendingModalChoice = state.pendingModalChoice;
    }
    
    // Check for pending mana color selection (Cryptolith Rite style)
    if (state.pendingManaColorSelection && Object.keys(state.pendingManaColorSelection).length > 0) {
      result.hasPending = true;
      result.pendingTypes.push('mana_color_selection');
      result.details.pendingManaColorSelection = state.pendingManaColorSelection;
    }
    
    // Check for pending creature type selection (Maskwood Nexus, etc.)
    if (state.pendingCreatureTypeSelection && Object.keys(state.pendingCreatureTypeSelection).length > 0) {
      result.hasPending = true;
      result.pendingTypes.push('creature_type_selection');
      result.details.pendingCreatureTypeSelection = state.pendingCreatureTypeSelection;
    }
    
    // Check for pending flicker returns (end of turn delayed triggers)
    if (state.pendingFlickerReturns && state.pendingFlickerReturns.length > 0) {
      result.hasPending = true;
      result.pendingTypes.push('flicker_returns');
      result.details.pendingFlickerReturns = state.pendingFlickerReturns;
    }
    
    // Check for pending linked exile returns (Oblivion Ring style)
    if (state.pendingLinkedExileReturns && state.pendingLinkedExileReturns.length > 0) {
      result.hasPending = true;
      result.pendingTypes.push('linked_exile_returns');
      result.details.pendingLinkedExileReturns = state.pendingLinkedExileReturns;
    }
    
    // Check for pending Join Forces effects (now handled by Resolution Queue)
    // These are stored as arrays that are populated when effects resolve
    if (Array.isArray(state.pendingJoinForces) && state.pendingJoinForces.length > 0) {
      result.hasPending = true;
      result.pendingTypes.push('join_forces');
      result.details.pendingJoinForces = state.pendingJoinForces;
    }
    
    // Check for pending Tempting Offer effects (now handled by Resolution Queue)
    // These are stored as arrays that are populated when effects resolve
    if (Array.isArray(state.pendingTemptingOffer) && state.pendingTemptingOffer.length > 0) {
      result.hasPending = true;
      result.pendingTypes.push('tempting_offer');
      result.details.pendingTemptingOffer = state.pendingTemptingOffer;
    }
    
    // Check for non-empty stack (spells/abilities waiting to resolve)
    // Note: This is a deliberate choice - if the stack has items, players should
    // explicitly pass priority to advance, not just click "next step"
    if (Array.isArray(state.stack) && state.stack.length > 0) {
      result.hasPending = true;
      result.pendingTypes.push('stack_not_empty');
      result.details.stackCount = state.stack.length;
    }
    
    // Check for pending blocker declarations during DECLARE_BLOCKERS step
    // Per Rule 509, defending players must be given the opportunity to declare blockers
    // Blockers are declared in APNAP (Active Player, Non-Active Player) order
    // Don't auto-advance if there are attackers and potential blockers, unless all defenders have declared
    const currentStep = (state.step || '').toString().toUpperCase();
    if (currentStep === 'DECLARE_BLOCKERS' || currentStep.includes('BLOCKERS')) {
      const battlefield = state.battlefield || [];
      const hasAttackers = battlefield.some((perm: any) => perm && perm.attacking);
      
      if (hasAttackers) {
        // Get all defending players (players being attacked)
        const defendingPlayersSet = new Set<string>();
        for (const perm of battlefield) {
          if (perm && perm.attacking) {
            defendingPlayersSet.add(perm.attacking);
          }
        }
        
        const blockersDeclaredBy = state.blockersDeclaredBy || [];
        
        // Check if ALL defending players have declared blockers
        const allDefendersHaveDeclared = Array.from(defendingPlayersSet).every(defenderId => 
          blockersDeclaredBy.includes(defenderId)
        );
        
        if (!allDefendersHaveDeclared) {
          // At least one defender hasn't declared yet
          // Check if any of them have potential blockers
          for (const defenderId of defendingPlayersSet) {
            // Skip if this player already declared blockers
            if (blockersDeclaredBy.includes(defenderId)) {
              continue;
            }
            
            const hasPotentialBlockers = battlefield.some((perm: any) => {
              if (!perm || perm.controller !== defenderId) return false;
              if (perm.tapped) return false;
              const typeLine = (perm.card?.type_line || '').toLowerCase();
              return typeLine.includes('creature');
            });
            
            // If this defender has NO potential blockers, auto-declare empty blockers for them
            if (!hasPotentialBlockers) {
              debug(2, `${ts()} [checkPendingInteractions] Auto-declaring empty blockers for ${defenderId} (no valid blockers)`);
              blockersDeclaredBy.push(defenderId);
              continue;
            }
            
            // This defender has potential blockers and hasn't declared yet
            result.hasPending = true;
            result.pendingTypes.push('blocker_declaration');
            result.details.blockersNeeded = true;
            result.details.defendingPlayer = defenderId;
            debug(2, `${ts()} [checkPendingInteractions] Waiting for ${defenderId} to declare blockers`);
            break; // Wait for this defender
          }
        }
      }
    }
    
    // Log pending interactions for debugging
    if (result.hasPending) {
      debug(1, `${ts()} [checkPendingInteractions] Pending: ${result.pendingTypes.join(', ')}`);
    }
    
  } catch (err) {
    debugWarn(1, `${ts()} [checkPendingInteractions] Error:`, err);
  }
  
  return result;
}

/**
 * Utility: get ordered active players (non-inactive) from ctx.state.players
 */
function activePlayers(ctx: GameContext): string[] {
  try {
    const players = Array.isArray(ctx.state.players) ? (ctx.state.players as any[]) : [];
    return players
      .filter(
        (p) =>
          !(
            (ctx as any).inactive &&
            (ctx as any).inactive.has &&
            (ctx as any).inactive.has(p.id)
          )
      )
      .map((p) => p.id);
  } catch {
    return [];
  }
}

/**
 * Find next player id in turn order after given player
 */
function nextPlayerInOrder(ctx: GameContext, fromId?: PlayerID) {
  const players = Array.isArray(ctx.state.players) ? (ctx.state.players as any[]) : [];
  if (!players.length) return undefined;
  const ids = players.map((p) => p.id);
  if (!fromId) return ids[0];
  const idx = ids.indexOf(fromId);
  if (idx === -1) return ids[0];
  return ids[(idx + 1) % ids.length];
}

/**
 * Pass priority: called when a player passes priority.
 * Returns { changed: boolean, resolvedNow?: boolean, advanceStep?: boolean }
 *
 * This implementation is a defensive, simple rotation:
 * - If ctx.state.priority is not set, set to first active player and return changed=true.
 * - Otherwise move to next active player. If nothing changes, return changed=false.
 * - If all players pass priority with empty stack, returns advanceStep=true.
 * - If all players pass priority with non-empty stack, returns resolvedNow=true.
 *
 * Note: This is a simplified behavior suitable for replay and initial server runs.
 * More advanced rule handling (stack resolution, automatic passes) belongs in rules engine.
 */
export function passPriority(ctx: GameContext, playerId?: PlayerID) {
  try {
    ensureSeq(ctx);
    const state: any = (ctx as any).state || {};
    const players = Array.isArray(state.players) ? state.players.map((p: any) => p.id) : [];

    // Ensure active set exists
    const inactiveSet: Set<string> =
      (ctx as any).inactive instanceof Set ? (ctx as any).inactive : new Set<string>();

    const active = players.filter((id: string) => !inactiveSet.has(id));
    if (!active.length) {
      return { changed: false, resolvedNow: false, advanceStep: false };
    }

    // If no priority set, give to first active
    if (!state.priority) {
      state.priority = active[0];
      // Reset priority pass tracking
      state.priorityPassedBy = new Set<string>();
      ctx.bumpSeq();
      return { changed: true, resolvedNow: false, advanceStep: false };
    }

    // If playerId provided but doesn't match current priority, ignore (no change)
    if (playerId && state.priority !== playerId) {
      // allow a replayed passPriority by other actor to still advance if desired:
      // treat as no-op to be conservative
      return { changed: false, resolvedNow: false, advanceStep: false };
    }

    // Track that this player passed priority
    // Initialize priorityPassedBy set if it doesn't exist
    if (!state.priorityPassedBy || !(state.priorityPassedBy instanceof Set)) {
      state.priorityPassedBy = new Set<string>();
    }
    state.priorityPassedBy.add(playerId || state.priority);

    // Check if there's something on the stack
    const stackLen = Array.isArray(state.stack) ? state.stack.length : 0;

    // For single-player games, passing priority should resolve/advance immediately
    if (active.length === 1) {
      if (stackLen > 0) {
        // Single player passed priority with stack items - resolve immediately
        state.priorityPassedBy = new Set<string>(); // Reset tracking
        ctx.bumpSeq();
        return { changed: true, resolvedNow: true, advanceStep: false };
      }
      // Single player, empty stack - advance to next step
      state.priorityPassedBy = new Set<string>(); // Reset tracking
      ctx.bumpSeq();
      return { changed: true, resolvedNow: false, advanceStep: true };
    }

    // Multi-player: find index of current priority in active array
    const curIndex = active.indexOf(state.priority);
    let nextIndex = 0;
    if (curIndex === -1) {
      nextIndex = 0;
    } else {
      nextIndex = (curIndex + 1) % active.length;
    }

    const nextId = active[nextIndex];

    // Check if all active players have passed priority
    const allPassed = active.every(id => state.priorityPassedBy.has(id));

    if (allPassed) {
      // All players have passed priority
      state.priorityPassedBy = new Set<string>(); // Reset tracking for next round

      if (stackLen > 0) {
        // Resolve the top of the stack
        state.priority = state.turnPlayer; // Give priority back to turn player after resolution
        ctx.bumpSeq();
        return { changed: true, resolvedNow: true, advanceStep: false };
      } else {
        // Empty stack - advance to next step
        state.priority = state.turnPlayer; // Give priority back to turn player
        ctx.bumpSeq();
        return { changed: true, resolvedNow: false, advanceStep: true };
      }
    }

    // If priority stays the same (shouldn't happen with >1 active), no change
    if (nextId === state.priority) {
      return { changed: false, resolvedNow: false, advanceStep: false };
    }

    state.priority = nextId;
    ctx.bumpSeq();

    return { changed: true, resolvedNow: false, advanceStep: false };
  } catch (err) {
    debugWarn(1, `${ts()} passPriority stub failed:`, err);
    return { changed: false, resolvedNow: false, advanceStep: false };
  }
}

/**
 * Set turn direction (+1 or -1)
 */
export function setTurnDirection(ctx: GameContext, dir: 1 | -1) {
  try {
    (ctx as any).state = (ctx as any).state || {};
    (ctx as any).state.turnDirection = dir;
    ctx.bumpSeq();
  } catch (err) {
    debugWarn(1, `${ts()} setTurnDirection failed:`, err);
  }
}

/**
 * Clear combat state from all permanents on the battlefield.
 * Should be called when transitioning out of combat phase.
 * Rule 506.4: When combat ends, remove all combat-related states from permanents.
 */
function clearCombatState(ctx: GameContext) {
  try {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return;
    
    let clearedCount = 0;
    for (const permanent of battlefield) {
      if (!permanent) continue;
      
      // Clear attacking state
      if (permanent.attacking !== undefined) {
        delete permanent.attacking;
        clearedCount++;
      }
      
      // Clear blocking state  
      if (permanent.blocking !== undefined) {
        delete permanent.blocking;
        clearedCount++;
      }
      
      // Clear blockedBy state
      if (permanent.blockedBy !== undefined) {
        delete permanent.blockedBy;
        clearedCount++;
      }
      
      // Clear combat damage received this turn (optional - depends on implementation)
      if (permanent.combatDamageThisTurn !== undefined) {
        delete permanent.combatDamageThisTurn;
      }
    }
    
    // Clear combat state on game state
    if ((ctx as any).state.combat !== undefined) {
      delete (ctx as any).state.combat;
    }
    
    if (clearedCount > 0) {
      debug(2, `${ts()} [clearCombatState] Cleared combat state from ${clearedCount} permanents`);
    }
  } catch (err) {
    debugWarn(1, `${ts()} clearCombatState failed:`, err);
  }
}

/**
 * Sync life totals between state.life dictionary and player objects in state.players.
 * Also checks for state-based actions (player defeat due to 0 or less life).
 * 
 * Returns list of player IDs that have been defeated (life <= 0).
 */
function syncLifeAndCheckDefeat(ctx: GameContext): string[] {
  const defeatedPlayers: string[] = [];
  
  try {
    const state = (ctx as any).state;
    if (!state) return defeatedPlayers;
    
    const players = state.players || [];
    const life = state.life = state.life || {};
    const startingLife = state.startingLife || 40;
    
    // state.life is the authoritative source for life totals
    // Player objects in state.players are synchronized from state.life
    for (const player of players) {
      if (!player || !player.id) continue;
      
      // Initialize life in state.life if not present
      if (life[player.id] === undefined) {
        life[player.id] = player.life ?? startingLife;
      }
      
      // Always sync player.life FROM state.life (single source of truth)
      player.life = life[player.id];
      
      // Check for player defeat (Rule 704.5a: Life <= 0)
      if (player.life <= 0 && !player.hasLost) {
        player.hasLost = true;
        player.lossReason = "Life total is 0 or less";
        defeatedPlayers.push(player.id);
        debug(1, `${ts()} [syncLifeAndCheckDefeat] Player ${player.id} has lost the game (life: ${player.life})`);
        
        // Mark player as inactive
        if (!((ctx as any).inactive instanceof Set)) {
          (ctx as any).inactive = new Set<string>();
        }
        (ctx as any).inactive.add(player.id);
      }
    }
    
  } catch (err) {
    debugWarn(1, `${ts()} syncLifeAndCheckDefeat failed:`, err);
  }
  
  return defeatedPlayers;
}

/**
 * Track commander damage and check for 21+ damage loss condition (Rule 903.10a)
 * 
 * @param ctx Game context
 * @param attackerController Controller of the attacking commander
 * @param attackerCard The commander's card data
 * @param attacker The commander permanent
 * @param defendingPlayerId The player taking damage
 * @param damageAmount Amount of combat damage dealt
 */
function trackCommanderDamage(
  ctx: GameContext,
  attackerController: string,
  attackerCard: any,
  attacker: any,
  defendingPlayerId: string,
  damageAmount: number
): void {
  if (damageAmount <= 0) return;
  
  // Check if attacker is a commander
  const isCommander = attacker.isCommander === true || 
                     (ctx as any).state?.commandZone?.[attackerController]?.commanderIds?.includes(attackerCard.id);
  
  if (!isCommander) return;
  
  // Initialize commander damage tracking if needed
  (ctx as any).state.commanderDamage = (ctx as any).state.commanderDamage || {};
  (ctx as any).state.commanderDamage[defendingPlayerId] = (ctx as any).state.commanderDamage[defendingPlayerId] || {};
  
  // Use the card ID as the commander identifier (consistent across zones)
  const commanderId = attackerCard.id || attacker.id;
  const previousDamage = (ctx as any).state.commanderDamage[defendingPlayerId][commanderId] || 0;
  const totalDamage = previousDamage + damageAmount;
  (ctx as any).state.commanderDamage[defendingPlayerId][commanderId] = totalDamage;
  
  debug(1, `${ts()} [dealCombatDamage] COMMANDER DAMAGE: ${attackerCard.name || 'Commander'} dealt ${damageAmount} to ${defendingPlayerId} (total: ${totalDamage}/21)`);
  
  // Check for commander damage loss (21+)
  if (totalDamage >= 21) {
    debug(1, `${ts()} [dealCombatDamage] ⚠️ COMMANDER DAMAGE LETHAL: ${defendingPlayerId} has taken 21+ damage from ${attackerCard.name || 'Commander'}`);
    const players = (ctx as any).state?.players || [];
    const defeatedPlayer = players.find((p: any) => p.id === defendingPlayerId);
    if (defeatedPlayer && !defeatedPlayer.hasLost) {
      defeatedPlayer.hasLost = true;
      defeatedPlayer.lossReason = `21 or more combat damage from ${attackerCard.name || 'a commander'}`;
      
      // Mark player as inactive so they automatically pass priority
      if (!((ctx as any).inactive instanceof Set)) {
        (ctx as any).inactive = new Set<string>();
      }
      (ctx as any).inactive.add(defendingPlayerId);
      debug(1, `${ts()} [dealCombatDamage] Player ${defendingPlayerId} marked as inactive (commander damage)`);
    }
  }
}

/**
 * Track that a creature dealt damage to a player this turn.
 * This is used by cards like Reciprocate that can only target creatures that dealt damage to you this turn.
 * 
 * @param ctx Game context
 * @param creaturePermanentId The permanent ID of the creature that dealt damage
 * @param creatureName The name of the creature (for logging)
 * @param damagedPlayerId The player who was damaged
 * @param damageAmount Amount of damage dealt
 */
function trackCreatureDamageToPlayer(
  ctx: GameContext,
  creaturePermanentId: string,
  creatureName: string,
  damagedPlayerId: string,
  damageAmount: number
): void {
  if (damageAmount <= 0) return;
  
  // Initialize tracking structure if needed
  // Structure: creaturesThatDealtDamageToPlayer[playerId] = Set of creature permanent IDs
  (ctx as any).state.creaturesThatDealtDamageToPlayer = (ctx as any).state.creaturesThatDealtDamageToPlayer || {};
  
  // Use an object to track creature IDs (since JSON doesn't serialize Sets)
  const playerDamageTracker = (ctx as any).state.creaturesThatDealtDamageToPlayer[damagedPlayerId] = 
    (ctx as any).state.creaturesThatDealtDamageToPlayer[damagedPlayerId] || {};
  
  // Track this creature as having dealt damage to this player
  playerDamageTracker[creaturePermanentId] = {
    creatureName,
    totalDamage: (playerDamageTracker[creaturePermanentId]?.totalDamage || 0) + damageAmount,
    lastDamageTime: Date.now(),
  };
  
  debug(2, `${ts()} [trackCreatureDamageToPlayer] ${creatureName} (${creaturePermanentId}) dealt ${damageAmount} damage to ${damagedPlayerId}`);
}

/**
 * Check if a creature dealt damage to a specific player this turn.
 * Used for cards like Reciprocate that have targeting restrictions based on damage dealt.
 * 
 * @param ctx Game context
 * @param creaturePermanentId The permanent ID of the creature to check
 * @param damagedPlayerId The player to check damage against
 * @returns true if the creature dealt damage to the player this turn
 */
export function didCreatureDealDamageToPlayer(
  ctx: GameContext,
  creaturePermanentId: string,
  damagedPlayerId: string
): boolean {
  const damageTracker = (ctx as any).state?.creaturesThatDealtDamageToPlayer?.[damagedPlayerId];
  if (!damageTracker) return false;
  
  return !!damageTracker[creaturePermanentId];
}

/**
 * Get all creatures that dealt damage to a specific player this turn.
 * Used by targeting systems for cards like Reciprocate.
 * 
 * @param ctx Game context
 * @param damagedPlayerId The player to get damage sources for
 * @returns Array of permanent IDs of creatures that dealt damage to this player this turn
 */
export function getCreaturesThatDealtDamageToPlayer(
  ctx: GameContext,
  damagedPlayerId: string
): string[] {
  const damageTracker = (ctx as any).state?.creaturesThatDealtDamageToPlayer?.[damagedPlayerId];
  if (!damageTracker) return [];
  
  return Object.keys(damageTracker);
}

/**
 * Deal combat damage during the DAMAGE step.
 * Rule 510: Combat damage is assigned and dealt simultaneously.
 * 
 * Handles:
 * - Unblocked attackers deal damage to defending player
 * - Blocked attackers deal damage to blockers (with damage assignment order)
 * - Blockers deal damage to attackers they block
 * - Trample: Excess damage from blocked attacker goes to defending player
 * - Lifelink: Controller gains life equal to damage dealt
 * - Deathtouch: Any damage is lethal (kills creature)
 * - First Strike / Double Strike: Handled in separate damage steps
 * 
 * @param ctx Game context
 * @param isFirstStrikePhase If true, only first strike/double strike creatures deal damage.
 *                          If false (or undefined), regular damage phase - all creatures deal damage,
 *                          but first strike-only creatures are skipped (they already dealt damage).
 * 
 * Returns summary of damage dealt for logging/notification.
 */
function dealCombatDamage(ctx: GameContext, isFirstStrikePhase?: boolean): {
  damageToPlayers: Record<string, number>;
  lifeGainForPlayers: Record<string, number>;
  creaturesDestroyed: string[];
  attackersThatDealtDamage?: Record<string, Set<string>>; // defendingPlayerId -> Set of attacker IDs
} {
  debug(2, `${ts()} [COMBAT_DAMAGE] ========== ENTERING dealCombatDamage (firstStrike=${isFirstStrikePhase}) ==========`);
  
  const result = {
    damageToPlayers: {} as Record<string, number>,
    lifeGainForPlayers: {} as Record<string, number>,
    creaturesDestroyed: [] as string[],
    attackersThatDealtDamage: {} as Record<string, Set<string>>,
  };
  
  try {
    const battlefield = (ctx as any).state?.battlefield;
    const state = (ctx as any).state;
    if (!Array.isArray(battlefield)) {
      debug(2, `${ts()} [COMBAT_DAMAGE] No battlefield array, returning early`);
      return result;
    }
    
    // Find all attacking creatures
    const attackers = battlefield.filter((perm: any) => perm && perm.attacking);
    debug(2, `${ts()} [COMBAT_DAMAGE] Found ${attackers.length} attackers`);
    
    // Log attacker details
    for (const att of attackers) {
      const blockedBy = att.blockedBy || [];
      debug(1, `${ts()} [COMBAT_DAMAGE] Attacker: ${att.card?.name || att.id}, blocked by ${blockedBy.length} creatures: [${blockedBy.join(', ')}]`);
    }
    
    if (attackers.length === 0) {
      debug(2, `${ts()} [COMBAT_DAMAGE] No attackers, skipping combat damage`);
      return result;
    }
    
    // Get life totals object - ensure we're using the same object that ctx.life references
    // Initialize if needed to avoid creating a new unlinked object
    if (!(ctx as any).state.life) {
      (ctx as any).state.life = {};
    }
    const life = (ctx as any).state.life;
    const startingLife = (ctx as any).state?.startingLife || 40;
    
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
      let attackerPower: number;
      if (typeof attacker.effectivePower === 'number') {
        attackerPower = attacker.effectivePower;
      } else {
        // Calculate base power
        let basePower = typeof attacker.basePower === 'number' 
          ? attacker.basePower 
          : parsePT(card?.power) ?? 0;
        
        // Add counter bonuses
        const plusCounters = attacker.counters?.['+1/+1'] || 0;
        const minusCounters = attacker.counters?.['-1/-1'] || 0;
        const counterDelta = plusCounters - minusCounters;
        
        // Calculate ALL other bonuses (equipment, auras, anthems, lords, Leyline of Hope, etc.)
        const state = (ctx as any).state;
        const allBonuses = calculateAllPTBonuses(attacker, state);
        
        attackerPower = Math.max(0, basePower + counterDelta + allBonuses.power);
        debug(2, `${ts()} [dealCombatDamage] ${card?.name || attacker.id} power calculation: base=${basePower}, counters=${counterDelta}, bonuses=${allBonuses.power}, total=${attackerPower}`);
      }
      
      const attackerController = attacker.controller;
      const defendingTarget = attacker.attacking; // Player ID or planeswalker ID
      
      // Check if this attacker should deal damage in this phase based on first strike rules
      // First strike phase: only first strike and double strike creatures deal damage
      // Regular damage phase: all creatures deal damage EXCEPT first strike-only (they already dealt)
      //   Double strike creatures deal damage in BOTH phases
      const hasFirstStrike = keywords.firstStrike || keywords.doubleStrike;
      const hasDoubleStrike = keywords.doubleStrike;
      
      if (isFirstStrikePhase === true) {
        // First strike phase - only first strike or double strike creatures deal damage
        if (!hasFirstStrike) {
          debug(2, `${ts()} [dealCombatDamage] Skipping ${card.name || attacker.id} in first strike phase (no first/double strike)`);
          continue;
        }
      } else if (isFirstStrikePhase === false) {
        // Regular damage phase after first strike - skip first strike-only creatures
        // but double strike creatures deal damage again
        if (keywords.firstStrike && !keywords.doubleStrike) {
          debug(2, `${ts()} [dealCombatDamage] Skipping ${card.name || attacker.id} in regular phase (first strike only, already dealt)`);
          continue;
        }
      }
      // If isFirstStrikePhase is undefined, this is a normal combat with no first strikers, all creatures deal damage
      
      // Check if this attacker is blocked
      const blockedBy = attacker.blockedBy || [];
      const isBlocked = blockedBy.length > 0;
      
      if (attackerPower <= 0) {
        // 0 or negative power deals no damage
        continue;
      }
      
      if (!isBlocked) {
        // UNBLOCKED ATTACKER: Deal damage to defending player
        // Get the defending player ID (stored in attacker.attacking)
        const defendingPlayerId = defendingTarget;
        
        if (defendingPlayerId && !defendingPlayerId.startsWith('perm_')) {
          // Check for combat damage replacement effects (The Mindskinner, etc.)
          const replacementResult = applyCombatDamageReplacement(
            ctx, card, attacker, attackerController, attackerPower, defendingPlayerId
          );
          
          const actualDamage = replacementResult.damageDealt;
          
          // Log replacement effects
          for (const effect of replacementResult.effectsApplied) {
            debug(2, `${ts()} [dealCombatDamage] ${effect}`);
          }
          
          // Apply mill effect if triggered (The Mindskinner)
          if (replacementResult.millAmount && replacementResult.millTargets) {
            const millAmount = replacementResult.millAmount;
            for (const opponentId of replacementResult.millTargets) {
              // Mill the opponent
              const lib = ctx.libraries?.get(opponentId) || [];
              const milledCards: any[] = [];
              for (let i = 0; i < millAmount && lib.length > 0; i++) {
                const milledCard = lib.pop();
                if (milledCard) {
                  milledCards.push(milledCard);
                }
              }
              ctx.libraries?.set(opponentId, lib);
              
              // Move milled cards to graveyard
              const zones = (ctx as any).state?.zones || {};
              const oppZones = zones[opponentId] = zones[opponentId] || { hand: [], graveyard: [], libraryCount: 0, graveyardCount: 0 };
              oppZones.graveyard = oppZones.graveyard || [];
              for (const milledCard of milledCards) {
                milledCard.zone = 'graveyard';
                oppZones.graveyard.push(milledCard);
              }
              oppZones.libraryCount = lib.length;
              oppZones.graveyardCount = (oppZones.graveyard || []).length;
              
              debug(1, `${ts()} [dealCombatDamage] ${card.name || 'Attacker'} milled ${milledCards.length} cards from ${opponentId}: ${milledCards.map((c: any) => c.name).join(', ')}`);
            }
          }
          
          // Deal actual damage (may be 0 if prevented)
          if (actualDamage > 0) {
            const currentLife = life[defendingPlayerId] ?? startingLife;
            life[defendingPlayerId] = currentLife - actualDamage;
            
            result.damageToPlayers[defendingPlayerId] = 
              (result.damageToPlayers[defendingPlayerId] || 0) + actualDamage;
            
            // Track which attacker dealt damage to which player (for batched triggers)
            if (!result.attackersThatDealtDamage[defendingPlayerId]) {
              result.attackersThatDealtDamage[defendingPlayerId] = new Set();
            }
            result.attackersThatDealtDamage[defendingPlayerId].add(attacker.id);
            
            debug(2, `${ts()} [dealCombatDamage] ${card.name || 'Attacker'} dealt ${actualDamage} combat damage to ${defendingPlayerId} (${currentLife} -> ${life[defendingPlayerId]})`);
            
            // Track commander damage (Rule 903.10a)
            trackCommanderDamage(ctx, attackerController, card, attacker, defendingPlayerId, actualDamage);
            
            // Track that this creature dealt damage to this player this turn
            // This is used for cards like Reciprocate that can only target creatures that dealt damage to you
            trackCreatureDamageToPlayer(ctx, attacker.id, card.name || 'Unknown Creature', defendingPlayerId, actualDamage);
            
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
              const lifeGainResult = applyLifeGain(state, attackerController, actualDamage, `${card.name || 'Attacker'} (lifelink)`);
              
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
                const lifeGainResult = applyLifeGain(state, auraController, actualDamage, aura.card?.name || 'Aura');
                
                result.lifeGainForPlayers[auraController] = 
                  (result.lifeGainForPlayers[auraController] || 0) + lifeGainResult.actualChange;
                
                debug(2, `${ts()} [dealCombatDamage] ${aura.card?.name || 'Aura'}: ${lifeGainResult.message}`);
              }
            }
          } else if (replacementResult.prevented) {
            debug(2, `${ts()} [dealCombatDamage] ${card.name || 'Attacker'}'s ${attackerPower} combat damage was prevented`);
          }
        }
        // TODO: Handle attacking planeswalkers (defendingTarget starts with 'perm_')
      } else {
        // BLOCKED ATTACKER: Deal damage to blockers
        let remainingDamage = attackerPower;
        
        for (const blockerId of blockedBy) {
          const blocker = battlefield.find((p: any) => p?.id === blockerId);
          if (!blocker) continue;
          
          const blockerCard = blocker.card || {};
          const blockerToughness = parseInt(String(blocker.baseToughness ?? blockerCard.toughness ?? '0'), 10) || 0;
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
          
          // If blocker already has lethal damage, skip assigning more (relevant for trample)
          if (lethalDamage <= 0) {
            debug(1, `${ts()} [dealCombatDamage] Blocker ${blockerCard.name || blockerId} already has lethal damage, skipping`);
            continue;
          }
          
          // Assign lethal damage (or all remaining damage if less than lethal)
          const damageToBlocker = Math.min(lethalDamage, remainingDamage);
          
          if (damageToBlocker > 0) {
            // Mark damage on blocker
            blocker.markedDamage = (blocker.markedDamage || 0) + damageToBlocker;
            remainingDamage -= damageToBlocker;
            
            debug(2, `${ts()} [dealCombatDamage] ${card.name || 'Attacker'} dealt ${damageToBlocker} damage to blocker ${blockerCard.name || blockerId}`);
            
            // Check for damage-received triggers (Brash Taunter, Boros Reckoner, etc.)
            queueDamageReceivedTrigger(ctx, blocker, damageToBlocker);
            
            // Check if blocker dies
            const totalDamageOnBlocker = blocker.markedDamage || 0;
            const isDead = totalDamageOnBlocker >= blockerToughness || (keywords.deathtouch && totalDamageOnBlocker > 0);
            
            if (isDead) {
              result.creaturesDestroyed.push(blockerId);
              debug(1, `${ts()} [dealCombatDamage] Blocker ${blockerCard.name || blockerId} received lethal damage`);
            }
            
            // Lifelink for damage dealt to blocker
            if (keywords.lifelink) {
              const lifeGainResult = applyLifeGain(state, attackerController, damageToBlocker, `${card.name || 'Attacker'} (lifelink)`);
              
              result.lifeGainForPlayers[attackerController] = 
                (result.lifeGainForPlayers[attackerController] || 0) + lifeGainResult.actualChange;
            }
          }
          
          if (remainingDamage <= 0 && !keywords.trample) break;
        }
        
        // Trample: Excess damage goes to defending player
        if (keywords.trample && remainingDamage > 0) {
          const defendingPlayerId = defendingTarget;
          
          if (defendingPlayerId && !defendingPlayerId.startsWith('perm_')) {
            const currentLife = life[defendingPlayerId] ?? startingLife;
            life[defendingPlayerId] = currentLife - remainingDamage;
            
            result.damageToPlayers[defendingPlayerId] = 
              (result.damageToPlayers[defendingPlayerId] || 0) + remainingDamage;
            
            // Track which attacker dealt damage to which player (for batched triggers)
            if (!result.attackersThatDealtDamage[defendingPlayerId]) {
              result.attackersThatDealtDamage[defendingPlayerId] = new Set();
            }
            result.attackersThatDealtDamage[defendingPlayerId].add(attacker.id);
            
            debug(2, `${ts()} [dealCombatDamage] ${card.name || 'Attacker'} trample: dealt ${remainingDamage} excess damage to ${defendingPlayerId}`);
            
            // Track commander trample damage (Rule 903.10a)
            trackCommanderDamage(ctx, attackerController, card, attacker, defendingPlayerId, remainingDamage);
            
            // Track that this creature dealt damage to this player this turn (for Reciprocate-style effects)
            trackCreatureDamageToPlayer(ctx, attacker.id, card.name || 'Unknown Creature', defendingPlayerId, remainingDamage);
            
            // Lifelink for trample damage
            if (keywords.lifelink) {
              const lifeGainResult = applyLifeGain(state, attackerController, remainingDamage, `${card.name || 'Attacker'} (lifelink trample)`);
              
              result.lifeGainForPlayers[attackerController] = 
                (result.lifeGainForPlayers[attackerController] || 0) + lifeGainResult.actualChange;
            }
          }
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
          
          // Calculate effective blocker power including +1/+1 counters, modifiers, and static effects
          let blockerPower: number;
          if (typeof blocker.effectivePower === 'number') {
            blockerPower = blocker.effectivePower;
          } else {
            // Calculate base power
            let basePower = typeof blocker.basePower === 'number' 
              ? blocker.basePower 
              : parsePT(blockerCard?.power) ?? 0;
            
            // Add counter bonuses
            const plusCounters = blocker.counters?.['+1/+1'] || 0;
            const minusCounters = blocker.counters?.['-1/-1'] || 0;
            const counterDelta = plusCounters - minusCounters;
            
            // Calculate ALL other bonuses (equipment, auras, anthems, lords, Leyline of Hope, etc.)
            const state = (ctx as any).state;
            const allBonuses = calculateAllPTBonuses(blocker, state);
            
            blockerPower = Math.max(0, basePower + counterDelta + allBonuses.power);
          }
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
            // Deal damage to attacker
            attacker.markedDamage = (attacker.markedDamage || 0) + blockerPower;
            
            debug(2, `${ts()} [COMBAT_DAMAGE] Blocker ${blockerCard.name || blockerId} dealt ${blockerPower} damage to attacker ${card.name || attacker.id}`);
            
            // Check for damage-received triggers (Brash Taunter, Boros Reckoner, etc.)
            queueDamageReceivedTrigger(ctx, attacker, blockerPower);
            
            // Check if attacker dies
            const attackerToughness = parseInt(String(attacker.baseToughness ?? card.toughness ?? '0'), 10) || 0;
            const totalDamageOnAttacker = attacker.markedDamage || 0;
            const isDead = totalDamageOnAttacker >= attackerToughness || (blockerKeywords.deathtouch && totalDamageOnAttacker > 0);
            
            debug(2, `${ts()} [COMBAT_DAMAGE] Attacker ${card.name || attacker.id}: toughness=${attackerToughness}, totalDamage=${totalDamageOnAttacker}, isDead=${isDead}`);
            
            if (isDead && !result.creaturesDestroyed.includes(attacker.id)) {
              result.creaturesDestroyed.push(attacker.id);
              debug(1, `${ts()} [COMBAT_DAMAGE] Attacker ${card.name || attacker.id} received lethal damage`);
            }
            
            // Lifelink for blocker
            if (blockerKeywords.lifelink) {
              const blockerController = blocker.controller;
              const lifeGainResult = applyLifeGain(state, blockerController, blockerPower, `${blockerCard.name || 'Blocker'} (lifelink)`);
              
              result.lifeGainForPlayers[blockerController] = 
                (result.lifeGainForPlayers[blockerController] || 0) + lifeGainResult.actualChange;
              
              debug(2, `${ts()} [COMBAT_DAMAGE] Blocker ${blockerCard.name || blockerId} lifelink: ${lifeGainResult.message}`);
            }
          }
        }
      }
    }
    
    // Update life state
    (ctx as any).state.life = life;
    
    // Sync life to player objects and check for player defeat (SBA Rule 704.5a)
    const defeatedPlayers = syncLifeAndCheckDefeat(ctx);
    if (defeatedPlayers.length > 0) {
      debug(1, `${ts()} [dealCombatDamage] Players defeated due to combat damage: ${defeatedPlayers.join(', ')}`);
      // Store defeated players for the socket layer to broadcast
      (ctx as any).state.lastCombatDefeat = defeatedPlayers;
    }
    
    // Move dead creatures to graveyard (state-based actions)
    // This should be handled separately by SBA processing, but we mark them here
    for (const deadId of result.creaturesDestroyed) {
      const deadPerm = battlefield.find((p: any) => p?.id === deadId);
      if (deadPerm) {
        deadPerm.markedForDestruction = true;
      }
    }
    
    debug(2, `${ts()} [dealCombatDamage] Combat damage complete. Damage to players: ${JSON.stringify(result.damageToPlayers)}, Life gained: ${JSON.stringify(result.lifeGainForPlayers)}, Creatures destroyed: ${result.creaturesDestroyed.length}`);
    
    // Run state-based actions to destroy creatures that have lethal damage
    // This will move creatures with 0 or less toughness (after damage) to the graveyard
    try {
      runSBA(ctx);
    } catch (sbaErr) {
      debugWarn(1, `${ts()} [dealCombatDamage] SBA failed:`, sbaErr);
    }
    
    // Check for batched combat damage triggers (e.g., Professional Face-Breaker, Nature's Will)
    // These trigger once per combat damage step if ANY creatures dealt damage to a player
    // Examples:
    // - "Whenever one or more creatures you control deal combat damage to a player, create a Treasure token."
    // - "Whenever one or more creatures you control deal combat damage to a player, untap all lands you control."
    
    for (const [defendingPlayerId, attackerIds] of Object.entries(result.attackersThatDealtDamage || {})) {
      // Find all controllers who had creatures deal damage to this player
      const controllersWhoDamaged = new Set<string>();
      for (const attackerId of attackerIds) {
        const attacker = attackers.find((a: any) => a.id === attackerId);
        if (attacker?.controller) {
          controllersWhoDamaged.add(attacker.controller);
        }
      }
      
      // For each controller who had creatures deal damage to this player
      for (const controllerId of controllersWhoDamaged) {
        // Check all permanents for batched combat damage triggers
        for (const perm of battlefield) {
          if (perm?.controller !== controllerId) continue;
          
          const triggers = detectCombatDamageTriggers(perm.card, perm);
          const batchedTriggers = triggers.filter(t => 
            t.triggerType === 'creatures_deal_combat_damage_batched' && t.batched
          );
          
          for (const trigger of batchedTriggers) {
            debug(2, `${ts()} [dealCombatDamage] Batched combat damage trigger from ${trigger.cardName}: ${trigger.description}`);
            
            const effectLower = (trigger.description || trigger.effect || '').toLowerCase();
            
            // Nature's Will / Bear Umbra / Sword of Feast and Famine: untap all lands you control
            if (effectLower.includes('untap all lands you control')) {
              try {
                untapLandsForPlayer(ctx, controllerId);
                debug(2, `${ts()} [dealCombatDamage] Untapped all lands for ${controllerId} from ${trigger.cardName}`);
              } catch (untapErr) {
                debugError(1, `${ts()} [dealCombatDamage] Failed to untap lands:`, untapErr);
              }
            }
            
            // Professional Face-Breaker: create a Treasure token
            // Check if the card name matches Professional Face-Breaker exactly
            const isProfessionalFaceBreaker = trigger.cardName.toLowerCase() === 'professional face-breaker';
            if (isProfessionalFaceBreaker || effectLower.includes('create a treasure')) {
              try {
                createToken(ctx, controllerId, 'Treasure', 1);
                debug(2, `${ts()} [dealCombatDamage] Created 1 Treasure token for ${controllerId} from ${trigger.cardName}`);
              } catch (tokenErr) {
                debugError(1, `${ts()} [dealCombatDamage] Failed to create Treasure token:`, tokenErr);
              }
            }
          }
        }
      }
    }
    
  } catch (err) {
    debugWarn(1, `${ts()} dealCombatDamage failed:`, err);
  }
  
  return result;
}

/**
 * Clear damage from all permanents on the battlefield.
 * Rule 514.2 / 703.4p: During the cleanup step, all damage marked on permanents
 * is removed simultaneously. This happens after discarding to hand size and
 * before "until end of turn" effects end.
 * 
 * Damage can be tracked in multiple ways:
 * - `markedDamage`: Direct damage tracking property
 * - `damage`: Alternative damage tracking property
 * - `counters.damage`: Counter-based damage tracking
 */
function clearDamageFromPermanents(ctx: GameContext) {
  try {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return;
    
    let clearedCount = 0;
    
    for (const permanent of battlefield) {
      if (!permanent) continue;
      
      let hadDamage = false;
      
      // Clear markedDamage property
      if (permanent.markedDamage !== undefined && permanent.markedDamage > 0) {
        hadDamage = true;
        permanent.markedDamage = 0;
      }
      
      // Clear damage property (alternative tracking)
      if (permanent.damage !== undefined && permanent.damage > 0) {
        hadDamage = true;
        permanent.damage = 0;
      }
      
      // Clear damage counter if present (safely check for undefined)
      if (permanent.counters && typeof permanent.counters.damage === 'number' && permanent.counters.damage > 0) {
        hadDamage = true;
        permanent.counters.damage = 0;
      }
      
      if (hadDamage) {
        clearedCount++;
      }
    }
    
    if (clearedCount > 0) {
      debug(2, `${ts()} [clearDamageFromPermanents] Cleared damage from ${clearedCount} permanent(s) (Rule 514.2/703.4p)`);
    }
  } catch (err) {
    debugWarn(1, `${ts()} clearDamageFromPermanents failed:`, err);
  }
}

/**
 * End all "until end of turn" and "this turn" effects.
 * Rule 514.2: These effects end simultaneously with damage removal during cleanup.
 */
function endTemporaryEffects(ctx: GameContext) {
  try {
    const state = (ctx as any).state;
    if (!state) return;
    
    let endedCount = 0;
    
    // Clear temporary effects stored on battlefield permanents
    const battlefield = state.battlefield || [];
    for (const permanent of battlefield) {
      if (!permanent) continue;
      
      // Clear "until end of turn" modifiers
      if (permanent.untilEndOfTurn) {
        delete permanent.untilEndOfTurn;
        endedCount++;
      }
      
      // Clear temporary power/toughness modifications
      if (permanent.tempPowerMod !== undefined) {
        delete permanent.tempPowerMod;
        endedCount++;
      }
      if (permanent.tempToughnessMod !== undefined) {
        delete permanent.tempToughnessMod;
        endedCount++;
      }
      
      // Clear temporary granted abilities
      if (permanent.tempAbilities && permanent.tempAbilities.length > 0) {
        permanent.tempAbilities = [];
        endedCount++;
      }
      
      // Clear "this turn" flags
      if (permanent.summoningSickness === false && permanent.enteredThisTurn) {
        // If it entered this turn, reset summoning sickness handling
        delete permanent.enteredThisTurn;
      }
      
      // Clear "attacked this turn" and similar combat flags
      if (permanent.attackedThisTurn) {
        delete permanent.attackedThisTurn;
      }
      if (permanent.blockedThisTurn) {
        delete permanent.blockedThisTurn;
      }
      
      // Clear Steel Hellkite combat damage tracking
      if (permanent.dealtCombatDamageTo) {
        delete permanent.dealtCombatDamageTo;
        endedCount++;
      }
      
      // Clear "activated this turn" flags for once-per-turn abilities
      if (permanent.activatedThisTurn) {
        delete permanent.activatedThisTurn;
        endedCount++;
      }
      
      // Clear crewed status from vehicles (they stop being creatures at end of turn)
      if (permanent.crewed) {
        delete permanent.crewed;
        // Remove granted Creature type from crew effect
        if (permanent.grantedTypes && Array.isArray(permanent.grantedTypes)) {
          permanent.grantedTypes = permanent.grantedTypes.filter((t: string) => t !== 'Creature');
        }
        endedCount++;
      }
    }
    
    // Clear game-level temporary effects
    if (state.temporaryEffects && state.temporaryEffects.length > 0) {
      const beforeCount = state.temporaryEffects.length;
      state.temporaryEffects = state.temporaryEffects.filter((effect: any) => 
        effect.duration !== 'until_end_of_turn' && effect.duration !== 'this_turn'
      );
      endedCount += beforeCount - state.temporaryEffects.length;
    }
    
    // Clear creatures attacked this turn count (for Minas Tirith, etc.)
    if (state.creaturesAttackedThisTurn) {
      state.creaturesAttackedThisTurn = {};
      debug(2, `${ts()} [endTemporaryEffects] Cleared creaturesAttackedThisTurn tracking`);
    }
    
    if (endedCount > 0) {
      debug(2, `${ts()} [endTemporaryEffects] Ended ${endedCount} temporary effect(s) (Rule 514.2)`);
    }
  } catch (err) {
    debugWarn(1, `${ts()} endTemporaryEffects failed:`, err);
  }
}

/**
 * Clear summoning sickness from all permanents controlled by the specified player.
 * Rule 302.6: A creature's activated ability with tap/untap symbol can't be
 * activated unless the creature has been under its controller's control continuously
 * since their most recent turn began.
 * 
 * This is called at the start of the player's turn. Once a creature has been
 * controlled since the turn began, it no longer has summoning sickness.
 */
function clearSummoningSicknessForPlayer(ctx: GameContext, playerId: string) {
  try {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return;

    let clearedCount = 0;

    for (const permanent of battlefield) {
      if (permanent && permanent.controller === playerId && permanent.summoningSickness) {
        permanent.summoningSickness = false;
        clearedCount++;
      }
    }

    if (clearedCount > 0) {
      debug(2, `${ts()} [clearSummoningSicknessForPlayer] Cleared summoning sickness from ${clearedCount} permanent(s) for ${playerId}`);
    }
  } catch (err) {
    debugWarn(1, `${ts()} clearSummoningSicknessForPlayer failed:`, err);
  }
}

/**
 * Known cards with activated abilities that end the turn.
 * This whitelist is more reliable than pattern matching oracle text.
 * Cards on this list have "{cost}: End the turn" style abilities that can be
 * activated during cleanup step.
 */
const SUNDIAL_EFFECT_CARDS = new Set([
  "sundial of the infinite",
  "obeka, brute chronologist",
  "obeka, splitter of seconds",
]);

/**
 * Check if a permanent has an activated "end the turn" ability.
 * Uses a whitelist of known cards plus pattern matching for edge cases.
 * 
 * Pattern matching rules:
 * - Must have "end the turn" in oracle text
 * - Must have activation cost indicator (colon ':')
 * - Must NOT be a triggered ability ("at the beginning", "when", "whenever")
 * - Must NOT be a spell effect only (needs to be an activated ability on a permanent)
 */
function hasEndTurnActivatedAbility(cardName: string, oracleText: string): boolean {
  const nameLower = cardName.toLowerCase();
  const oracleLower = oracleText.toLowerCase();
  
  // Check whitelist first for known cards
  if (SUNDIAL_EFFECT_CARDS.has(nameLower)) {
    return true;
  }
  
  // Pattern match for other potential cards with activated "end the turn" abilities
  if (!oracleLower.includes("end the turn")) {
    return false;
  }
  
  // Must have activation cost indicator (like ":" or "{T}:")
  if (!oracleLower.includes(":")) {
    return false;
  }
  
  // Exclude triggered abilities (these aren't activated abilities)
  if (oracleLower.includes("at the beginning") || 
      oracleLower.includes("when ") || 
      oracleLower.includes("whenever ")) {
    // Check if "end the turn" appears in the triggered ability part
    // by looking for cost indicator before "end the turn"
    const endTurnIndex = oracleLower.indexOf("end the turn");
    const colonIndex = oracleLower.lastIndexOf(":", endTurnIndex);
    const triggerIndex = Math.max(
      oracleLower.lastIndexOf("at the beginning", endTurnIndex),
      oracleLower.lastIndexOf("when ", endTurnIndex),
      oracleLower.lastIndexOf("whenever ", endTurnIndex)
    );
    
    // If the trigger keyword is after the last colon before "end the turn",
    // this is likely a triggered ability, not activated
    if (triggerIndex > colonIndex) {
      return false;
    }
  }
  
  return true;
}

/**
 * Check if any player has a "Sundial-like" effect available.
 * Sundial of the Infinite and similar cards can end the turn during cleanup,
 * which means players should be given priority during cleanup if they control
 * such an effect.
 * 
 * Rule 514.3: Players normally don't get priority during cleanup step unless
 * state-based actions are performed or abilities trigger. However, if a player
 * has an ability that could affect the game during cleanup (like Sundial),
 * we should give them an opportunity to act.
 * 
 * This function iterates the battlefield once and checks all permanents.
 */
function anyPlayerHasSundialEffect(ctx: GameContext): boolean {
  try {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return false;
    
    // Single pass through the battlefield
    for (const permanent of battlefield) {
      if (!permanent || !permanent.card) continue;
      
      const cardName = permanent.card.name || "";
      const oracleText = permanent.card.oracle_text || "";
      
      if (hasEndTurnActivatedAbility(cardName, oracleText)) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    debugWarn(1, `${ts()} [anyPlayerHasSundialEffect] Error checking for Sundial effects:`, err);
    return false;
  }
}

/**
 * Untap all permanents controlled by the specified player.
 * This implements Rule 502.3: During the untap step, the active player
 * untaps all their permanents simultaneously.
 * 
 * Special handling:
 * - Stun counters (Rule 122.1c): Instead of untapping, remove a stun counter
 * - "Doesn't untap" effects: Skip untapping for permanents with this flag
 * - Static effects: Check for cards like Intruder Alarm that prevent untapping
 */
/**
 * Untap all lands controlled by a specific player
 * Used for Nature's Will, Bear Umbra, Sword of Feast and Famine, etc.
 */
function untapLandsForPlayer(ctx: GameContext, playerId: string) {
  try {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return;

    let untappedCount = 0;

    for (const permanent of battlefield) {
      if (!permanent || permanent.controller !== playerId) continue;
      if (!permanent.tapped) continue;
      
      const typeLine = (permanent.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('land')) continue;

      // Untap the land
      permanent.tapped = false;
      untappedCount++;
    }

    if (untappedCount > 0) {
      debug(2, 
        `${ts()} [untapLandsForPlayer] Untapped ${untappedCount} lands for player ${playerId}`
      );
    }
  } catch (err) {
    debugWarn(1, `${ts()} untapLandsForPlayer failed:`, err);
  }
}

function untapPermanentsForPlayer(ctx: GameContext, playerId: string) {
  try {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return;

    let untappedCount = 0;
    let stunCountersRemoved = 0;
    let skippedDueToEffects = 0;

    for (const permanent of battlefield) {
      if (permanent && permanent.controller === playerId && permanent.tapped) {
        // Check for "doesn't untap during untap step" flag on the permanent
        const doesntUntap = permanent.doesntUntap || false;
        if (doesntUntap) {
          skippedDueToEffects++;
          continue;
        }

        // Check for static effects that prevent untapping (Intruder Alarm, Claustrophobia, etc.)
        try {
          if (isPermanentPreventedFromUntapping(ctx, permanent, playerId)) {
            skippedDueToEffects++;
            continue;
          }
        } catch (e) {
          // If check fails, allow untapping to prevent game state from getting stuck
          debugWarn(1, `${ts()} [untapPermanentsForPlayer] Failed to check untap prevention for ${permanent.card?.name}:`, e);
        }

        // Check for stun counters (Rule 122.1c)
        // If a tapped permanent with a stun counter would become untapped, instead remove a stun counter
        if (permanent.counters && permanent.counters.stun > 0) {
          // Remove one stun counter instead of untapping
          permanent.counters.stun -= 1;
          if (permanent.counters.stun === 0) {
            delete permanent.counters.stun;
          }
          stunCountersRemoved++;
          // Permanent stays tapped
          continue;
        }

        // Normal untap
        permanent.tapped = false;
        untappedCount++;
      }
    }

    // Clear any "doesn't untap next turn" flags that were set by spells like Sleep
    for (const permanent of battlefield) {
      if (permanent && permanent.controller === playerId && permanent.doesntUntapNextTurn) {
        delete permanent.doesntUntapNextTurn;
      }
    }

    if (untappedCount > 0 || stunCountersRemoved > 0 || skippedDueToEffects > 0) {
      debug(2, 
        `${ts()} [untapPermanentsForPlayer] Player ${playerId}: untapped ${untappedCount}, stun counters removed ${stunCountersRemoved}, skipped (doesn't untap) ${skippedDueToEffects}`
      );
    }
  } catch (err) {
    debugWarn(1, `${ts()} untapPermanentsForPlayer failed:`, err);
  }
}

/**
 * nextTurn: advance to next player's turn
 * - Checks for extra turns first (Rule 500.7)
 * - Updates turnPlayer to the next player in order
 * - Resets phase to "beginning" (start of turn)
 * - Sets step to "UNTAP" 
 * - Clears summoning sickness for the new active player's creatures (Rule 302.6)
 * - Untaps all permanents controlled by the new active player
 * - Gives priority to the active player
 * - Resets landsPlayedThisTurn for all players
 */
export function nextTurn(ctx: GameContext) {
  try {
    (ctx as any).state = (ctx as any).state || {};
    const allPlayers = Array.isArray((ctx as any).state.players)
      ? (ctx as any).state.players.map((p: any) => p.id)
      : [];
    if (!allPlayers.length) return;
    
    // Get inactive set to filter out defeated players
    const inactiveSet: Set<string> = 
      (ctx as any).inactive instanceof Set ? (ctx as any).inactive : new Set<string>();
    
    // Filter to only active (non-defeated) players
    const players = allPlayers.filter((id: string) => !inactiveSet.has(id));
    if (!players.length) {
      debug(2, `${ts()} [nextTurn] No active players remaining, game should end`);
      return;
    }
    
    const current = (ctx as any).state.turnPlayer;
    
    // Increment turn number
    (ctx as any).state.turnNumber = ((ctx as any).state.turnNumber || 0) + 1;
    const turnNumber = (ctx as any).state.turnNumber;
    
    // Rule 500.7: Check for extra turns
    // Extra turns are stored in a LIFO stack (most recently created is taken first)
    let next: string;
    const extraTurns = (ctx as any).state.extraTurns as any[] || [];
    
    if (extraTurns.length > 0) {
      // Take the first extra turn from the stack
      const extraTurn = extraTurns.shift();
      next = extraTurn.playerId;
      // Skip extra turn if player is inactive
      if (inactiveSet.has(next)) {
        debug(1, `${ts()} [nextTurn] Skipping extra turn for inactive player ${next}`);
        // Recursive call to get next turn
        nextTurn(ctx);
        return;
      }
      debug(2, `${ts()} [nextTurn] Taking extra turn for ${next} (turn ${turnNumber})`);
    } else {
      // Normal turn progression - find next active player
      const currentIdx = players.indexOf(current);
      // If current player is inactive or not found, start from first active player
      if (currentIdx === -1) {
        next = players[0];
      } else {
        next = players[(currentIdx + 1) % players.length];
      }
    }
    
    (ctx as any).state.turnPlayer = next;

    // Remove expired goad effects at the start of this player's turn (Rule 701.15a)
    try {
      const battlefield = (ctx as any).state.battlefield || [];
      const updatedBattlefield = removeExpiredGoads(battlefield, turnNumber, next);
      (ctx as any).state.battlefield = updatedBattlefield;
    } catch (err) {
      debugWarn(1, `${ts()} [nextTurn] Failed to remove expired goads:`, err);
    }

    // Reset to beginning of turn
    (ctx as any).state.phase = "beginning";
    (ctx as any).state.step = "UNTAP";
    
    // Clear combat-related state from previous turn
    if ((ctx as any).state.blockersDeclaredBy) {
      delete (ctx as any).state.blockersDeclaredBy;
    }

    // Rule 302.6: Clear summoning sickness at the BEGINNING of the turn
    // This is independent of untapping - a creature that doesn't untap due to
    // an effect still loses summoning sickness at the start of its controller's turn
    try {
      clearSummoningSicknessForPlayer(ctx, next);
    } catch (err) {
      debugWarn(1, `${ts()} [nextTurn] Failed to clear summoning sickness:`, err);
    }

    // Note: Untapping happens when leaving the UNTAP step (in nextStep),
    // not at the start of the turn. This matches MTG rules where turn-based
    // actions occur during the step, and allows cards to be played/tapped
    // during the untap step before untapping occurs.

    // Rule 502.1: No player receives priority during the untap step.
    // Priority will be given when UNTAP advances to UPKEEP.
    // Set priority to null during UNTAP step to indicate no player has priority.
    (ctx as any).state.priority = null;
    
    // Clear temporary land bonuses from the previous turn
    // These are granted by spells like Summer Bloom and expire at end of turn
    try {
      clearTemporaryLandBonuses(ctx);
    } catch (err) {
      debugWarn(1, `${ts()} [nextTurn] Failed to clear temporary land bonuses:`, err);
    }
    
    // Reset planeswalker loyalty activation counters for the active player's permanents
    // Rule 606.3: Each loyalty ability can only be activated once per turn (or more with Chain Veil/Oath of Teferi)
    try {
      const battlefield = (ctx as any).state.battlefield || [];
      for (const perm of battlefield) {
        if (perm && perm.controller === next) {
          // Reset both the old boolean flag and the new counter for compatibility
          if (perm.loyaltyActivatedThisTurn) {
            perm.loyaltyActivatedThisTurn = false;
          }
          if (perm.loyaltyActivationsThisTurn) {
            perm.loyaltyActivationsThisTurn = 0;
          }
        }
      }
      debug(2, `${ts()} [nextTurn] Reset planeswalker loyalty activation counters for player ${next}`);
    } catch (err) {
      debugWarn(1, `${ts()} [nextTurn] Failed to reset planeswalker loyalty flags:`, err);
    }
    
    // Immediately advance from UNTAP to UPKEEP (Rule 502.1: untap step has no priority)
    // Untap all permanents controlled by the active player
    try {
      untapPermanentsForPlayer(ctx, next);
      
      // Apply Unwinding Clock, Seedborn Muse, and similar effects
      const untapEffects = getUntapStepEffects(ctx, next);
      for (const effect of untapEffects) {
        const count = applyUntapStepEffect(ctx, effect);
        if (count > 0) {
          debug(2, `${ts()} [nextTurn] ${effect.cardName} untapped ${count} permanents for ${effect.controllerId}`);
        }
      }
    } catch (err) {
      debugWarn(1, `${ts()} [nextTurn] Failed to untap permanents:`, err);
    }
    
    // Advance to UPKEEP step
    (ctx as any).state.step = "UPKEEP";
    
    // Now give priority to the active player at UPKEEP (Rule 503.1)
    (ctx as any).state.priority = next;

    // Clear auto-pass for turn flags when starting a new turn
    // This resets the "Auto-Pass Rest of Turn" setting for all players
    if ((ctx as any).state.autoPassForTurn) {
      (ctx as any).state.autoPassForTurn = {};
      debug(2, `${ts()} [nextTurn] Cleared autoPassForTurn flags for new turn`);
    }
    
    // Clear noncreature spells cast this turn counter (for Esper Sentinel, Rhystic Study, etc.)
    // These abilities trigger on each player's FIRST noncreature spell each turn
    if ((ctx as any).state.noncreatureSpellsCastThisTurn) {
      (ctx as any).state.noncreatureSpellsCastThisTurn = {};
      debug(2, `${ts()} [nextTurn] Cleared noncreatureSpellsCastThisTurn for new turn`);
    }
    
    // Clear justSkippedToPhase flag when starting a new turn
    // Players need to use phase navigator again if they want priority protection
    if ((ctx as any).state.justSkippedToPhase) {
      delete (ctx as any).state.justSkippedToPhase;
      debug(2, `${ts()} [nextTurn] Cleared justSkippedToPhase flag for new turn`);
    }

    debug(2, `${ts()} [nextTurn] Advanced to player ${next}, phase=${(ctx as any).state.phase}, step=${(ctx as any).state.step}`);
    
    // After granting priority at UPKEEP, check if we should auto-pass for players who cannot act
    // This ensures that auto-pass works immediately when starting a turn
    try {
      debug(2, `${ts()} [nextTurn] Checking if auto-pass should apply at upkeep`);
      const autoPassResult = tryAutoPass(ctx);
      
      // Store the auto-pass result in the state so the caller can check it
      (ctx as any).state._autoPassResult = autoPassResult;
      
      if (autoPassResult.allPassed && autoPassResult.advanceStep) {
        // All players auto-passed with empty stack - mark flag for caller to handle
        debug(2, `${ts()} [nextTurn] All players auto-passed at upkeep - caller should advance step`);
      } else if (autoPassResult.allPassed && autoPassResult.resolved) {
        // All players auto-passed and stack was resolved
        debug(2, `${ts()} [nextTurn] All players auto-passed at upkeep and stack item resolved`);
      } else {
        // Auto-pass stopped at a player who can act, or auto-pass is not enabled
        debug(2, `${ts()} [nextTurn] Auto-pass stopped at upkeep, player ${(ctx as any).state.priority} has priority`);
      }
    } catch (err) {
      debugWarn(1, `${ts()} [nextTurn] Failed to run auto-pass check at upkeep:`, err);
    }

    // Reset lands played this turn for all players
    (ctx as any).state.landsPlayedThisTurn = (ctx as any).state.landsPlayedThisTurn || {};
    for (const pid of players) {
      (ctx as any).state.landsPlayedThisTurn[pid] = 0;
    }
    
    // Reset cards drawn this turn for all players (for miracle tracking)
    (ctx as any).state.cardsDrawnThisTurn = {};
    
    // Reset tracking of creatures that dealt damage to players this turn
    // This is used for cards like Reciprocate that can only target creatures that dealt damage to you this turn
    (ctx as any).state.creaturesThatDealtDamageToPlayer = {};

    // Recalculate player effects based on battlefield (Exploration, Font of Mythos, etc.)
    try {
      recalculatePlayerEffects(ctx);
    } catch (err) {
      debugWarn(1, `${ts()} [nextTurn] Failed to recalculate player effects:`, err);
    }

    ctx.bumpSeq();
  } catch (err) {
    debugWarn(1, `${ts()} nextTurn failed:`, err);
  }
}

/**
 * Clear the mana pool for all players.
 * Called when phases change, as mana empties from pools at the end of each step/phase.
 * 
 * Rule 106.4: Unless a player has an effect preventing mana from emptying (like
 * Horizon Stone, Omnath Locus of Mana, or Kruphix God of Horizons), all unspent
 * mana empties from the pool at the end of each step and phase.
 */
function clearManaPool(ctx: GameContext) {
  try {
    if (!(ctx as any).state) return;
    
    const players = Array.isArray((ctx as any).state.players)
      ? (ctx as any).state.players.map((p: any) => p.id)
      : [];
    
    if (!players.length) return;
    
    (ctx as any).state.manaPool = (ctx as any).state.manaPool || {};
    
    // Detect mana retention effects inline (to avoid circular dependencies)
    const detectManaRetentionEffectsLocal = (gameState: any, playerId: string) => {
      const effects: { permanentId: string; cardName: string; type: string; colors?: string[]; color?: string }[] = [];
      const battlefield = gameState?.battlefield || [];
      
      for (const permanent of battlefield) {
        if (!permanent || permanent.controller !== playerId) continue;
        
        const cardName = (permanent.card?.name || "").toLowerCase();
        const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
        
        // Omnath, Locus of Mana - Green mana doesn't empty
        if (cardName.includes("omnath, locus of mana") || 
            (oracleText.includes("green mana") && oracleText.includes("doesn't empty"))) {
          effects.push({
            permanentId: permanent.id,
            cardName: permanent.card?.name || "Omnath",
            type: 'doesnt_empty',
            colors: ['green'],
          });
        }
        
        // Leyline Tyrant - Red mana doesn't empty
        // Oracle text: "You don't lose unspent red mana as steps and phases end."
        // Handle different apostrophe styles (straight ' vs curly ')
        if (cardName.includes("leyline tyrant") ||
            (oracleText.includes("red mana") && 
             (oracleText.includes("don't lose") || oracleText.includes("don’t lose") || 
              oracleText.includes("doesn't empty") || oracleText.includes("doesn’t empty")))) {
          effects.push({
            permanentId: permanent.id,
            cardName: permanent.card?.name || "Leyline Tyrant",
            type: 'doesnt_empty',
            colors: ['red'],
          });
        }
        
        // Ozai, the Phoenix King - Unspent mana becomes red instead
        // Pattern: "If you would lose unspent mana, that mana becomes red instead"
        // Handle different apostrophe styles and slight text variations
        if (cardName.includes("ozai") || 
            (oracleText.includes("lose unspent mana") && oracleText.includes("becomes red instead")) ||
            (oracleText.includes("would lose") && oracleText.includes("mana") && oracleText.includes("becomes red"))) {
          effects.push({
            permanentId: permanent.id,
            cardName: permanent.card?.name || "Ozai, the Phoenix King",
            type: 'becomes_color',
            color: 'red',
          });
        }
        
        // Kruphix, God of Horizons / Horizon Stone - Unspent mana becomes colorless
        if (cardName.includes("kruphix") || cardName.includes("horizon stone") ||
            oracleText.includes("mana becomes colorless instead")) {
          effects.push({
            permanentId: permanent.id,
            cardName: permanent.card?.name || "Horizon Stone",
            type: 'becomes_colorless',
          });
        }
        
        // Upwelling / Eladamri's Vineyard style - All mana doesn't empty
        if (cardName.includes("upwelling") ||
            (oracleText.includes("mana pools") && oracleText.includes("don't empty"))) {
          effects.push({
            permanentId: permanent.id,
            cardName: permanent.card?.name || "Upwelling",
            type: 'all_doesnt_empty',
          });
        }
      }
      
      return effects;
    };
    
    for (const pid of players) {
      const currentPool = (ctx as any).state.manaPool[pid] || {};
      
      // Detect mana retention effects from battlefield permanents
      const retentionEffects = detectManaRetentionEffectsLocal((ctx as any).state, pid);
      
      // Collect colors that should be retained
      const colorsToRetain = new Set<string>();
      let convertToColorless = false;
      let convertToColor: string | null = null;
      let retainAllMana = false;
      
      for (const effect of retentionEffects) {
        if (effect.type === 'all_doesnt_empty') {
          retainAllMana = true;
        } else if (effect.type === 'becomes_colorless') {
          convertToColorless = true;
        } else if (effect.type === 'doesnt_empty' && effect.colors) {
          for (const color of effect.colors) {
            colorsToRetain.add(color);
          }
        } else if (effect.type === 'becomes_color' && effect.color) {
          // Track conversion to a specific color (Ozai -> red)
          convertToColor = effect.color;
        }
      }
      
      // Also check legacy doesNotEmpty flag on the pool itself
      if (currentPool.doesNotEmpty) {
        const targetColor = currentPool.convertsTo || (currentPool.convertsToColorless ? 'colorless' : null);
        if (targetColor) {
          if (targetColor === 'colorless') {
            convertToColorless = true;
          } else {
            convertToColor = targetColor;
          }
        } else {
          retainAllMana = true;
        }
      }
      
      if (retainAllMana) {
        // Mana doesn't empty at all (e.g., Upwelling, or legacy doesNotEmpty without convertsTo)
        debug(2, `${ts()} [clearManaPool] Player ${pid}: Mana pool preserved (all mana doesn't empty)`);
        continue;
      }
      
      // Handle "mana becomes [color] instead" (Ozai -> red)
      if (convertToColor && convertToColor !== 'colorless') {
        const allColors = ['white', 'blue', 'black', 'red', 'green', 'colorless'];
        let totalConverted = 0;
        
        // Sum up all mana that will be converted (excluding the target color and any retained colors)
        for (const color of allColors) {
          if (color !== convertToColor && !colorsToRetain.has(color)) {
            totalConverted += (currentPool[color] || 0);
          }
        }
        
        const newPool: any = {
          white: 0,
          blue: 0,
          black: 0,
          red: 0,
          green: 0,
          colorless: 0,
          doesNotEmpty: currentPool.doesNotEmpty,
          convertsTo: currentPool.convertsTo,
          noEmptySourceIds: currentPool.noEmptySourceIds,
        };
        
        // Add all converted mana to the target color
        newPool[convertToColor] = (currentPool[convertToColor] || 0) + totalConverted;
        
        // Keep any colors that should be retained separately
        for (const color of colorsToRetain) {
          if (color !== convertToColor) {
            newPool[color] = currentPool[color] || 0;
          }
        }
        
        // Keep restricted mana (but convert color)
        if (currentPool.restricted) {
          newPool.restricted = currentPool.restricted.map((entry: any) => ({
            ...entry,
            type: colorsToRetain.has(entry.type) ? entry.type : convertToColor,
          }));
        }
        
        (ctx as any).state.manaPool[pid] = newPool;
        debug(1, `${ts()} [clearManaPool] Player ${pid}: Converted ${totalConverted} mana to ${convertToColor}, retained: ${Array.from(colorsToRetain).join(', ') || 'none'}`);
        continue;
      }
      
      if (convertToColorless) {
        // Convert all mana to colorless instead of emptying (Kruphix, Horizon Stone)
        const allColors = ['white', 'blue', 'black', 'red', 'green'];
        let totalConverted = 0;
        
        // Sum up all colored mana (except colorless)
        for (const color of allColors) {
          if (!colorsToRetain.has(color)) {
            totalConverted += (currentPool[color] || 0);
          }
        }
        
        const newPool: any = {
          white: 0,
          blue: 0,
          black: 0,
          red: 0,
          green: 0,
          colorless: (currentPool.colorless || 0) + totalConverted,
          doesNotEmpty: currentPool.doesNotEmpty,
          convertsTo: currentPool.convertsTo,
          convertsToColorless: currentPool.convertsToColorless,
          noEmptySourceIds: currentPool.noEmptySourceIds,
        };
        
        // Keep any colors that should be retained (e.g., if both Kruphix and Omnath are out)
        for (const color of colorsToRetain) {
          newPool[color] = currentPool[color] || 0;
        }
        
        // Keep restricted mana (but convert color)
        if (currentPool.restricted) {
          newPool.restricted = currentPool.restricted.map((entry: any) => ({
            ...entry,
            type: colorsToRetain.has(entry.type) ? entry.type : 'colorless',
          }));
        }
        
        (ctx as any).state.manaPool[pid] = newPool;
        debug(1, `${ts()} [clearManaPool] Player ${pid}: Converted ${totalConverted} mana to colorless, retained: ${Array.from(colorsToRetain).join(', ') || 'none'}`);
        
      } else if (colorsToRetain.size > 0) {
        // Some colors are retained (e.g., Omnath for green, Leyline Tyrant for red)
        const newPool: any = {
          white: colorsToRetain.has('white') ? (currentPool.white || 0) : 0,
          blue: colorsToRetain.has('blue') ? (currentPool.blue || 0) : 0,
          black: colorsToRetain.has('black') ? (currentPool.black || 0) : 0,
          red: colorsToRetain.has('red') ? (currentPool.red || 0) : 0,
          green: colorsToRetain.has('green') ? (currentPool.green || 0) : 0,
          colorless: colorsToRetain.has('colorless') ? (currentPool.colorless || 0) : 0,
        };
        
        // Keep restricted mana of retained colors
        if (currentPool.restricted) {
          newPool.restricted = currentPool.restricted.filter((entry: any) => 
            colorsToRetain.has(entry.type)
          );
          if (newPool.restricted.length === 0) delete newPool.restricted;
        }
        
        (ctx as any).state.manaPool[pid] = newPool;
        
        const retainedInfo = Array.from(colorsToRetain).map(c => `${c}: ${newPool[c] || 0}`).join(', ');
        debug(2, `${ts()} [clearManaPool] Player ${pid}: Retained mana for colors: ${retainedInfo}`);
        
      } else {
        // Normal case: empty the pool completely
        (ctx as any).state.manaPool[pid] = {
          white: 0,
          blue: 0,
          black: 0,
          red: 0,
          green: 0,
          colorless: 0,
        };
      }
    }
    
    debug(2, `${ts()} [clearManaPool] Processed mana pools for all players`);
  } catch (err) {
    debugWarn(1, `${ts()} clearManaPool failed:`, err);
  }
}

/**
 * Get the maximum hand size for a player.
 * Default is 7, but effects like "no maximum hand size" can change this.
 * 
 * Considers:
 * 1. Permanent effects (Reliquary Tower, Thought Vessel, Spellbook, Venser's Journal)
 * 2. Spell effects that persist (Praetor's Counsel - "for the rest of the game")
 * 3. Player-specific state overrides
 * 4. Emblems with hand size effects
 * 
 * @param ctx Game context
 * @param playerId Player ID
 * @returns Maximum hand size for the player (Infinity for no maximum)
 */
function getMaxHandSize(ctx: GameContext, playerId: string): number {
  try {
    // Check if player has "no maximum hand size" effect
    const state = (ctx as any).state;
    if (!state) return 7;
    
    // Check player-specific overrides (set by spells like Praetor's Counsel)
    // maxHandSize can be: a number, Infinity, or undefined
    const playerMaxHandSize = state.maxHandSize?.[playerId];
    if (playerMaxHandSize === Infinity || playerMaxHandSize === Number.POSITIVE_INFINITY) {
      return Infinity;
    }
    
    // Check for "no maximum hand size" flags set by resolved spells
    // This handles Praetor's Counsel and similar effects
    const noMaxHandSize = state.noMaximumHandSize?.[playerId];
    if (noMaxHandSize === true) {
      return Infinity;
    }
    
    // Check player effects array for hand size modifications
    const playerEffects = state.playerEffects?.[playerId] || [];
    for (const effect of playerEffects) {
      if (effect && (effect.type === 'no_maximum_hand_size' || 
                     effect.effect === 'no_maximum_hand_size')) {
        return Infinity;
      }
    }
    
    // Check for battlefield permanents that grant "no maximum hand size"
    // Examples: Reliquary Tower, Thought Vessel, Spellbook, Venser's Journal
    const battlefield = state.battlefield || [];
    for (const perm of battlefield) {
      if (perm && perm.controller === playerId) {
        const oracle = (perm.card?.oracle_text || "").toLowerCase();
        if (oracle.includes("you have no maximum hand size") ||
            oracle.includes("no maximum hand size")) {
          return Infinity;
        }
      }
    }
    
    // Check emblems controlled by the player
    const emblems = state.emblems || [];
    for (const emblem of emblems) {
      if (emblem && emblem.controller === playerId) {
        const effect = (emblem.effect || emblem.text || "").toLowerCase();
        if (effect.includes("no maximum hand size")) {
          return Infinity;
        }
      }
    }
    
    // Check for a numeric override
    if (typeof playerMaxHandSize === "number" && playerMaxHandSize > 0) {
      return playerMaxHandSize;
    }
    
    // Default maximum hand size
    return 7;
  } catch (err) {
    debugWarn(1, `${ts()} getMaxHandSize failed:`, err);
    return 7;
  }
}

/**
 * Setup cleanup step discard for the active player.
 * Rule 514.1: At the beginning of the cleanup step, if the active player's hand
 * contains more cards than their maximum hand size, they discard enough cards
 * to reduce their hand to that number.
 * 
 * This checks if discard is needed and sets up the pending selection state for interactive choice.
 * Returns: { needsInteraction: boolean, discardCount: number }
 */
function setupCleanupDiscard(ctx: GameContext, playerId: string): { needsInteraction: boolean; discardCount: number } {
  try {
    const state = (ctx as any).state;
    if (!state) return { needsInteraction: false, discardCount: 0 };
    
    const maxHandSize = getMaxHandSize(ctx, playerId);
    if (maxHandSize === Infinity) {
      return { needsInteraction: false, discardCount: 0 }; // No maximum hand size
    }
    
    // Check if there's already a pending discard selection
    if (state.pendingDiscardSelection?.[playerId]) {
      return { needsInteraction: true, discardCount: state.pendingDiscardSelection[playerId].count };
    }
    
    // Get player's hand from state.zones (authoritative source)
    let hand: any[] = [];
    const zones = state.zones || {};
    const playerZones = zones[playerId];
    if (playerZones && Array.isArray(playerZones.hand)) {
      hand = playerZones.hand;
    }
    
    if (hand.length === 0) {
      // Try handCount as a fallback (some views only sync count, not full hand)
      const handCount = playerZones?.handCount ?? 0;
      if (handCount <= maxHandSize) {
        return { needsInteraction: false, discardCount: 0 };
      }
      const discardCount = handCount - maxHandSize;
      
      state.pendingDiscardSelection = state.pendingDiscardSelection || {};
      state.pendingDiscardSelection[playerId] = {
        count: discardCount,
        maxHandSize,
        handSize: handCount,
      };
      
      debug(2, 
        `${ts()} [setupCleanupDiscard] Player ${playerId} needs to discard ${discardCount} cards (handCount: ${handCount}, max: ${maxHandSize})`
      );
      
      return { needsInteraction: true, discardCount };
    }
    
    const handSize = hand.length;
    
    if (handSize <= maxHandSize) {
      return { needsInteraction: false, discardCount: 0 }; // Already at or below max
    }
    
    const discardCount = handSize - maxHandSize;
    
    // Set up pending discard selection for interactive choice
    state.pendingDiscardSelection = state.pendingDiscardSelection || {};
    state.pendingDiscardSelection[playerId] = {
      count: discardCount,
      maxHandSize,
      handSize,
    };
    
    debug(2, 
      `${ts()} [setupCleanupDiscard] Player ${playerId} needs to discard ${discardCount} cards (hand: ${handSize}, max: ${maxHandSize})`
    );
    
    return { needsInteraction: true, discardCount };
  } catch (err) {
    debugWarn(1, `${ts()} setupCleanupDiscard failed:`, err);
    return { needsInteraction: false, discardCount: 0 };
  }
}

/**
 * Execute the actual discard for cleanup step with player-selected cards.
 * Called when player confirms their discard selection.
 */
export function executeCleanupDiscard(ctx: GameContext, playerId: string, cardIds: string[]): boolean {
  try {
    const state = (ctx as any).state;
    if (!state) return false;
    
    const pendingDiscard = state.pendingDiscardSelection?.[playerId];
    if (!pendingDiscard) {
      debugWarn(2, `${ts()} [executeCleanupDiscard] No pending discard for player ${playerId}`);
      return false;
    }
    
    if (cardIds.length !== pendingDiscard.count) {
      debugWarn(2, `${ts()} [executeCleanupDiscard] Wrong number of cards: expected ${pendingDiscard.count}, got ${cardIds.length}`);
      return false;
    }
    
    // Get player's hand
    const zones = state.zones?.[playerId];
    if (!zones || !Array.isArray(zones.hand)) {
      return false;
    }
    
    const hand = zones.hand;
    const discardedCards = [];
    
    // Discard selected cards
    for (const cardId of cardIds) {
      const idx = hand.findIndex((c: any) => c?.id === cardId);
      if (idx !== -1) {
        const [card] = hand.splice(idx, 1);
        discardedCards.push(card);
        
        // Move card to graveyard
        zones.graveyard = zones.graveyard || [];
        card.zone = "graveyard";
        zones.graveyard.push(card);
      }
    }
    
    // Update counts
    zones.handCount = hand.length;
    zones.graveyardCount = zones.graveyard.length;
    
    // Clear the pending discard state
    delete state.pendingDiscardSelection[playerId];
    
    debug(2, 
      `${ts()} [executeCleanupDiscard] Player ${playerId} discarded ${discardedCards.length} cards`
    );
    
    ctx.bumpSeq();
    return true;
  } catch (err) {
    debugWarn(1, `${ts()} executeCleanupDiscard failed:`, err);
    return false;
  }
}

/**
 * nextStep: advance to next step within the current turn
 * Simple progression through main phases and steps.
 * Full step/phase automation would be more complex, but this provides basic progression.
 * 
 * When ctx.isReplaying is true, skip side effects (drawing, untapping, triggers, etc.)
 * because those actions should be handled by separate replayed events.
 */
export function nextStep(ctx: GameContext) {
  try {
    // ========================================================================
    // DEBUG: Track nextStep calls to diagnose auto-pass skip issues
    // ========================================================================
    const debugInfo = {
      timestamp: Date.now(),
      gameId: (ctx as any).gameId || 'unknown',
      currentPhase: String((ctx as any).state?.phase || "beginning"),
      currentStep: String((ctx as any).state?.step || ""),
      priority: (ctx as any).state?.priority,
      turnPlayer: (ctx as any).state?.turnPlayer,
      stackTrace: new Error().stack?.split('\n').slice(2, 6).join('\n    ') || 'no stack'
    };
    
    debug(2, `${ts()} [nextStep] ========== CALLED ==========`);
    debug(2, `${ts()} [nextStep] Game: ${debugInfo.gameId}`);
    debug(2, `${ts()} [nextStep] Current: ${debugInfo.currentPhase}/${debugInfo.currentStep}`);
    debug(2, `${ts()} [nextStep] Priority: ${debugInfo.priority}, Turn: ${debugInfo.turnPlayer}`);
    debug(2, `${ts()} [nextStep] Call stack:\n    ${debugInfo.stackTrace}`);
    // ========================================================================
    
    (ctx as any).state = (ctx as any).state || {};
    const currentPhase = String((ctx as any).state.phase || "beginning");
    const currentStep = String((ctx as any).state.step || "");
    
    // Check if we're in replay mode - if so, skip side effects
    const isReplaying = !!(ctx as any).isReplaying;

    // ========================================================================
    // PENDING INTERACTION CHECK
    // 
    // Before advancing to the next step/phase, ensure all pending UI interactions
    // are resolved. This prevents game state from advancing while players still
    // need to make choices (modal selections, target selections, etc.).
    // 
    // Skip this check during replay mode since those interactions were already
    // handled when the events were originally recorded.
    // ========================================================================
    if (!isReplaying) {
      const pendingCheck = checkPendingInteractions(ctx);
      if (pendingCheck.hasPending) {
        debug(1, `${ts()} [nextStep] BLOCKED: Cannot advance step - pending interactions: ${pendingCheck.pendingTypes.join(', ')}`);
        
        // Store the blocking reason in state for UI feedback
        (ctx as any).state.stepAdvanceBlocked = {
          blocked: true,
          reason: pendingCheck.pendingTypes,
          details: pendingCheck.details,
          timestamp: Date.now(),
        };
        
        // Don't advance - return early
        return;
      }
      
      // Clear any previous blocked state since we're now able to advance
      if ((ctx as any).state.stepAdvanceBlocked) {
        delete (ctx as any).state.stepAdvanceBlocked;
      }
    }

    // Simple step progression logic
    // beginning phase: UNTAP -> UPKEEP -> DRAW
    // precombatMain phase: MAIN1
    // combat phase: BEGIN_COMBAT -> DECLARE_ATTACKERS -> DECLARE_BLOCKERS -> DAMAGE -> END_COMBAT
    // postcombatMain phase: MAIN2
    // ending phase: END -> CLEANUP

    let nextPhase = currentPhase;
    let nextStep = currentStep;
    let shouldDraw = false;
    let shouldAdvanceTurn = false;
    let shouldUntap = false;

    // IMPORTANT: Do not advance from pre_game phase via nextStep.
    // The pre_game phase is for deck selection, commander selection, mulligan decisions, etc.
    // It should only be exited via explicit game start logic (when all players are ready).
    // Auto-pass and nextStep should NOT automatically advance from pre_game to beginning phase.
    if (currentPhase === "pre_game") {
      debug(2, `${ts()} [nextStep] In pre_game phase - nextStep should not be called during pre_game. Returning without advancing.`);
      return;
    }
    
    if (currentPhase === "beginning" || currentPhase === "") {
      if (currentStep === "" || currentStep === "untap" || currentStep === "UNTAP") {
        // UNTAP step: This should normally not happen since nextTurn auto-advances to UPKEEP
        // But keep this for backward compatibility with old save states or manual step control
        nextPhase = "beginning";
        nextStep = "UPKEEP";
        shouldUntap = !isReplaying; // Untap all permanents when leaving UNTAP step (skip during replay)
        // NOTE: Upkeep triggers will be pushed AFTER phase/step update below
      } else if (currentStep === "upkeep" || currentStep === "UPKEEP") {
        nextPhase = "beginning";
        nextStep = "DRAW";
        shouldDraw = !isReplaying; // Draw a card when entering draw step (skip during replay)
        // NOTE: Draw step triggers will be pushed AFTER phase/step update below
      } else {
        // After draw, go to precombatMain
        nextPhase = "precombatMain";
        nextStep = "MAIN1";
      }
    } else if (currentPhase === "precombatMain" || currentPhase === "main1") {
      nextPhase = "combat";
      nextStep = "BEGIN_COMBAT";
      // NOTE: Beginning of combat triggers will be pushed AFTER phase/step update below
    } else if (currentPhase === "combat") {
      if (currentStep === "beginCombat" || currentStep === "BEGIN_COMBAT") {
        nextStep = "DECLARE_ATTACKERS";
      } else if (currentStep === "declareAttackers" || currentStep === "DECLARE_ATTACKERS") {
        nextStep = "DECLARE_BLOCKERS";
        // Initialize blockersDeclaredBy array when entering DECLARE_BLOCKERS step
        // This ensures a fresh start for each blocker declaration phase
        (ctx as any).state.blockersDeclaredBy = [];
        debug(2, `${ts()} [nextStep] Entering DECLARE_BLOCKERS, initialized blockersDeclaredBy array`);
      } else if (currentStep === "declareBlockers" || currentStep === "DECLARE_BLOCKERS") {
        // Clear the blockersDeclaredBy tracking as we're leaving the step
        if ((ctx as any).state.blockersDeclaredBy) {
          delete (ctx as any).state.blockersDeclaredBy;
        }
        
        // Check if any creature has first strike or double strike
        // If so, go to FIRST_STRIKE_DAMAGE, otherwise go straight to DAMAGE
        const battlefield = (ctx as any).state?.battlefield || [];
        const attackers = battlefield.filter((perm: any) => perm && perm.attacking);
        const blockers = battlefield.filter((perm: any) => perm && perm.blocking && perm.blocking.length > 0);
        
        const hasFirstStrikeOrDoubleStrike = [...attackers, ...blockers].some((perm: any) => {
          const oracleText = (perm.card?.oracle_text || '').toLowerCase();
          const keywords = perm.card?.keywords || [];
          const grantedAbilities = perm.grantedAbilities || [];
          const allKeywords = [...keywords, ...grantedAbilities].map((k: any) => 
            typeof k === 'string' ? k.toLowerCase() : ''
          ).join(' ');
          const allText = oracleText + ' ' + allKeywords;
          return allText.includes('first strike') || allText.includes('double strike');
        });
        
        if (hasFirstStrikeOrDoubleStrike) {
          debug(2, `${ts()} [COMBAT_STEP] ========== TRANSITIONING TO FIRST_STRIKE_DAMAGE (first/double strike detected) ==========`);
          nextStep = "FIRST_STRIKE_DAMAGE";
          // Deal first strike damage - skip during replay
          if (!isReplaying) {
            try {
              debug(2, `${ts()} [COMBAT_STEP] Calling dealCombatDamage (first strike phase)...`);
              const combatResult = dealCombatDamage(ctx, true); // Pass flag for first strike phase
              debug(2, `${ts()} [COMBAT_STEP] First strike damage completed`);
              (ctx as any).state.lastFirstStrikeDamageResult = combatResult;
            } catch (err) {
              debugError(1, `${ts()} [COMBAT_STEP] CRASH in first strike dealCombatDamage:`, err);
            }
          }
        } else {
          debug(2, `${ts()} [COMBAT_STEP] ========== TRANSITIONING FROM DECLARE_BLOCKERS TO DAMAGE (no first strike) ==========`);
          nextStep = "DAMAGE";
          // Deal combat damage when entering the DAMAGE step (Rule 510) - skip during replay
          if (!isReplaying) {
            try {
              debug(2, `${ts()} [COMBAT_STEP] Calling dealCombatDamage...`);
              const combatResult = dealCombatDamage(ctx);
              debug(2, `${ts()} [COMBAT_STEP] dealCombatDamage completed successfully`);
              debug(2, `${ts()} [COMBAT_STEP] Result: damageToPlayers=${JSON.stringify(combatResult.damageToPlayers)}, creaturesDestroyed=${combatResult.creaturesDestroyed.length}`);
              (ctx as any).state.lastCombatDamageResult = combatResult;
            } catch (err) {
              debugError(1, `${ts()} [COMBAT_STEP] CRASH in dealCombatDamage:`, err);
              debugWarn(1, `${ts()} [nextStep] Failed to deal combat damage:`, err);
            }
          }
        }
        debug(2, `${ts()} [COMBAT_STEP] ========== END DAMAGE STEP PROCESSING ==========`);
      } else if (currentStep === "firstStrikeDamage" || currentStep === "FIRST_STRIKE_DAMAGE") {
        // After first strike damage, proceed to regular combat damage
        debug(2, `${ts()} [COMBAT_STEP] ========== TRANSITIONING FROM FIRST_STRIKE_DAMAGE TO DAMAGE ==========`);
        nextStep = "DAMAGE";
        // Deal regular combat damage (from creatures without first strike, and double strike creatures again)
        // Skip during replay - combat damage should be handled by replayed events
        if (!isReplaying) {
          try {
            debug(2, `${ts()} [COMBAT_STEP] Calling dealCombatDamage (regular damage phase after first strike)...`);
            const combatResult = dealCombatDamage(ctx, false); // Regular damage phase
            debug(2, `${ts()} [COMBAT_STEP] Regular damage completed`);
            (ctx as any).state.lastCombatDamageResult = combatResult;
          } catch (err) {
            debugError(1, `${ts()} [COMBAT_STEP] CRASH in regular dealCombatDamage:`, err);
          }
        }
      } else if (currentStep === "combatDamage" || currentStep === "DAMAGE") {
        nextStep = "END_COMBAT";
        // NOTE: End of combat triggers will be pushed AFTER phase/step update below
      } else {
        // After endCombat, check for extra combat phases before going to postcombatMain
        // Skip extra combat processing during replay - should be handled by replayed events
        if (!isReplaying && hasExtraCombat(ctx)) {
          // There's an extra combat phase pending
          const extraCombat = consumeExtraCombat(ctx);
          debug(2, `${ts()} [nextStep] Starting extra combat phase from ${extraCombat?.source || 'Unknown'}`);
          
          // Go back to beginning of combat
          nextPhase = "combat";
          nextStep = "BEGIN_COMBAT";
          
          // Clear attacking/blocking state for new combat
          const battlefield = (ctx as any).state?.battlefield || [];
          for (const perm of battlefield) {
            if (perm) {
              perm.attacking = null;
              perm.blockedBy = null;
              perm.blocking = null;
            }
          }
        } else {
          // No extra combat, go to postcombatMain
          nextPhase = "postcombatMain";
          nextStep = "MAIN2";
          // Clear combat state when leaving combat phase (Rule 506.4)
          clearCombatState(ctx);
          // Reset combat number for next turn
          (ctx as any).state.combatNumber = 0;
        }
      }
    } else if (currentPhase === "postcombatMain" || currentPhase === "main2") {
      nextPhase = "ending";
      nextStep = "END";
      // NOTE: End step triggers will be pushed AFTER phase/step update below
    } else if (currentPhase === "ending") {
      if (currentStep === "endStep" || currentStep === "end" || currentStep === "END") {
        nextStep = "CLEANUP";
        // When entering cleanup step, check if we should auto-advance to next turn
        // This happens when no discard is needed, stack is empty, no triggers, and no Sundial effect
        // Allow advancement during replay as well - turn advancement is a deterministic rule, not an event
        shouldAdvanceTurn = true;
      } else if (currentStep === "cleanup" || currentStep === "CLEANUP") {
        // Cleanup step: player has already had opportunity to use Sundial
        // Now advance to next turn (after discard check)
        // Allow advancement during replay as well - turn advancement is a deterministic rule, not an event
        shouldAdvanceTurn = true;
        // Mark that we're proceeding from cleanup (not entering it)
        // So we skip the Sundial check since player already passed
        (ctx as any)._cleanupProceed = true;
      } else {
        // Stay at cleanup if unknown step
        nextStep = "CLEANUP";
        shouldAdvanceTurn = true; // Also check for auto-advance in this case
      }
    } else {
      // Unknown phase, move to precombatMain as a safe default
      nextPhase = "precombatMain";
      nextStep = "MAIN1";
    }

    // Update phase and step
    (ctx as any).state.phase = nextPhase;
    (ctx as any).state.step = nextStep;

    // Clear mana pool when phase changes (Rule 106.4)
    // Mana empties from mana pools at the end of each step and phase
    if (nextPhase !== currentPhase) {
      clearManaPool(ctx);
    }

    debug(2, 
      `${ts()} [nextStep] Advanced to phase=${nextPhase}, step=${nextStep}`
    );

    // ========================================================================
    // DRAW STEP SPECIAL HANDLING (Rule 504.1)
    // 
    // Per Rule 504.1: "First, the active player draws a card. This turn-based
    // action doesn't use the stack."
    // 
    // The draw happens BEFORE triggers are processed. This is critical for
    // triggers like "at the beginning of your draw step" which should see
    // the card that was just drawn.
    // ========================================================================
    if (shouldDraw && !isReplaying) {
      try {
        const turnPlayer = (ctx as any).state.turnPlayer;
        if (turnPlayer) {
          // Calculate total cards to draw: 1 (base) + any additional draws from effects
          const additionalDraws = (ctx as any).additionalDrawsPerTurn?.[turnPlayer] || 0;
          const totalDraws = 1 + additionalDraws;
          
          const drawn = drawCards(ctx, turnPlayer, totalDraws);
          debug(2, 
            `${ts()} [nextStep] Drew ${drawn.length} card(s) for ${turnPlayer} at draw step (base: 1, additional: ${additionalDraws})`
          );
        } else {
          debugWarn(2, `${ts()} [nextStep] No turnPlayer set, cannot draw card`);
        }
      } catch (err) {
        debugWarn(1, `${ts()} [nextStep] Failed to draw card:`, err);
      }
    }

    // ========================================================================
    // STEP-ENTRY TRIGGER PROCESSING (Per MTG Rules 503-514)
    // 
    // Per Rule 116.2a: Triggered abilities go on the stack the next time a 
    // player would receive priority. When entering a new step/phase, all 
    // "at the beginning of [X]" triggers are put on the stack BEFORE any 
    // player receives priority.
    //
    // This section processes triggers for the NEW step we just entered.
    // The order is:
    // 1. Phase/Step is updated (done above)
    // 2. Triggers for the new step are detected and pushed to stack
    // 3. Active player receives priority (done at end of nextStep or in socket layer)
    // ========================================================================
    if (!isReplaying) {
      const turnPlayer = (ctx as any).state?.turnPlayer;
      if (turnPlayer) {
        (ctx as any).state.stack = (ctx as any).state.stack || [];
        
        // Helper function to process triggers with APNAP ordering
        // Per MTG Rule 101.4: When multiple triggered abilities controlled by the same player
        // trigger at the same time, that player chooses the order to put them on the stack.
        const pushTriggersToStack = (triggers: any[], triggerType: string, idPrefix: string) => {
          if (triggers.length === 0) return;
          
          debug(2, `${ts()} [nextStep] Found ${triggers.length} ${triggerType} trigger(s)`);
          
          // Group by controller for proper APNAP ordering (Rule 101.4)
          const triggersByController = new Map<string, typeof triggers>();
          for (const trigger of triggers) {
            const controller = trigger.controllerId || turnPlayer;
            const existing = triggersByController.get(controller) || [];
            existing.push(trigger);
            triggersByController.set(controller, existing);
          }
          
          // Get player order for APNAP
          const players = Array.isArray((ctx as any).state.players) 
            ? (ctx as any).state.players.map((p: any) => p.id) 
            : [];
          const orderedPlayers = [turnPlayer, ...players.filter((p: string) => p !== turnPlayer)];
          
          // Process triggers in APNAP order (active player's triggers first)
          for (const playerId of orderedPlayers) {
            const playerTriggers = triggersByController.get(playerId) || [];
            
            if (playerTriggers.length === 0) {
              continue;
            }
            
            // If player has multiple triggers, store them for ordering
            // They will be added to triggerQueue for the socket layer to handle
            if (playerTriggers.length > 1) {
              debug(2, `${ts()} [nextStep] Player ${playerId} has ${playerTriggers.length} triggers to order`);
              
              // Initialize trigger queue if needed
              (ctx as any).state.triggerQueue = (ctx as any).state.triggerQueue || [];
              
              // Add triggers to the queue with 'order' type
              // The socket layer will prompt the player to order them
              for (const trigger of playerTriggers) {
                const triggerId = `${idPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                (ctx as any).state.triggerQueue.push({
                  id: triggerId,
                  sourceId: trigger.permanentId,
                  sourceName: trigger.cardName,
                  effect: trigger.description || trigger.effect,
                  type: 'order', // This will show the ordering UI
                  controllerId: playerId,
                  triggerType,
                  mandatory: trigger.mandatory !== false,
                  imageUrl: trigger.imageUrl,
                  requiresChoice: trigger.requiresChoice,  // Preserve modal choice flag
                });
                debug(2, `${ts()} [nextStep] 📋 Queued trigger for ordering: ${trigger.cardName}`);
              }
              
              // Store pending ordering request for the socket layer to detect
              (ctx as any).state.pendingTriggerOrdering = (ctx as any).state.pendingTriggerOrdering || {};
              (ctx as any).state.pendingTriggerOrdering[playerId] = {
                timing: triggerType,
                count: playerTriggers.length,
              };
            } else {
              // Single trigger - push directly to stack (no ordering needed)
              const trigger = playerTriggers[0];
              const triggerId = `${idPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
              (ctx as any).state.stack.push({
                id: triggerId,
                type: 'triggered_ability',
                controller: playerId,
                source: trigger.permanentId,
                sourceName: trigger.cardName,
                description: trigger.description || trigger.effect,
                triggerType,
                mandatory: trigger.mandatory !== false,
                effect: trigger.effect,
                requiresChoice: trigger.requiresChoice,  // Preserve modal choice flag
              });
              debug(2, `${ts()} [nextStep] ⚡ Pushed ${triggerType} trigger: ${trigger.cardName} - ${trigger.description || trigger.effect}${trigger.requiresChoice ? ' (modal)' : ''}`);
            }
          }
        };
        
        // Rule 504.1: Upkeep step - "at the beginning of your upkeep" triggers
        if (nextStep === "UPKEEP") {
          // FIRST: Auto-process cumulative upkeep mana effects (e.g., Braid of Fire)
          // This must happen BEFORE triggers are collected, because Braid of Fire adds mana
          // as part of cumulative upkeep, not as a separate trigger
          const processedMana = autoProcessCumulativeUpkeepMana(ctx, turnPlayer);
          if (processedMana.length > 0) {
            debug(2, `${ts()} [nextStep] Auto-processed cumulative upkeep mana for ${processedMana.length} permanent(s)`);
            for (const item of processedMana) {
              const manaStr = Object.entries(item.manaAdded)
                .map(([type, amount]) => `${amount} ${type}`)
                .join(', ');
              debug(2, `${ts()} [nextStep] ${item.cardName}: Added ${manaStr} (${item.ageCounters} age counters)`);
            }
          }
          
          // SECOND: Process suspended cards - remove time counters
          const zones = (ctx as any).state.zones || {};
          const playerZone = zones[turnPlayer];
          if (playerZone && playerZone.exile) {
            const suspendedCards = playerZone.exile.filter((c: any) => c.isSuspended && c.timeCounters > 0);
            for (const card of suspendedCards) {
              card.timeCounters--;
              debug(2, `${ts()} [nextStep] Suspend: Removed time counter from ${card.name} (${card.timeCounters} remaining)`);
              
              // If last time counter was removed, cast the spell for free
              if (card.timeCounters === 0) {
                debug(2, `${ts()} [nextStep] Suspend: ${card.name} has no time counters remaining - will be cast`);
                // Remove from exile
                const exileIdx = playerZone.exile.indexOf(card);
                if (exileIdx !== -1) {
                  playerZone.exile.splice(exileIdx, 1);
                  playerZone.exileCount = playerZone.exile.length;
                }
                
                // Cast the spell without paying its mana cost
                // Add to stack as a spell
                const stackItem = {
                  id: uid("spell"),
                  type: 'spell',
                  card: { ...card, zone: 'stack' },
                  controller: turnPlayer,
                  targets: [],
                  wasCastFromSuspend: true, // Flag to indicate this was suspended
                };
                (ctx as any).state.stack = (ctx as any).state.stack || [];
                (ctx as any).state.stack.push(stackItem);
                
                // Emit chat message
                if ((ctx as any).io && (ctx as any).gameId) {
                  (ctx as any).io.to((ctx as any).gameId).emit("chat", {
                    id: `m_${Date.now()}`,
                    gameId: (ctx as any).gameId,
                    from: "system",
                    message: `⏰ ${card.name} cast from suspend!`,
                    ts: Date.now(),
                  });
                }
                
                debug(2, `${ts()} [nextStep] Suspend: Cast ${card.name} from suspend onto the stack`);
              }
            }
          }
          
          // THIRD: Process rebound spells - "At the beginning of your next upkeep, you may cast this card from exile"
          // Check for cards in exile with reboundPending flag that were cast on a previous turn
          const currentTurn = (ctx as any).state.turnNumber || 1;
          if (playerZone && playerZone.exile) {
            const reboundCards = playerZone.exile.filter((c: any) => 
              c.reboundPending && 
              c.reboundController === turnPlayer &&
              typeof c.reboundTurn === 'number' &&  // Ensure reboundTurn is a valid number
              c.reboundTurn < currentTurn  // Only trigger on the next turn, not same turn
            );
            
            for (const card of reboundCards) {
              debug(2, `${ts()} [nextStep] Rebound: Found ${card.name} ready to cast from exile`);
              
              // Create a triggered ability for the rebound - player may cast it
              const reboundTriggerId = uid("rebound_trigger");
              const reboundTrigger = {
                id: reboundTriggerId,
                type: 'triggered_ability',
                controller: turnPlayer,
                source: card.id,
                sourceName: card.name,
                description: `You may cast ${card.name} from exile without paying its mana cost.`,
                triggerType: 'rebound',
                mandatory: false, // "you may cast"
                reboundCardId: card.id, // Track which card this is for
                card: card, // Include card data for display
              };
              
              (ctx as any).state.stack = (ctx as any).state.stack || [];
              (ctx as any).state.stack.push(reboundTrigger);
              
              // Mark the card as having triggered (so it doesn't trigger again)
              // The card will be moved to graveyard when the trigger resolves (whether cast or declined)
              card.reboundTriggered = true;
              
              // Emit chat message
              if ((ctx as any).io && (ctx as any).gameId) {
                (ctx as any).io.to((ctx as any).gameId).emit("chat", {
                  id: `m_${Date.now()}`,
                  gameId: (ctx as any).gameId,
                  from: "system",
                  message: `🔄 Rebound: ${card.name}'s rebound trigger!`,
                  ts: Date.now(),
                });
              }
              
              debug(2, `${ts()} [nextStep] Rebound: Added trigger for ${card.name} to stack`);
            }
          }
          
          const upkeepTriggers = getUpkeepTriggersForPlayer(ctx, turnPlayer);
          pushTriggersToStack(upkeepTriggers, 'upkeep', 'upkeep');
        }
        
        // Rule 504.1 (Draw): "at the beginning of your draw step" triggers
        else if (nextStep === "DRAW") {
          const drawTriggers = getDrawStepTriggers(ctx, turnPlayer);
          pushTriggersToStack(drawTriggers, 'draw_step', 'draw');
          
          // Per Rule 504: If there are no draw triggers and we just entered from UPKEEP,
          // immediately advance to MAIN1 (similar to how UNTAP advances to UPKEEP)
          // The draw action is a turn-based action and doesn't grant priority
          const justEnteredDrawFromUpkeep = (currentStep === "upkeep" || currentStep === "UPKEEP");
          
          if (justEnteredDrawFromUpkeep && drawTriggers.length === 0 && (ctx as any).state.stack.length === 0) {
            debug(2, `${ts()} [nextStep] No draw triggers, immediately advancing to MAIN1 (similar to UNTAP->UPKEEP)`);
            // Override the next step to be MAIN1 instead of DRAW
            nextPhase = "precombatMain";
            nextStep = "MAIN1";
            
            // We need to update the state now since we've already set it to DRAW above
            (ctx as any).state.phase = nextPhase;
            (ctx as any).state.step = nextStep;
            
            // Check for precombat main triggers
            const precombatMainTriggers = getTriggersForTiming(ctx, 'precombat_main', turnPlayer);
            pushTriggersToStack(precombatMainTriggers, 'precombat_main', 'main');
            debug(2, `${ts()} [nextStep] Advanced to MAIN1, found ${precombatMainTriggers.length} precombat main trigger(s)`);
            
            // IMPORTANT: Set a flag to skip the duplicate MAIN1 trigger processing below
            (ctx as any)._skipMain1TriggerCheck = true;
          }
        }
        
        // Rule 505.4: Beginning of precombat main phase - "at the beginning of your precombat main phase" triggers
        // This includes cards like Black Market Connections, Saga lore counters (Rule 714.3b), etc.
        // NOTE: Only process if we didn't just auto-advance from DRAW (checked via flag)
        else if (nextStep === "MAIN1" && !(ctx as any)._skipMain1TriggerCheck) {
          const precombatMainTriggers = getTriggersForTiming(ctx, 'precombat_main', turnPlayer);
          pushTriggersToStack(precombatMainTriggers, 'precombat_main', 'main');
          debug(2, `${ts()} [nextStep] Checking precombat main triggers for ${turnPlayer}, found ${precombatMainTriggers.length} trigger(s)`);
        }
        
        // Clear the skip flag after processing triggers
        if ((ctx as any)._skipMain1TriggerCheck) {
          delete (ctx as any)._skipMain1TriggerCheck;
        }
        
        // Rule 507.1: Beginning of combat - "at the beginning of combat" triggers
        // CRITICAL: These MUST fire before players can declare attackers
        // This includes cards like Ouroboroid, Hakbal, Delina that create tokens with haste
        else if (nextStep === "BEGIN_COMBAT") {
          const combatTriggers = getBeginningOfCombatTriggers(ctx, turnPlayer);
          pushTriggersToStack(combatTriggers, 'begin_combat', 'combat');
        }
        
        // Rule 511.1: End of combat - "at end of combat" triggers
        else if (nextStep === "END_COMBAT") {
          const endCombatTriggers = getEndOfCombatTriggers(ctx, turnPlayer);
          pushTriggersToStack(endCombatTriggers, 'end_combat', 'endcombat');
          
          // Clear firebending mana at end of combat
          // Firebending: "add {R}{R}... This mana lasts until end of combat."
          // BUT: Check for mana retention effects (Ozai, Leyline Tyrant) first
          const firebendingMana = (ctx as any).state?.firebendingMana;
          if (firebendingMana) {
            for (const [playerId, amount] of Object.entries(firebendingMana)) {
              if (typeof amount === 'number' && amount > 0) {
                const manaPool = (ctx as any).state?.manaPool?.[playerId];
                if (manaPool) {
                  // Check for mana retention effects that would keep red mana
                  // Ozai: "If you would lose unspent mana, that mana becomes red instead"
                  // Leyline Tyrant: "Red mana doesn't empty from your mana pool"
                  const battlefield = (ctx as any).state?.battlefield || [];
                  let retainsRedMana = false;
                  let hasOzaiEffect = false;
                  
                  for (const permanent of battlefield) {
                    if (!permanent || permanent.controller !== playerId) continue;
                    
                    const cardName = (permanent.card?.name || "").toLowerCase();
                    const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
                    
                    // Leyline Tyrant - Red mana doesn't empty
                    // Oracle text: "You don't lose unspent red mana as steps and phases end."
                    if (cardName.includes("leyline tyrant") ||
                        (oracleText.includes("red mana") && (oracleText.includes("don't lose") || oracleText.includes("doesn't empty")))) {
                      retainsRedMana = true;
                      debug(2, `${ts()} [END_COMBAT] ${playerId} has Leyline Tyrant - firebending red mana preserved`);
                      break;
                    }
                    
                    // Ozai - mana becomes red instead of emptying
                    if (cardName.includes("ozai") || 
                        (oracleText.includes("lose unspent mana") && oracleText.includes("becomes red instead"))) {
                      hasOzaiEffect = true;
                      debug(2, `${ts()} [END_COMBAT] ${playerId} has Ozai - firebending red mana converts to red (already red, so preserved)`);
                    }
                  }
                  
                  // Firebending mana is red, so:
                  // - Leyline Tyrant keeps it
                  // - Ozai converts it to red (already red, so effectively keeps it)
                  if (retainsRedMana || hasOzaiEffect) {
                    debug(2, `${ts()} [END_COMBAT] Firebending mana (${amount} red) preserved due to mana retention effect`);
                    // Don't clear the mana, just reset the firebending tracking
                  } else {
                    // Remove firebending red mana from pool
                    manaPool.red = Math.max(0, (manaPool.red || 0) - amount);
                    debug(2, `${ts()} [END_COMBAT] Cleared ${amount} firebending red mana from ${playerId}`);
                  }
                }
              }
            }
            // Reset firebending tracking (regardless of whether mana was kept)
            (ctx as any).state.firebendingMana = {};
          }
        }
        
        // Rule 513.1: End step - "at the beginning of your end step" triggers
        // This includes cards like Case of the Locked Hothouse, Meren, Atraxa
        else if (nextStep === "END") {
          const endStepTriggers = getEndStepTriggers(ctx, turnPlayer);
          pushTriggersToStack(endStepTriggers, 'end_step', 'endstep');
        }
        
        // Give priority to active player based on step type
        // Per Rule 116.3a: Active player receives priority at the beginning of most steps
        // Per Rule 502.1: No player receives priority during untap step
        // Per Rule 514.1: Cleanup step normally doesn't grant priority (handled elsewhere)
        const stepUpper = (nextStep ?? '').toUpperCase();
        const isUntapStep = stepUpper === "UNTAP";
        const isCleanupStep = stepUpper === "CLEANUP";
        
        // Grant priority in all steps except UNTAP and CLEANUP
        // This includes main phases, combat steps, upkeep, draw, end step, etc.
        const shouldGrantPriority = !isUntapStep && !isCleanupStep;
        
        if (shouldGrantPriority) {
          // Always grant priority to the active player first
          // The auto-pass system will handle passing priority if they can't act
          (ctx as any).state.priority = turnPlayer;
          
          // CRITICAL: Reset priorityPassedBy when granting priority in a new step
          // This ensures players who passed in the previous step get a fresh chance to act
          // Without this, auto-pass can cause steps to be skipped incorrectly
          (ctx as any).state.priorityPassedBy = new Set<string>();
          
          // Also clear priorityClaimed set - players need to claim priority again each step
          (ctx as any).state.priorityClaimed = new Set<string>();
          
          debug(2, `${ts()} [nextStep] Granting priority to active player ${turnPlayer} (step: ${nextStep ?? 'unknown'}, stack size: ${(ctx as any).state.stack.length})`);
          
          // DEBUG: Log turn player's hand and ability to act
          try {
            const zones = (ctx as any).state?.zones?.[turnPlayer];
            const hand = zones?.hand || [];
            const handNames = hand.map((card: any) => card?.name || 'Unknown').join(', ');
            const handCount = hand.length || zones?.handCount || 0;
            
            const playerCanAct = canAct(ctx, turnPlayer);
            const playerCanRespond = canRespond(ctx, turnPlayer);
            
            debug(2, `${ts()} [nextStep] DEBUG - Turn Player ${turnPlayer}:`);
            debug(2, `${ts()} [nextStep]   Hand (${handCount}): ${handNames || '(empty)'}`);
            debug(2, `${ts()} [nextStep]   canAct: ${playerCanAct}, canRespond: ${playerCanRespond}`);
          } catch (err) {
            debugWarn(1, `${ts()} [nextStep] Failed to log debug info:`, err);
          }
          
          // After granting priority, check if we should auto-pass for players who cannot act
          // This ensures that auto-pass works immediately when entering a new step,
          // not just when someone manually passes priority
          try {
            debug(2, `${ts()} [nextStep] Checking if auto-pass should apply after granting priority`);
            const autoPassResult = tryAutoPass(ctx);
            
            // Store the auto-pass result in the state so the caller can check it
            // This allows the caller (socket handler or AI) to handle step advancement
            // and broadcasting properly without breaking the control flow
            (ctx as any).state._autoPassResult = autoPassResult;
            
            if (autoPassResult.allPassed && autoPassResult.advanceStep) {
              // All players auto-passed with empty stack - mark flag for caller to handle
              debug(2, `${ts()} [nextStep] All players auto-passed after granting priority - caller should advance step`);
            } else if (autoPassResult.allPassed && autoPassResult.resolved) {
              // All players auto-passed and stack was resolved
              debug(2, `${ts()} [nextStep] All players auto-passed and stack item resolved`);
            } else {
              // Auto-pass stopped at a player who can act, or auto-pass is not enabled
              debug(2, `${ts()} [nextStep] Auto-pass stopped, player ${(ctx as any).state.priority} has priority`);
            }
          } catch (err) {
            debugWarn(1, `${ts()} [nextStep] Failed to run auto-pass check:`, err);
          }
        } else {
          // UNTAP and CLEANUP steps don't grant priority normally
          (ctx as any).state.priority = null;
          debug(2, `${ts()} [nextStep] Step ${nextStep ?? 'unknown'} does not grant priority (Rule 502.1/514.1)`);
        }
      }
    }

    // If we should advance to next turn, call nextTurn instead
    if (shouldAdvanceTurn) {
      // CRITICAL: During replay, do NOT call nextTurn here!
      // The nextTurn event is persisted separately in the event log and will be
      // applied via applyEvent("nextTurn") when it's reached in the replay sequence.
      // Calling nextTurn here during replay causes duplicate turn advancement,
      // which corrupts game state (e.g., double turn increments, repeated side effects).
      if (isReplaying) {
        debug(2, `${ts()} [nextStep] In replay mode - skipping nextTurn call (nextTurn event is in event log)`);
        ctx.bumpSeq();
        return;
      }
      
      // Check if we're proceeding from cleanup (player already had chance to use Sundial)
      const cleanupProceed = (ctx as any)._cleanupProceed === true;
      delete (ctx as any)._cleanupProceed; // Clear the flag
      
      // Check if any player has a Sundial-like effect available
      // Only check this when ENTERING cleanup, not when proceeding from it
      const hasSundialEffect = !cleanupProceed && anyPlayerHasSundialEffect(ctx);
      
      // Check if stack is empty
      const stackEmpty = !Array.isArray((ctx as any).state.stack) || (ctx as any).state.stack.length === 0;
      
      // Rule 514.1: Check if discard is needed before advancing
      try {
        const turnPlayer = (ctx as any).state.turnPlayer;
        if (turnPlayer) {
          const discardCheck = setupCleanupDiscard(ctx, turnPlayer);
          if (discardCheck.needsInteraction && discardCheck.discardCount > 0) {
            // Player needs to choose cards to discard - don't advance turn yet
            debug(2, `${ts()} [nextStep] Waiting for player to select ${discardCheck.discardCount} cards to discard`);
            ctx.bumpSeq();
            return; // Stop here - turn will advance after discard selection
          }
        }
      } catch (err) {
        debugWarn(1, `${ts()} [nextStep] Failed to check discard during cleanup:`, err);
      }
      
      // If any player has a Sundial-like effect and stack is empty, 
      // don't auto-advance - let players have a chance to use it
      // Per Rule 514.3: Normally no priority during cleanup, but if triggers or SBAs occur, priority is given
      // We extend this to also give priority when Sundial effects are available
      if (hasSundialEffect && stackEmpty) {
        debug(2, `${ts()} [nextStep] Player has Sundial effect available, pausing at cleanup for potential action`);
        ctx.bumpSeq();
        return; // Stop here - player can use Sundial effect or pass to advance
      }
      
      // Rule 514.2: Clear damage from all permanents and end temporary effects
      // This happens simultaneously after discarding
      try {
        clearDamageFromPermanents(ctx);
        endTemporaryEffects(ctx);
      } catch (err) {
        debugWarn(1, `${ts()} [nextStep] Failed to clear damage/effects during cleanup:`, err);
      }
      
      debug(2, `${ts()} [nextStep] Cleanup complete, advancing to next turn`);
      ctx.bumpSeq();
      nextTurn(ctx);
      return;
    }

    // If we're leaving the UNTAP step, untap all permanents controlled by the active player (Rule 502.3)
    // Note: Summoning sickness is already cleared at the beginning of the turn (in nextTurn)
    if (shouldUntap) {
      try {
        const turnPlayer = (ctx as any).state.turnPlayer;
        if (turnPlayer) {
          // Untap all permanents for the turn player
          untapPermanentsForPlayer(ctx, turnPlayer);
          
          // Apply Unwinding Clock, Seedborn Muse, and similar effects
          // These untap OTHER players' permanents during the turn player's untap step
          const untapEffects = getUntapStepEffects(ctx, turnPlayer);
          for (const effect of untapEffects) {
            const count = applyUntapStepEffect(ctx, effect);
            if (count > 0) {
              debug(2, `${ts()} [nextStep] ${effect.cardName} untapped ${count} permanents for ${effect.controllerId}`);
            }
          }
        } else {
          debugWarn(2, `${ts()} [nextStep] No turnPlayer set, cannot untap permanents`);
        }
      } catch (err) {
        debugWarn(1, `${ts()} [nextStep] Failed to untap permanents:`, err);
      }
    }

    ctx.bumpSeq();
  } catch (err) {
    debugWarn(1, `${ts()} nextStep failed:`, err);
  }
}

/* Simple scheduled-steps support (lightweight queue stored on ctx) */
export function scheduleStepsAfterCurrent(ctx: any, steps: any[]) {
  try {
    if (!ctx) return;
    ctx._scheduledSteps = ctx._scheduledSteps || [];
    if (!Array.isArray(steps)) return;
    ctx._scheduledSteps.push(...steps);
  } catch (err) {
    debugWarn(1, `${ts()} scheduleStepsAfterCurrent failed:`, err);
  }
}

export function scheduleStepsAtEndOfTurn(ctx: any, steps: any[]) {
  try {
    if (!ctx) return;
    ctx._scheduledEndOfTurnSteps = ctx._scheduledEndOfTurnSteps || [];
    if (!Array.isArray(steps)) return;
    ctx._scheduledEndOfTurnSteps.push(...steps);
  } catch (err) {
    debugWarn(1, `${ts()} scheduleStepsAtEndOfTurn failed:`, err);
  }
}

export function clearScheduledSteps(ctx: any) {
  try {
    if (!ctx) return;
    ctx._scheduledSteps = [];
    ctx._scheduledEndOfTurnSteps = [];
  } catch (err) {
    debugWarn(1, `${ts()} clearScheduledSteps failed:`, err);
  }
}

export function getScheduledSteps(ctx: any) {
  try {
    return {
      afterCurrent: Array.isArray(ctx._scheduledSteps)
        ? ctx._scheduledSteps.slice()
        : [],
      endOfTurn: Array.isArray(ctx._scheduledEndOfTurnSteps)
        ? ctx._scheduledEndOfTurnSteps.slice()
        : [],
    };
  } catch (err) {
    return { afterCurrent: [], endOfTurn: [] };
  }
}

export function removeScheduledSteps(ctx: any, steps: any[]) {
  try {
    if (!ctx || !Array.isArray(steps)) return;
    ctx._scheduledSteps = (ctx._scheduledSteps || []).filter(
      (s: any) => !steps.includes(s)
    );
    ctx._scheduledEndOfTurnSteps = (
      ctx._scheduledEndOfTurnSteps || []
    ).filter((s: any) => !steps.includes(s));
  } catch (err) {
    debugWarn(1, `${ts()} removeScheduledSteps failed:`, err);
  }
}

/**
 * Add an extra turn for a player (Rule 500.7)
 * Extra turns are taken in LIFO order - the most recently added turn is taken first.
 * 
 * @param ctx - Game context
 * @param playerId - The player who will take the extra turn
 * @param source - Optional source description (e.g., "Time Warp", "Nexus of Fate")
 */
export function addExtraTurn(ctx: GameContext, playerId: string, source?: string): void {
  try {
    const state = (ctx as any).state;
    if (!state) return;
    
    // Initialize extra turns array if needed
    state.extraTurns = state.extraTurns || [];
    
    // Add the extra turn to the front (LIFO order)
    const turnNumber = state.turnNumber || 0;
    state.extraTurns.unshift({
      playerId,
      afterTurnNumber: turnNumber,
      source: source || 'Unknown',
      createdAt: Date.now(),
    });
    
    debug(2, `${ts()} [addExtraTurn] Extra turn added for ${playerId} from "${source || 'Unknown'}" (current turn: ${turnNumber})`);
    ctx.bumpSeq();
  } catch (err) {
    debugWarn(1, `${ts()} addExtraTurn failed:`, err);
  }
}

/**
 * Get pending extra turns for display/debugging
 */
export function getExtraTurns(ctx: GameContext): Array<{ playerId: string; source?: string }> {
  try {
    const state = (ctx as any).state;
    return (state?.extraTurns || []).map((et: any) => ({
      playerId: et.playerId,
      source: et.source,
    }));
  } catch (err) {
    return [];
  }
}

/**
 * Add an extra combat phase to the current turn
 * Used by cards like Aurelia, Combat Celebrant, Hellkite Charger, etc.
 * 
 * @param ctx - Game context
 * @param source - Optional source description (e.g., "Aurelia, the Warleader")
 * @param untapAttackers - Whether to untap attacking creatures (Aurelia does this)
 */
export function addExtraCombat(ctx: GameContext, source?: string, untapAttackers?: boolean): void {
  try {
    const state = (ctx as any).state;
    if (!state) return;
    
    // Initialize extra combats array if needed
    state.extraCombats = state.extraCombats || [];
    
    // Track which combat phase we're on for this turn
    state.combatNumber = (state.combatNumber || 1);
    
    // Add the extra combat phase
    state.extraCombats.push({
      source: source || 'Unknown',
      untapAttackers: untapAttackers || false,
      createdAt: Date.now(),
    });
    
    debug(2, `${ts()} [addExtraCombat] Extra combat added from "${source || 'Unknown'}" (untap: ${untapAttackers})`);
    ctx.bumpSeq();
  } catch (err) {
    debugWarn(1, `${ts()} addExtraCombat failed:`, err);
  }
}

/**
 * Check if there are pending extra combat phases
 */
export function hasExtraCombat(ctx: GameContext): boolean {
  const state = (ctx as any).state;
  return (state?.extraCombats?.length || 0) > 0;
}

/**
 * Consume an extra combat phase and return its details
 */
export function consumeExtraCombat(ctx: GameContext): { source?: string; untapAttackers?: boolean } | null {
  try {
    const state = (ctx as any).state;
    if (!state?.extraCombats?.length) return null;
    
    const extraCombat = state.extraCombats.shift();
    state.combatNumber = (state.combatNumber || 1) + 1;
    
    debug(2, `${ts()} [consumeExtraCombat] Starting extra combat from "${extraCombat.source}" (combat #${state.combatNumber})`);
    
    // If untapAttackers is true, untap all creatures that attacked
    if (extraCombat.untapAttackers) {
      const battlefield = state.battlefield || [];
      for (const perm of battlefield) {
        if (perm && perm.attacking) {
          perm.tapped = false;
          debug(2, `${ts()} [consumeExtraCombat] Untapped ${perm.card?.name || perm.id} for extra combat`);
        }
      }
    }
    
    ctx.bumpSeq();
    return extraCombat;
  } catch (err) {
    debugWarn(1, `${ts()} consumeExtraCombat failed:`, err);
    return null;
  }
}

/**
 * Skip a player's extra turn (for effects like Discontinuity or Stranglehold)
 * @param ctx - Game context
 * @param playerId - The player whose extra turn should be skipped
 * @returns true if an extra turn was skipped
 */
export function skipExtraTurn(ctx: GameContext, playerId: string): boolean {
  try {
    const state = (ctx as any).state;
    if (!state?.extraTurns?.length) return false;
    
    const idx = state.extraTurns.findIndex((et: any) => et.playerId === playerId);
    if (idx >= 0) {
      const skipped = state.extraTurns.splice(idx, 1)[0];
      debug(2, `${ts()} [skipExtraTurn] Skipped extra turn for ${playerId} from "${skipped.source || 'Unknown'}"`);
      ctx.bumpSeq();
      return true;
    }
    return false;
  } catch (err) {
    debugWarn(1, `${ts()} skipExtraTurn failed:`, err);
    return false;
  }
}

/**
 * Public API to check for pending interactions
 * This is exposed so the socket layer can inform players why step advancement is blocked
 */
export function getPendingInteractions(ctx: GameContext): {
  hasPending: boolean;
  pendingTypes: string[];
  details: Record<string, any>;
} {
  return checkPendingInteractions(ctx);
}

export default {
  passPriority,
  setTurnDirection,
  nextTurn,
  nextStep,
  executeCleanupDiscard,
  scheduleStepsAfterCurrent,
  scheduleStepsAtEndOfTurn,
  clearScheduledSteps,
  getScheduledSteps,
  removeScheduledSteps,
  addExtraTurn,
  getExtraTurns,
  skipExtraTurn,
  getPendingInteractions,
  didCreatureDealDamageToPlayer,
  getCreaturesThatDealtDamageToPlayer,
};


