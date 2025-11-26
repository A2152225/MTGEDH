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
import { getBeginningOfCombatTriggers } from "./triggered-abilities.js";

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
 * Returns { changed: boolean, resolvedNow?: boolean }
 *
 * This implementation is a defensive, simple rotation:
 * - If ctx.state.priority is not set, set to first active player and return changed=true.
 * - Otherwise move to next active player. If nothing changes, return changed=false.
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
      return { changed: false, resolvedNow: false };
    }

    // If no priority set, give to first active
    if (!state.priority) {
      state.priority = active[0];
      ctx.bumpSeq();
      return { changed: true, resolvedNow: false };
    }

    // If playerId provided but doesn't match current priority, ignore (no change)
    if (playerId && state.priority !== playerId) {
      // allow a replayed passPriority by other actor to still advance if desired:
      // treat as no-op to be conservative
      return { changed: false, resolvedNow: false };
    }

    // Check if there's something on the stack
    const stackLen = Array.isArray(state.stack) ? state.stack.length : 0;

    // For single-player games, passing priority should resolve the stack immediately
    if (active.length === 1) {
      if (stackLen > 0) {
        // Single player passed priority with stack items - resolve immediately
        ctx.bumpSeq();
        return { changed: true, resolvedNow: true };
      }
      // Single player, empty stack - nothing to do
      return { changed: false, resolvedNow: false };
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

    // If we've cycled back to the turn player with a non-empty stack, resolve
    if (nextId === state.turnPlayer && stackLen > 0) {
      // All players have passed - resolve the top of the stack
      state.priority = nextId;
      ctx.bumpSeq();
      return { changed: true, resolvedNow: true };
    }

    // If priority stays the same (shouldn't happen with >1 active), no change
    if (nextId === state.priority) {
      return { changed: false, resolvedNow: false };
    }

    state.priority = nextId;
    ctx.bumpSeq();

    return { changed: true, resolvedNow: false };
  } catch (err) {
    console.warn(`${ts()} passPriority stub failed:`, err);
    return { changed: false, resolvedNow: false };
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
 * Untap all permanents controlled by the specified player.
 * This implements Rule 502.3: During the untap step, the active player
 * untaps all their permanents simultaneously.
 * 
 * Special handling:
 * - Stun counters (Rule 122.1c): Instead of untapping, remove a stun counter
 * - "Doesn't untap" effects: Skip untapping for permanents with this flag
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
        // Check for "doesn't untap during untap step" effects
        const doesntUntap = permanent.doesntUntap || false;
        if (doesntUntap) {
          skippedDueToEffects++;
          continue;
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
 * - Updates turnPlayer to the next player in order
 * - Resets phase to "beginning" (start of turn)
 * - Sets step to "UNTAP" 
 * - Untaps all permanents controlled by the new active player
 * - Gives priority to the active player
 * - Resets landsPlayedThisTurn for all players
 */
export function nextTurn(ctx: GameContext) {
  try {
    (ctx as any).state = (ctx as any).state || {};
    const players = Array.isArray((ctx as any).state.players)
      ? (ctx as any).state.players.map((p: any) => p.id)
      : [];
    if (!players.length) return;
    const current = (ctx as any).state.turnPlayer;
    const idx = players.indexOf(current);
    const next = idx === -1 ? players[0] : players[(idx + 1) % players.length];
    (ctx as any).state.turnPlayer = next;

    // Reset to beginning of turn
    (ctx as any).state.phase = "beginning";
    (ctx as any).state.step = "UNTAP";

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
      (ctx as any).state.manaPool[pid] = {
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        colorless: 0,
      };
    }
    
    console.log(`${ts()} [clearManaPool] Cleared mana pools for all players`);
  } catch (err) {
    console.warn(`${ts()} clearManaPool failed:`, err);
  }
}

/**
 * Get the maximum hand size for a player.
 * Default is 7, but effects like "no maximum hand size" can change this.
 * @param ctx Game context
 * @param playerId Player ID
 * @returns Maximum hand size for the player (Infinity for no maximum)
 */
function getMaxHandSize(ctx: GameContext, playerId: string): number {
  try {
    // Check if player has "no maximum hand size" effect
    const state = (ctx as any).state;
    if (!state) return 7;
    
    // Check player-specific overrides
    // maxHandSize can be: a number, Infinity, or undefined
    const playerMaxHandSize = state.maxHandSize?.[playerId];
    if (playerMaxHandSize === Infinity || playerMaxHandSize === Number.POSITIVE_INFINITY) {
      return Infinity;
    }
    if (typeof playerMaxHandSize === "number" && playerMaxHandSize > 0) {
      return playerMaxHandSize;
    }
    
    // Check for battlefield permanents that grant "no maximum hand size"
    // Examples: Reliquary Tower, Thought Vessel, Spellbook
    const battlefield = state.battlefield || [];
    for (const perm of battlefield) {
      if (perm && perm.controller === playerId) {
        const oracle = (perm.card?.oracle_text || "").toLowerCase();
        if (oracle.includes("you have no maximum hand size")) {
          return Infinity;
        }
      }
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
    
    // Get player's hand
    const zones = state.zones?.[playerId];
    if (!zones || !Array.isArray(zones.hand)) {
      return { needsInteraction: false, discardCount: 0 };
    }
    
    const hand = zones.hand;
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
 */
export function nextStep(ctx: GameContext) {
  try {
    (ctx as any).state = (ctx as any).state || {};
    const currentPhase = String((ctx as any).state.phase || "beginning");
    const currentStep = String((ctx as any).state.step || "");

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

    if (currentPhase === "beginning" || currentPhase === "PRE_GAME" || currentPhase === "pre_game" || currentPhase === "") {
      if (currentStep === "" || currentStep === "untap" || currentStep === "UNTAP") {
        nextPhase = "beginning";
        nextStep = "UPKEEP";
        shouldUntap = true; // Untap all permanents when leaving UNTAP step
      } else if (currentStep === "upkeep" || currentStep === "UPKEEP") {
        nextPhase = "beginning";
        nextStep = "DRAW";
        shouldDraw = true; // Draw a card when entering draw step
      } else {
        // After draw, go to precombatMain
        nextPhase = "precombatMain";
        nextStep = "MAIN1";
      }
    } else if (currentPhase === "precombatMain" || currentPhase === "main1") {
      nextPhase = "combat";
      nextStep = "BEGIN_COMBAT";
      
      // Process beginning of combat triggers (e.g., Hakbal of the Surging Soul)
      const turnPlayer = (ctx as any).state?.turnPlayer;
      if (turnPlayer) {
        const combatTriggers = getBeginningOfCombatTriggers(ctx, turnPlayer);
        if (combatTriggers.length > 0) {
          console.log(`${ts()} [nextStep] Found ${combatTriggers.length} beginning of combat triggers`);
          // Store pending triggers on the game state for the socket layer to process
          (ctx as any).state.pendingCombatTriggers = combatTriggers;
        }
      }
    } else if (currentPhase === "combat") {
      if (currentStep === "beginCombat" || currentStep === "BEGIN_COMBAT") {
        nextStep = "DECLARE_ATTACKERS";
      } else if (currentStep === "declareAttackers" || currentStep === "DECLARE_ATTACKERS") {
        nextStep = "DECLARE_BLOCKERS";
      } else if (currentStep === "declareBlockers" || currentStep === "DECLARE_BLOCKERS") {
        nextStep = "DAMAGE";
      } else if (currentStep === "combatDamage" || currentStep === "DAMAGE") {
        nextStep = "END_COMBAT";
      } else {
        // After endCombat, go to postcombatMain
        nextPhase = "postcombatMain";
        nextStep = "MAIN2";
        // Clear combat state when leaving combat phase (Rule 506.4)
        clearCombatState(ctx);
      }
    } else if (currentPhase === "postcombatMain" || currentPhase === "main2") {
      nextPhase = "ending";
      nextStep = "END";
    } else if (currentPhase === "ending") {
      if (currentStep === "endStep" || currentStep === "end" || currentStep === "END") {
        nextStep = "CLEANUP";
      } else if (currentStep === "cleanup" || currentStep === "CLEANUP") {
        // Cleanup step: discard down to max hand size before advancing to next turn
        // After cleanup, advance to next turn
        shouldAdvanceTurn = true;
      } else {
        // Stay at cleanup if unknown step
        nextStep = "CLEANUP";
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
      // Before advancing to next turn, check if discard is needed (Rule 514.1)
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
      
      console.log(`${ts()} [nextStep] Cleanup complete, advancing to next turn`);
      ctx.bumpSeq();
      nextTurn(ctx);
      return;
    }

    // If we're leaving the UNTAP step, untap all permanents controlled by the active player (Rule 502.3)
    if (shouldUntap) {
      try {
        const turnPlayer = (ctx as any).state.turnPlayer;
        if (turnPlayer) {
          untapPermanentsForPlayer(ctx, turnPlayer);
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
};