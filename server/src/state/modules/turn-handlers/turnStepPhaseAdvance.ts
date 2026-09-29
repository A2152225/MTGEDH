// server/src/state/modules/turn-handlers/turnStepPhaseAdvance.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: nextStep() phase/step progression (pre_game abort through
// unknown-phase default), including first-strike/combat-damage transitions
// and extra-combat inserts.
// Public entry symbols: computeNextStepPhaseAdvance.
// nextStep remains the dispatcher. Leaf must not import turn.ts or
// turn-handlers/index.ts. dealCombatDamage is passed in to avoid a cycle.

import type { GameContext } from "../../context.js";
import { queueCombatDamageChat } from "../combatDamageChat.js";
import { hasExtraCombat, consumeExtraCombat } from "./turnScheduledStepsAndExtras.js";
import { clearCombatState } from "./turnClearCombatState.js";
import { expireEndOfCombatPtEffects } from "../longDurationPtModifiers.js";
import { playerIdCanReceivePriority } from "../priorityEligibility.js";
import { debug, debugError, debugWarn } from "../../../utils/debug.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

function activePlayerCanTakeExtraCombat(ctx: GameContext): boolean {
  const turnPlayer = String((ctx as any).state?.turnPlayer || '').trim();
  return Boolean(turnPlayer) && playerIdCanReceivePriority(ctx, turnPlayer);
}

function discardExtraCombatsIfActivePlayerIneligible(ctx: GameContext): void {
  const state = (ctx as any).state;
  if (!Array.isArray(state?.extraCombats) || state.extraCombats.length === 0) return;
  if (activePlayerCanTakeExtraCombat(ctx)) return;
  debug(2, `${ts()} [nextStep] Discarding ${state.extraCombats.length} extra combat(s) — active player ${state.turnPlayer} cannot receive priority`);
  state.extraCombats = [];
}

export type NextStepPhaseAdvance = {
  nextPhase: string;
  nextStep: string;
  shouldDraw: boolean;
  shouldUntap: boolean;
  shouldAdvanceTurn: boolean;
};

/**
 * Compute the next phase/step from the current ones.
 * Returns void when currentPhase is pre_game (caller must abort nextStep).
 * dealCombatDamage stays in the parent dispatcher and is passed in.
 */
export function computeNextStepPhaseAdvance(
  ctx: GameContext,
  currentPhase: string,
  currentStep: string,
  dealCombatDamage: (ctx: GameContext, isFirstStrikePhase?: boolean) => any,
): NextStepPhaseAdvance | void {
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
        shouldUntap = true; // Untap all permanents when leaving UNTAP step
        // NOTE: Upkeep triggers will be pushed AFTER phase/step update below
      } else if (currentStep === "upkeep" || currentStep === "UPKEEP") {
        nextPhase = "beginning";
        nextStep = "DRAW";
        shouldDraw = true; // Draw a card when entering draw step
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
        (ctx as any).state.attackersDeclaredBy = [];
        debug(2, `${ts()} [nextStep] Entering DECLARE_ATTACKERS, initialized attackersDeclaredBy array`);
      } else if (currentStep === "declareAttackers" || currentStep === "DECLARE_ATTACKERS") {
        nextStep = "DECLARE_BLOCKERS";
        // Initialize blockersDeclaredBy array when entering DECLARE_BLOCKERS step
        // This ensures a fresh start for each blocker declaration phase
        (ctx as any).state.blockersDeclaredBy = [];
        if ((ctx as any).state.attackersDeclaredBy) {
          delete (ctx as any).state.attackersDeclaredBy;
        }
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
          // Deal first strike damage
          try {
            debug(2, `${ts()} [COMBAT_STEP] Calling dealCombatDamage (first strike phase)...`);
            const combatResult = dealCombatDamage(ctx, true); // Pass flag for first strike phase
            debug(2, `${ts()} [COMBAT_STEP] First strike damage completed`);
            (ctx as any).state.lastFirstStrikeDamageResult = combatResult;
            queueCombatDamageChat((ctx as any).state, combatResult, { firstStrike: true });
          } catch (err) {
            debugError(1, `${ts()} [COMBAT_STEP] CRASH in first strike dealCombatDamage:`, err);
          }
        } else {
          debug(2, `${ts()} [COMBAT_STEP] ========== TRANSITIONING FROM DECLARE_BLOCKERS TO DAMAGE (no first strike) ==========`);
          nextStep = "DAMAGE";
          // Deal combat damage when entering the DAMAGE step (Rule 510)
          try {
            debug(2, `${ts()} [COMBAT_STEP] Calling dealCombatDamage...`);
            const combatResult = dealCombatDamage(ctx);
            debug(2, `${ts()} [COMBAT_STEP] dealCombatDamage completed successfully`);
            debug(2, `${ts()} [COMBAT_STEP] Result: damageToPlayers=${JSON.stringify(combatResult.damageToPlayers)}, creaturesDestroyed=${combatResult.creaturesDestroyed.length}`);
            (ctx as any).state.lastCombatDamageResult = combatResult;
            queueCombatDamageChat((ctx as any).state, combatResult);
          } catch (err) {
            debugError(1, `${ts()} [COMBAT_STEP] CRASH in dealCombatDamage:`, err);
            debugWarn(1, `${ts()} [nextStep] Failed to deal combat damage:`, err);
          }
        }
        debug(2, `${ts()} [COMBAT_STEP] ========== END DAMAGE STEP PROCESSING ==========`);
      } else if (currentStep === "firstStrikeDamage" || currentStep === "FIRST_STRIKE_DAMAGE") {
        // After first strike damage, proceed to regular combat damage
        debug(2, `${ts()} [COMBAT_STEP] ========== TRANSITIONING FROM FIRST_STRIKE_DAMAGE TO DAMAGE ==========`);
        nextStep = "DAMAGE";
        // Deal regular combat damage (from creatures without first strike, and double strike creatures again)
        try {
          debug(2, `${ts()} [COMBAT_STEP] Calling dealCombatDamage (regular damage phase after first strike)...`);
          const combatResult = dealCombatDamage(ctx, false); // Regular damage phase
          debug(2, `${ts()} [COMBAT_STEP] Regular damage completed`);
          (ctx as any).state.lastCombatDamageResult = combatResult;
          queueCombatDamageChat((ctx as any).state, combatResult);
        } catch (err) {
          debugError(1, `${ts()} [COMBAT_STEP] CRASH in regular dealCombatDamage:`, err);
        }
      } else if (currentStep === "combatDamage" || currentStep === "DAMAGE") {
        nextStep = "END_COMBAT";
        // NOTE: End of combat triggers will be pushed AFTER phase/step update below
      } else {
        // After endCombat, check for extra combat phases before going to postcombatMain
        if (hasExtraCombat(ctx) && activePlayerCanTakeExtraCombat(ctx)) {
          // There's an extra combat phase pending
          const extraCombat = consumeExtraCombat(ctx);
          debug(2, `${ts()} [nextStep] Starting extra combat phase from ${extraCombat?.source || 'Unknown'}`);
          
          // Go back to beginning of combat
          nextPhase = "combat";
          nextStep = "BEGIN_COMBAT";
          
          // Clear attacking/blocking state for new combat
          const battlefield = (ctx as any).state?.battlefield || [];
          // The previous combat ended: its "until end of combat" pumps end too.
          expireEndOfCombatPtEffects(battlefield);
          for (const perm of battlefield) {
            if (perm) {
              perm.attacking = null;
              perm.blockedBy = null;
              perm.blocking = null;
            }
          }
        } else {
          discardExtraCombatsIfActivePlayerIneligible(ctx);
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
      // Extra combat granted during a postcombat main (Relentless Assault, etc.)
      // inserts another combat, then another postcombat main. Tymna-style
      // "beginning of each of your postcombat main phases" fires again at that
      // later MAIN2+ entry — not mid-phase and not at end of combat.
      if (hasExtraCombat(ctx) && activePlayerCanTakeExtraCombat(ctx)) {
        const extraCombat = consumeExtraCombat(ctx);
        debug(2, `${ts()} [nextStep] Starting extra combat from postcombat main (${extraCombat?.source || 'Unknown'})`);
        nextPhase = "combat";
        nextStep = "BEGIN_COMBAT";
        const battlefield = (ctx as any).state?.battlefield || [];
        for (const perm of battlefield) {
          if (perm) {
            perm.attacking = null;
            perm.blockedBy = null;
            perm.blocking = null;
          }
        }
      } else {
        discardExtraCombatsIfActivePlayerIneligible(ctx);
        nextPhase = "ending";
        nextStep = "END";
      }
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
    return { nextPhase, nextStep, shouldDraw, shouldUntap, shouldAdvanceTurn };
}
