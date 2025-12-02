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
import { recalculatePlayerEffects } from "./game-state-effects.js";
import { 
  getBeginningOfCombatTriggers, 
  getEndStepTriggers, 
  getDrawStepTriggers,
  getEndOfCombatTriggers,
  getUntapStepEffects,
  applyUntapStepEffect,
  isPermanentPreventedFromUntapping
} from "./triggered-abilities.js";
import { getUpkeepTriggersForPlayer } from "./upkeep-triggers.js";
import { parseCreatureKeywords } from "./combat-mechanics.js";
import { runSBA } from "./counters_tokens.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
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
    console.warn(`${ts()} passPriority stub failed:`, err);
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
    console.warn(`${ts()} setTurnDirection failed:`, err);
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
      console.log(`${ts()} [clearCombatState] Cleared combat state from ${clearedCount} permanents`);
    }
  } catch (err) {
    console.warn(`${ts()} clearCombatState failed:`, err);
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
        console.log(`${ts()} [syncLifeAndCheckDefeat] Player ${player.id} has lost the game (life: ${player.life})`);
        
        // Mark player as inactive
        if (!((ctx as any).inactive instanceof Set)) {
          (ctx as any).inactive = new Set<string>();
        }
        (ctx as any).inactive.add(player.id);
      }
    }
    
  } catch (err) {
    console.warn(`${ts()} syncLifeAndCheckDefeat failed:`, err);
  }
  
  return defeatedPlayers;
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
} {
  console.log(`${ts()} [COMBAT_DAMAGE] ========== ENTERING dealCombatDamage (firstStrike=${isFirstStrikePhase}) ==========`);
  
  const result = {
    damageToPlayers: {} as Record<string, number>,
    lifeGainForPlayers: {} as Record<string, number>,
    creaturesDestroyed: [] as string[],
  };
  
  try {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) {
      console.log(`${ts()} [COMBAT_DAMAGE] No battlefield array, returning early`);
      return result;
    }
    
    // Find all attacking creatures
    const attackers = battlefield.filter((perm: any) => perm && perm.attacking);
    console.log(`${ts()} [COMBAT_DAMAGE] Found ${attackers.length} attackers`);
    
    // Log attacker details
    for (const att of attackers) {
      const blockedBy = att.blockedBy || [];
      console.log(`${ts()} [COMBAT_DAMAGE] Attacker: ${att.card?.name || att.id}, blocked by ${blockedBy.length} creatures: [${blockedBy.join(', ')}]`);
    }
    
    if (attackers.length === 0) {
      console.log(`${ts()} [COMBAT_DAMAGE] No attackers, skipping combat damage`);
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
      console.log(`${ts()} [COMBAT_DAMAGE] Processing attacker: ${attacker.card?.name || attacker.id}`);
      
      // Skip creatures that were already killed (e.g., by deathtouch in first strike phase)
      if (attacker.markedForDestruction) {
        console.log(`${ts()} [COMBAT_DAMAGE] Skipping attacker ${attacker.card?.name || attacker.id} - marked for destruction`);
        continue;
      }
      
      // Get attacker's power and keywords
      const card = attacker.card || {};
      let keywords;
      try {
        keywords = parseCreatureKeywords(card, attacker);
      } catch (err) {
        console.error(`${ts()} [dealCombatDamage] CRASH parsing keywords for ${card.name || attacker.id}:`, err);
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
      const attackerPower = parseInt(String(attacker.basePower ?? card.power ?? '0'), 10) || 0;
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
          console.log(`${ts()} [dealCombatDamage] Skipping ${card.name || attacker.id} in first strike phase (no first/double strike)`);
          continue;
        }
      } else if (isFirstStrikePhase === false) {
        // Regular damage phase after first strike - skip first strike-only creatures
        // but double strike creatures deal damage again
        if (keywords.firstStrike && !keywords.doubleStrike) {
          console.log(`${ts()} [dealCombatDamage] Skipping ${card.name || attacker.id} in regular phase (first strike only, already dealt)`);
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
          // Damage to player
          const currentLife = life[defendingPlayerId] ?? startingLife;
          life[defendingPlayerId] = currentLife - attackerPower;
          
          result.damageToPlayers[defendingPlayerId] = 
            (result.damageToPlayers[defendingPlayerId] || 0) + attackerPower;
          
          console.log(`${ts()} [dealCombatDamage] ${card.name || 'Attacker'} dealt ${attackerPower} combat damage to ${defendingPlayerId} (${currentLife} -> ${life[defendingPlayerId]})`);
          
          // Lifelink: Controller gains life equal to damage dealt
          if (keywords.lifelink) {
            const controllerLife = life[attackerController] ?? startingLife;
            life[attackerController] = controllerLife + attackerPower;
            
            result.lifeGainForPlayers[attackerController] = 
              (result.lifeGainForPlayers[attackerController] || 0) + attackerPower;
            
            console.log(`${ts()} [dealCombatDamage] ${card.name || 'Attacker'} lifelink: ${attackerController} gained ${attackerPower} life (${controllerLife} -> ${life[attackerController]})`);
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
            console.log(`${ts()} [dealCombatDamage] Blocker ${blockerCard.name || blockerId} already has lethal damage, skipping`);
            continue;
          }
          
          // Assign lethal damage (or all remaining damage if less than lethal)
          const damageToBlocker = Math.min(lethalDamage, remainingDamage);
          
          if (damageToBlocker > 0) {
            // Mark damage on blocker
            blocker.markedDamage = (blocker.markedDamage || 0) + damageToBlocker;
            remainingDamage -= damageToBlocker;
            
            console.log(`${ts()} [dealCombatDamage] ${card.name || 'Attacker'} dealt ${damageToBlocker} damage to blocker ${blockerCard.name || blockerId}`);
            
            // Check if blocker dies
            const totalDamageOnBlocker = blocker.markedDamage || 0;
            const isDead = totalDamageOnBlocker >= blockerToughness || (keywords.deathtouch && totalDamageOnBlocker > 0);
            
            if (isDead) {
              result.creaturesDestroyed.push(blockerId);
              console.log(`${ts()} [dealCombatDamage] Blocker ${blockerCard.name || blockerId} received lethal damage`);
            }
            
            // Lifelink for damage dealt to blocker
            if (keywords.lifelink) {
              const controllerLife = life[attackerController] ?? startingLife;
              life[attackerController] = controllerLife + damageToBlocker;
              
              result.lifeGainForPlayers[attackerController] = 
                (result.lifeGainForPlayers[attackerController] || 0) + damageToBlocker;
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
            
            console.log(`${ts()} [dealCombatDamage] ${card.name || 'Attacker'} trample: dealt ${remainingDamage} excess damage to ${defendingPlayerId}`);
            
            // Lifelink for trample damage
            if (keywords.lifelink) {
              const controllerLife = life[attackerController] ?? startingLife;
              life[attackerController] = controllerLife + remainingDamage;
              
              result.lifeGainForPlayers[attackerController] = 
                (result.lifeGainForPlayers[attackerController] || 0) + remainingDamage;
            }
          }
        }
        
        // Blockers deal damage back to attackers
        console.log(`${ts()} [COMBAT_DAMAGE] Processing ${blockedBy.length} blocker(s) dealing damage to attacker ${card.name || attacker.id}`);
        
        for (const blockerId of blockedBy) {
          console.log(`${ts()} [COMBAT_DAMAGE] Processing blocker: ${blockerId}`);
          const blocker = battlefield.find((p: any) => p?.id === blockerId);
          if (!blocker) {
            console.log(`${ts()} [COMBAT_DAMAGE] Blocker ${blockerId} not found on battlefield, skipping`);
            continue;
          }
          
          // Skip blockers that were already killed (e.g., by deathtouch in first strike phase)
          if (blocker.markedForDestruction) {
            console.log(`${ts()} [COMBAT_DAMAGE] Skipping blocker ${blockerId} - marked for destruction`);
            continue;
          }
          
          const blockerCard = blocker.card || {};
          console.log(`${ts()} [COMBAT_DAMAGE] Found blocker: ${blockerCard.name || blockerId}, parsing keywords...`);
          
          let blockerKeywords;
          try {
            blockerKeywords = parseCreatureKeywords(blockerCard, blocker);
            console.log(`${ts()} [COMBAT_DAMAGE] Blocker keywords parsed successfully`);
          } catch (err) {
            console.error(`${ts()} [COMBAT_DAMAGE] CRASH parsing keywords for blocker ${blockerCard.name || blockerId}:`, err);
            blockerKeywords = {
              flying: false, reach: false, shadow: false, horsemanship: false,
              fear: false, intimidate: false, menace: false, skulk: false,
              unblockable: false, firstStrike: false, doubleStrike: false,
              lifelink: false, deathtouch: false, trample: false, vigilance: false,
              indestructible: false, hexproof: false, shroud: false, haste: false,
              defender: false, cantAttack: false, cantBlock: false,
            };
          }
          const blockerPower = parseInt(String(blocker.basePower ?? blockerCard.power ?? '0'), 10) || 0;
          console.log(`${ts()} [COMBAT_DAMAGE] Blocker ${blockerCard.name || blockerId} has power ${blockerPower}`);
          
          // Check if this blocker should deal damage in this phase based on first strike rules
          const blockerHasFirstStrike = blockerKeywords.firstStrike || blockerKeywords.doubleStrike;
          
          if (isFirstStrikePhase === true) {
            // First strike phase - only first strike or double strike blockers deal damage
            if (!blockerHasFirstStrike) {
              console.log(`${ts()} [COMBAT_DAMAGE] Skipping blocker ${blockerCard.name || blockerId} in first strike phase (no first/double strike)`);
              continue;
            }
          } else if (isFirstStrikePhase === false) {
            // Regular damage phase after first strike - skip first strike-only blockers
            // but double strike blockers deal damage again
            if (blockerKeywords.firstStrike && !blockerKeywords.doubleStrike) {
              console.log(`${ts()} [COMBAT_DAMAGE] Skipping blocker ${blockerCard.name || blockerId} in regular phase (first strike only, already dealt)`);
              continue;
            }
          }
          
          if (blockerPower > 0) {
            // Deal damage to attacker
            attacker.markedDamage = (attacker.markedDamage || 0) + blockerPower;
            
            console.log(`${ts()} [COMBAT_DAMAGE] Blocker ${blockerCard.name || blockerId} dealt ${blockerPower} damage to attacker ${card.name || attacker.id}`);
            
            // Check if attacker dies
            const attackerToughness = parseInt(String(attacker.baseToughness ?? card.toughness ?? '0'), 10) || 0;
            const totalDamageOnAttacker = attacker.markedDamage || 0;
            const isDead = totalDamageOnAttacker >= attackerToughness || (blockerKeywords.deathtouch && totalDamageOnAttacker > 0);
            
            console.log(`${ts()} [COMBAT_DAMAGE] Attacker ${card.name || attacker.id}: toughness=${attackerToughness}, totalDamage=${totalDamageOnAttacker}, isDead=${isDead}`);
            
            if (isDead && !result.creaturesDestroyed.includes(attacker.id)) {
              result.creaturesDestroyed.push(attacker.id);
              console.log(`${ts()} [COMBAT_DAMAGE] Attacker ${card.name || attacker.id} received lethal damage`);
            }
            
            // Lifelink for blocker
            if (blockerKeywords.lifelink) {
              const blockerController = blocker.controller;
              const controllerLife = life[blockerController] ?? startingLife;
              life[blockerController] = controllerLife + blockerPower;
              
              result.lifeGainForPlayers[blockerController] = 
                (result.lifeGainForPlayers[blockerController] || 0) + blockerPower;
              
              console.log(`${ts()} [COMBAT_DAMAGE] Blocker ${blockerCard.name || blockerId} lifelink: ${blockerController} gained ${blockerPower} life`);
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
      console.log(`${ts()} [dealCombatDamage] Players defeated due to combat damage: ${defeatedPlayers.join(', ')}`);
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
    
    console.log(`${ts()} [dealCombatDamage] Combat damage complete. Damage to players: ${JSON.stringify(result.damageToPlayers)}, Life gained: ${JSON.stringify(result.lifeGainForPlayers)}, Creatures destroyed: ${result.creaturesDestroyed.length}`);
    
    // Run state-based actions to destroy creatures that have lethal damage
    // This will move creatures with 0 or less toughness (after damage) to the graveyard
    try {
      runSBA(ctx);
    } catch (sbaErr) {
      console.warn(`${ts()} [dealCombatDamage] SBA failed:`, sbaErr);
    }
    
  } catch (err) {
    console.warn(`${ts()} dealCombatDamage failed:`, err);
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
      console.log(`${ts()} [clearDamageFromPermanents] Cleared damage from ${clearedCount} permanent(s) (Rule 514.2/703.4p)`);
    }
  } catch (err) {
    console.warn(`${ts()} clearDamageFromPermanents failed:`, err);
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
    
    if (endedCount > 0) {
      console.log(`${ts()} [endTemporaryEffects] Ended ${endedCount} temporary effect(s) (Rule 514.2)`);
    }
  } catch (err) {
    console.warn(`${ts()} endTemporaryEffects failed:`, err);
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
      console.log(`${ts()} [clearSummoningSicknessForPlayer] Cleared summoning sickness from ${clearedCount} permanent(s) for ${playerId}`);
    }
  } catch (err) {
    console.warn(`${ts()} clearSummoningSicknessForPlayer failed:`, err);
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
    console.warn(`${ts()} [anyPlayerHasSundialEffect] Error checking for Sundial effects:`, err);
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
          console.warn(`${ts()} [untapPermanentsForPlayer] Failed to check untap prevention for ${permanent.card?.name}:`, e);
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
      console.log(
        `${ts()} [untapPermanentsForPlayer] Player ${playerId}: untapped ${untappedCount}, stun counters removed ${stunCountersRemoved}, skipped (doesn't untap) ${skippedDueToEffects}`
      );
    }
  } catch (err) {
    console.warn(`${ts()} untapPermanentsForPlayer failed:`, err);
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
      console.log(`${ts()} [nextTurn] No active players remaining, game should end`);
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
        console.log(`${ts()} [nextTurn] Skipping extra turn for inactive player ${next}`);
        // Recursive call to get next turn
        nextTurn(ctx);
        return;
      }
      console.log(`${ts()} [nextTurn] Taking extra turn for ${next} (turn ${turnNumber})`);
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

    // Reset to beginning of turn
    (ctx as any).state.phase = "beginning";
    (ctx as any).state.step = "UNTAP";

    // Rule 302.6: Clear summoning sickness at the BEGINNING of the turn
    // This is independent of untapping - a creature that doesn't untap due to
    // an effect still loses summoning sickness at the start of its controller's turn
    try {
      clearSummoningSicknessForPlayer(ctx, next);
    } catch (err) {
      console.warn(`${ts()} [nextTurn] Failed to clear summoning sickness:`, err);
    }

    // Note: Untapping happens when leaving the UNTAP step (in nextStep),
    // not at the start of the turn. This matches MTG rules where turn-based
    // actions occur during the step, and allows cards to be played/tapped
    // during the untap step before untapping occurs.

    // give priority to the active player at the start of turn
    (ctx as any).state.priority = next;

    // Reset lands played this turn for all players
    (ctx as any).state.landsPlayedThisTurn = (ctx as any).state.landsPlayedThisTurn || {};
    for (const pid of players) {
      (ctx as any).state.landsPlayedThisTurn[pid] = 0;
    }
    
    // Reset cards drawn this turn for all players (for miracle tracking)
    (ctx as any).state.cardsDrawnThisTurn = {};

    // Recalculate player effects based on battlefield (Exploration, Font of Mythos, etc.)
    try {
      recalculatePlayerEffects(ctx);
    } catch (err) {
      console.warn(`${ts()} [nextTurn] Failed to recalculate player effects:`, err);
    }

    console.log(
      `${ts()} [nextTurn] Advanced to player ${next}, phase=${(ctx as any).state.phase}, step=${(ctx as any).state.step}`
    );
    ctx.bumpSeq();
  } catch (err) {
    console.warn(`${ts()} nextTurn failed:`, err);
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
    
    for (const pid of players) {
      const currentPool = (ctx as any).state.manaPool[pid] || {};
      
      // Check if this player has a "doesn't empty" effect
      if (currentPool.doesNotEmpty) {
        // Determine target color for conversion (support both new convertsTo and deprecated convertsToColorless)
        const targetColor = currentPool.convertsTo || (currentPool.convertsToColorless ? 'colorless' : null);
        
        if (targetColor) {
          // Convert all other colors to the target color
          const colorsToConvert = ['white', 'blue', 'black', 'red', 'green', 'colorless'].filter(c => c !== targetColor);
          let totalConverted = 0;
          
          for (const color of colorsToConvert) {
            totalConverted += (currentPool[color] || 0);
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
            convertsToColorless: currentPool.convertsToColorless,
            noEmptySourceIds: currentPool.noEmptySourceIds,
          };
          
          // Set the target color to include both existing amount and converted amount
          newPool[targetColor] = (currentPool[targetColor] || 0) + totalConverted;
          
          // Restricted mana also converts to target color
          if (currentPool.restricted) {
            newPool.restricted = currentPool.restricted.map((entry: any) => ({
              ...entry,
              type: targetColor,
            }));
          }
          
          (ctx as any).state.manaPool[pid] = newPool;
          
          console.log(`${ts()} [clearManaPool] Player ${pid}: Converted ${totalConverted} mana to ${targetColor}`);
        } else {
          // Mana doesn't empty at all (e.g., Omnath Locus of Mana for green)
          console.log(`${ts()} [clearManaPool] Player ${pid}: Mana pool preserved (doesn't empty effect)`);
        }
      } else {
        // Normal case: empty the pool
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
    
    console.log(`${ts()} [clearManaPool] Processed mana pools for all players`);
  } catch (err) {
    console.warn(`${ts()} clearManaPool failed:`, err);
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
    console.warn(`${ts()} getMaxHandSize failed:`, err);
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
      
      console.log(
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
    
    console.log(
      `${ts()} [setupCleanupDiscard] Player ${playerId} needs to discard ${discardCount} cards (hand: ${handSize}, max: ${maxHandSize})`
    );
    
    return { needsInteraction: true, discardCount };
  } catch (err) {
    console.warn(`${ts()} setupCleanupDiscard failed:`, err);
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
      console.warn(`${ts()} [executeCleanupDiscard] No pending discard for player ${playerId}`);
      return false;
    }
    
    if (cardIds.length !== pendingDiscard.count) {
      console.warn(`${ts()} [executeCleanupDiscard] Wrong number of cards: expected ${pendingDiscard.count}, got ${cardIds.length}`);
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
    
    console.log(
      `${ts()} [executeCleanupDiscard] Player ${playerId} discarded ${discardedCards.length} cards`
    );
    
    ctx.bumpSeq();
    return true;
  } catch (err) {
    console.warn(`${ts()} executeCleanupDiscard failed:`, err);
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
    (ctx as any).state = (ctx as any).state || {};
    const currentPhase = String((ctx as any).state.phase || "beginning");
    const currentStep = String((ctx as any).state.step || "");
    
    // Check if we're in replay mode - if so, skip side effects
    const isReplaying = !!(ctx as any).isReplaying;

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

    if (currentPhase === "beginning" || currentPhase === "pre_game" || currentPhase === "") {
      if (currentStep === "" || currentStep === "untap" || currentStep === "UNTAP") {
        nextPhase = "beginning";
        nextStep = "UPKEEP";
        shouldUntap = !isReplaying; // Untap all permanents when leaving UNTAP step (skip during replay)
        
        // Process beginning of upkeep triggers (e.g., Phyrexian Arena, Progenitor Mimic, cumulative upkeep)
        // Skip trigger processing during replay - triggers should be handled by replayed events
        if (!isReplaying) {
          const turnPlayer = (ctx as any).state?.turnPlayer;
          if (turnPlayer) {
            const upkeepTriggers = getUpkeepTriggersForPlayer(ctx, turnPlayer);
            if (upkeepTriggers.length > 0) {
              console.log(`${ts()} [nextStep] Found ${upkeepTriggers.length} upkeep triggers`);
              // Store pending triggers on the game state for the socket layer to process
              (ctx as any).state.pendingUpkeepTriggers = upkeepTriggers;
              
              // Group triggers by controller for APNAP ordering
              const triggersByController = new Map<string, typeof upkeepTriggers>();
              for (const trigger of upkeepTriggers) {
                if (trigger.mandatory && trigger.triggerType === 'upkeep_effect') {
                  const controller = trigger.permanentId ? 
                    ((ctx as any).state.battlefield || []).find((p: any) => p?.id === trigger.permanentId)?.controller || turnPlayer 
                    : turnPlayer;
                  const existing = triggersByController.get(controller) || [];
                  existing.push(trigger);
                  triggersByController.set(controller, existing);
                }
              }
              
              // If a player has multiple triggers, they need to choose the order (APNAP rule)
              // For now, if a player has 2+ triggers, set a flag for the socket layer to handle ordering
              for (const [controller, triggers] of triggersByController.entries()) {
                if (triggers.length > 1) {
                  // Store pending trigger ordering request
                  (ctx as any).state.pendingTriggerOrdering = (ctx as any).state.pendingTriggerOrdering || {};
                  (ctx as any).state.pendingTriggerOrdering[controller] = {
                    timing: 'upkeep',
                    triggers: triggers.map(t => ({
                      id: `upkeep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                      cardName: t.cardName,
                      description: t.description,
                      permanentId: t.permanentId,
                      effect: t.effect,
                    })),
                  };
                  console.log(`${ts()} [nextStep] ${controller} has ${triggers.length} upkeep triggers to order`);
                } else if (triggers.length === 1) {
                  // Single trigger, just push to stack
                  const trigger = triggers[0];
                  const triggerId = `upkeep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                  (ctx as any).state.stack = (ctx as any).state.stack || [];
                  (ctx as any).state.stack.push({
                    id: triggerId,
                    type: 'triggered_ability',
                    controller,
                    source: trigger.permanentId,
                    sourceName: trigger.cardName,
                    description: trigger.description,
                    triggerType: 'upkeep_effect',
                    mandatory: true,
                    effect: trigger.effect,
                  });
                  console.log(`${ts()} [nextStep] ⚡ Pushed upkeep trigger onto stack: ${trigger.cardName} - ${trigger.description}`);
                }
              }
            }
          }
        }
      } else if (currentStep === "upkeep" || currentStep === "UPKEEP") {
        nextPhase = "beginning";
        nextStep = "DRAW";
        shouldDraw = !isReplaying; // Draw a card when entering draw step (skip during replay)
        
        // Process draw step triggers (rare, but some cards have them)
        // Skip during replay - triggers should be handled by replayed events
        if (!isReplaying) {
          const turnPlayer = (ctx as any).state?.turnPlayer;
          if (turnPlayer) {
            const drawTriggers = getDrawStepTriggers(ctx, turnPlayer);
            if (drawTriggers.length > 0) {
              console.log(`${ts()} [nextStep] Found ${drawTriggers.length} draw step triggers`);
              (ctx as any).state.pendingDrawStepTriggers = drawTriggers;
            }
          }
        }
      } else {
        // After draw, go to precombatMain
        nextPhase = "precombatMain";
        nextStep = "MAIN1";
      }
    } else if (currentPhase === "precombatMain" || currentPhase === "main1") {
      nextPhase = "combat";
      nextStep = "BEGIN_COMBAT";
      
      // Process beginning of combat triggers (e.g., Hakbal of the Surging Soul)
      // Skip during replay - triggers should be handled by replayed events
      if (!isReplaying) {
        const turnPlayer = (ctx as any).state?.turnPlayer;
        if (turnPlayer) {
          const combatTriggers = getBeginningOfCombatTriggers(ctx, turnPlayer);
          if (combatTriggers.length > 0) {
            console.log(`${ts()} [nextStep] Found ${combatTriggers.length} beginning of combat triggers`);
            // Store pending triggers on the game state for the socket layer to process
            (ctx as any).state.pendingCombatTriggers = combatTriggers;
          }
        }
      }
    } else if (currentPhase === "combat") {
      if (currentStep === "beginCombat" || currentStep === "BEGIN_COMBAT") {
        nextStep = "DECLARE_ATTACKERS";
      } else if (currentStep === "declareAttackers" || currentStep === "DECLARE_ATTACKERS") {
        nextStep = "DECLARE_BLOCKERS";
      } else if (currentStep === "declareBlockers" || currentStep === "DECLARE_BLOCKERS") {
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
          console.log(`${ts()} [COMBAT_STEP] ========== TRANSITIONING TO FIRST_STRIKE_DAMAGE (first/double strike detected) ==========`);
          nextStep = "FIRST_STRIKE_DAMAGE";
          // Deal first strike damage - skip during replay
          if (!isReplaying) {
            try {
              console.log(`${ts()} [COMBAT_STEP] Calling dealCombatDamage (first strike phase)...`);
              const combatResult = dealCombatDamage(ctx, true); // Pass flag for first strike phase
              console.log(`${ts()} [COMBAT_STEP] First strike damage completed`);
              (ctx as any).state.lastFirstStrikeDamageResult = combatResult;
            } catch (err) {
              console.error(`${ts()} [COMBAT_STEP] CRASH in first strike dealCombatDamage:`, err);
            }
          }
        } else {
          console.log(`${ts()} [COMBAT_STEP] ========== TRANSITIONING FROM DECLARE_BLOCKERS TO DAMAGE (no first strike) ==========`);
          nextStep = "DAMAGE";
          // Deal combat damage when entering the DAMAGE step (Rule 510) - skip during replay
          if (!isReplaying) {
            try {
              console.log(`${ts()} [COMBAT_STEP] Calling dealCombatDamage...`);
              const combatResult = dealCombatDamage(ctx);
              console.log(`${ts()} [COMBAT_STEP] dealCombatDamage completed successfully`);
              console.log(`${ts()} [COMBAT_STEP] Result: damageToPlayers=${JSON.stringify(combatResult.damageToPlayers)}, creaturesDestroyed=${combatResult.creaturesDestroyed.length}`);
              (ctx as any).state.lastCombatDamageResult = combatResult;
            } catch (err) {
              console.error(`${ts()} [COMBAT_STEP] CRASH in dealCombatDamage:`, err);
              console.warn(`${ts()} [nextStep] Failed to deal combat damage:`, err);
            }
          }
        }
        console.log(`${ts()} [COMBAT_STEP] ========== END DAMAGE STEP PROCESSING ==========`);
      } else if (currentStep === "firstStrikeDamage" || currentStep === "FIRST_STRIKE_DAMAGE") {
        // After first strike damage, proceed to regular combat damage
        console.log(`${ts()} [COMBAT_STEP] ========== TRANSITIONING FROM FIRST_STRIKE_DAMAGE TO DAMAGE ==========`);
        nextStep = "DAMAGE";
        // Deal regular combat damage (from creatures without first strike, and double strike creatures again)
        // Skip during replay - combat damage should be handled by replayed events
        if (!isReplaying) {
          try {
            console.log(`${ts()} [COMBAT_STEP] Calling dealCombatDamage (regular damage phase after first strike)...`);
            const combatResult = dealCombatDamage(ctx, false); // Regular damage phase
            console.log(`${ts()} [COMBAT_STEP] Regular damage completed`);
            (ctx as any).state.lastCombatDamageResult = combatResult;
          } catch (err) {
            console.error(`${ts()} [COMBAT_STEP] CRASH in regular dealCombatDamage:`, err);
          }
        }
      } else if (currentStep === "combatDamage" || currentStep === "DAMAGE") {
        nextStep = "END_COMBAT";
        
        // Process end of combat triggers - skip during replay
        if (!isReplaying) {
          const turnPlayer = (ctx as any).state?.turnPlayer;
          if (turnPlayer) {
            const endCombatTriggers = getEndOfCombatTriggers(ctx, turnPlayer);
            if (endCombatTriggers.length > 0) {
              console.log(`${ts()} [nextStep] Found ${endCombatTriggers.length} end of combat triggers`);
              (ctx as any).state.pendingEndOfCombatTriggers = endCombatTriggers;
            }
          }
        }
      } else {
        // After endCombat, check for extra combat phases before going to postcombatMain
        // Skip extra combat processing during replay - should be handled by replayed events
        if (!isReplaying && hasExtraCombat(ctx)) {
          // There's an extra combat phase pending
          const extraCombat = consumeExtraCombat(ctx);
          console.log(`${ts()} [nextStep] Starting extra combat phase from ${extraCombat?.source || 'Unknown'}`);
          
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
      
      // Process beginning of end step triggers (e.g., Kynaios and Tiro, Meren, Atraxa)
      // Skip during replay - triggers should be handled by replayed events
      if (!isReplaying) {
        const turnPlayer = (ctx as any).state?.turnPlayer;
        if (turnPlayer) {
          const endStepTriggers = getEndStepTriggers(ctx, turnPlayer);
          if (endStepTriggers.length > 0) {
            console.log(`${ts()} [nextStep] Found ${endStepTriggers.length} end step triggers`);
            // Store pending triggers on the game state for the socket layer to process
            (ctx as any).state.pendingEndStepTriggers = endStepTriggers;
          }
        }
      }
    } else if (currentPhase === "ending") {
      if (currentStep === "endStep" || currentStep === "end" || currentStep === "END") {
        nextStep = "CLEANUP";
        // When entering cleanup step, check if we should auto-advance to next turn
        // This happens when no discard is needed, stack is empty, no triggers, and no Sundial effect
        shouldAdvanceTurn = !isReplaying; // Only auto-advance during live play, not during replay
      } else if (currentStep === "cleanup" || currentStep === "CLEANUP") {
        // Cleanup step: player has already had opportunity to use Sundial
        // Now advance to next turn (after discard check)
        shouldAdvanceTurn = !isReplaying; // Only auto-advance during live play, not during replay
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

    console.log(
      `${ts()} [nextStep] Advanced to phase=${nextPhase}, step=${nextStep}`
    );

    // If we should advance to next turn, call nextTurn instead
    if (shouldAdvanceTurn) {
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
            console.log(`${ts()} [nextStep] Waiting for player to select ${discardCheck.discardCount} cards to discard`);
            ctx.bumpSeq();
            return; // Stop here - turn will advance after discard selection
          }
        }
      } catch (err) {
        console.warn(`${ts()} [nextStep] Failed to check discard during cleanup:`, err);
      }
      
      // If any player has a Sundial-like effect and stack is empty, 
      // don't auto-advance - let players have a chance to use it
      // Per Rule 514.3: Normally no priority during cleanup, but if triggers or SBAs occur, priority is given
      // We extend this to also give priority when Sundial effects are available
      if (hasSundialEffect && stackEmpty) {
        console.log(`${ts()} [nextStep] Player has Sundial effect available, pausing at cleanup for potential action`);
        ctx.bumpSeq();
        return; // Stop here - player can use Sundial effect or pass to advance
      }
      
      // Rule 514.2: Clear damage from all permanents and end temporary effects
      // This happens simultaneously after discarding
      try {
        clearDamageFromPermanents(ctx);
        endTemporaryEffects(ctx);
      } catch (err) {
        console.warn(`${ts()} [nextStep] Failed to clear damage/effects during cleanup:`, err);
      }
      
      console.log(`${ts()} [nextStep] Cleanup complete, advancing to next turn`);
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
              console.log(`${ts()} [nextStep] ${effect.cardName} untapped ${count} permanents for ${effect.controllerId}`);
            }
          }
        } else {
          console.warn(`${ts()} [nextStep] No turnPlayer set, cannot untap permanents`);
        }
      } catch (err) {
        console.warn(`${ts()} [nextStep] Failed to untap permanents:`, err);
      }
    }

    // If we're entering the draw step, draw a card for the active player
    // Also apply any additional draw effects (Font of Mythos, Rites of Flourishing, etc.)
    if (shouldDraw) {
      try {
        const turnPlayer = (ctx as any).state.turnPlayer;
        if (turnPlayer) {
          // Calculate total cards to draw: 1 (base) + any additional draws from effects
          const additionalDraws = (ctx as any).additionalDrawsPerTurn?.[turnPlayer] || 0;
          const totalDraws = 1 + additionalDraws;
          
          const drawn = drawCards(ctx, turnPlayer, totalDraws);
          console.log(
            `${ts()} [nextStep] Drew ${drawn.length} card(s) for ${turnPlayer} at draw step (base: 1, additional: ${additionalDraws})`
          );
        } else {
          console.warn(`${ts()} [nextStep] No turnPlayer set, cannot draw card`);
        }
      } catch (err) {
        console.warn(`${ts()} [nextStep] Failed to draw card:`, err);
      }
    }

    ctx.bumpSeq();
  } catch (err) {
    console.warn(`${ts()} nextStep failed:`, err);
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
    console.warn(`${ts()} scheduleStepsAfterCurrent failed:`, err);
  }
}

export function scheduleStepsAtEndOfTurn(ctx: any, steps: any[]) {
  try {
    if (!ctx) return;
    ctx._scheduledEndOfTurnSteps = ctx._scheduledEndOfTurnSteps || [];
    if (!Array.isArray(steps)) return;
    ctx._scheduledEndOfTurnSteps.push(...steps);
  } catch (err) {
    console.warn(`${ts()} scheduleStepsAtEndOfTurn failed:`, err);
  }
}

export function clearScheduledSteps(ctx: any) {
  try {
    if (!ctx) return;
    ctx._scheduledSteps = [];
    ctx._scheduledEndOfTurnSteps = [];
  } catch (err) {
    console.warn(`${ts()} clearScheduledSteps failed:`, err);
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
    console.warn(`${ts()} removeScheduledSteps failed:`, err);
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
    
    console.log(`${ts()} [addExtraTurn] Extra turn added for ${playerId} from "${source || 'Unknown'}" (current turn: ${turnNumber})`);
    ctx.bumpSeq();
  } catch (err) {
    console.warn(`${ts()} addExtraTurn failed:`, err);
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
    
    console.log(`${ts()} [addExtraCombat] Extra combat added from "${source || 'Unknown'}" (untap: ${untapAttackers})`);
    ctx.bumpSeq();
  } catch (err) {
    console.warn(`${ts()} addExtraCombat failed:`, err);
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
    
    console.log(`${ts()} [consumeExtraCombat] Starting extra combat from "${extraCombat.source}" (combat #${state.combatNumber})`);
    
    // If untapAttackers is true, untap all creatures that attacked
    if (extraCombat.untapAttackers) {
      const battlefield = state.battlefield || [];
      for (const perm of battlefield) {
        if (perm && perm.attacking) {
          perm.tapped = false;
          console.log(`${ts()} [consumeExtraCombat] Untapped ${perm.card?.name || perm.id} for extra combat`);
        }
      }
    }
    
    ctx.bumpSeq();
    return extraCombat;
  } catch (err) {
    console.warn(`${ts()} consumeExtraCombat failed:`, err);
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
      console.log(`${ts()} [skipExtraTurn] Skipped extra turn for ${playerId} from "${skipped.source || 'Unknown'}"`);
      ctx.bumpSeq();
      return true;
    }
    return false;
  } catch (err) {
    console.warn(`${ts()} skipExtraTurn failed:`, err);
    return false;
  }
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
};