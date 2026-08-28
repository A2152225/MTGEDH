// server/src/state/modules/turn-handlers/checkPendingInteractions.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: checkPendingInteractions — ResolutionQueue plus legacy
// pending* field cleanup used by nextStep and getPendingInteractions.
// Public entry symbols: checkPendingInteractions.
// Leaf must not import turn.ts or turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../resolution/index.js";
import { debug, debugWarn } from "../../../utils/debug.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

/**
 * Check if there are any pending interactions that need to be resolved
 * before the game can advance to the next step/phase.
 */
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
export function checkPendingInteractions(ctx: GameContext): {
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
    const gameId = String((ctx as any).gameId || (ctx as any).id || '').trim();
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
    // Migrate legacy pending state to Resolution Queue (one-time, best-effort)
    // =========================================================================

    // Convert legacy pendingDiscardSelection -> ResolutionStepType.DISCARD_SELECTION (cleanup)
    // This prevents older game states from blocking step advancement forever.
    if (gameId && state.pendingDiscardSelection && Object.keys(state.pendingDiscardSelection).length > 0) {
      try {
        const legacy = state.pendingDiscardSelection as Record<string, any>;
        let createdAny = false;

        for (const [pid, pending] of Object.entries(legacy)) {
          if (!pending || typeof pending !== 'object') continue;

          const discardCount = Number(pending.count || 0);
          const maxHandSize = Number(pending.maxHandSize || 7);

          if (!Number.isFinite(discardCount) || discardCount <= 0) {
            delete legacy[pid];
            continue;
          }

          // Avoid creating duplicates if a discard step already exists.
          const existing = ResolutionQueueManager
            .getStepsForPlayer(gameId, pid as any)
            .find(s => s.type === ResolutionStepType.DISCARD_SELECTION && (s as any)?.reason === 'cleanup');
          if (existing) {
            delete legacy[pid];
            continue;
          }

          const zones = state.zones?.[pid];
          const handCards = Array.isArray(zones?.hand) ? zones.hand : [];
          const handOptions = handCards
            .filter((c: any) => c && c.id)
            .map((c: any) => ({
              id: String(c.id),
              label: String(c.name || c.label || 'Unknown'),
              imageUrl: c.imageUrl || c.image_url || c.image_uris?.normal,
            }));

          // If we can't build a hand list, keep legacy state (older clients).
          if (handOptions.length === 0) {
            continue;
          }

          const zoneHandSnapshot = handCards
            .filter((c: any) => c && typeof c === 'object' && c.id)
            .map((c: any) => ({ ...c, zone: 'hand' }));

          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.DISCARD_SELECTION,
            playerId: pid as any,
            sourceName: 'Cleanup Step',
            description: `Cleanup: discard ${discardCount} card(s) to maximum hand size.`,
            mandatory: true,
            hand: handOptions,
            zoneHandSnapshot,
            discardCount,
            currentHandSize: handOptions.length,
            maxHandSize,
            reason: 'cleanup',
            priority: -10,
          } as any);

          delete legacy[pid];
          createdAny = true;
        }

        if (Object.keys(legacy).length === 0) {
          delete state.pendingDiscardSelection;
        }

        if (createdAny) {
          result.hasPending = true;
          if (!result.pendingTypes.includes('discard_selection')) {
            result.pendingTypes.push('discard_selection');
          }
          result.details.pendingDiscardSelection = 'migrated_to_resolution_queue';
        }
      } catch (err) {
        debugWarn(1, `${ts()} [checkPendingInteractions] Failed to migrate pendingDiscardSelection:`, err);
      }
    }
    
    // Clean up deprecated pendingCommanderZoneChoice (now handled by generic Resolution Queue option_choice prompts)
    if (state.pendingCommanderZoneChoice && Object.keys(state.pendingCommanderZoneChoice).length > 0) {
      debugWarn(1, `${ts()} [checkPendingInteractions] Found deprecated pendingCommanderZoneChoice state - cleaning up`);
      delete state.pendingCommanderZoneChoice;
    }
    
    // Clean up deprecated pendingTriggerOrdering (now handled by Resolution Queue TRIGGER_ORDER)
    if (state.pendingTriggerOrdering && Object.keys(state.pendingTriggerOrdering).length > 0) {
      debugWarn(1, `${ts()} [checkPendingInteractions] Found deprecated pendingTriggerOrdering state - cleaning up`);
      delete state.pendingTriggerOrdering;
    }
    
    // Clean up deprecated pendingEntrapmentManeuver (legacy state; now generic oracle IR sacrifice TARGET_SELECTION)
    if (state.pendingEntrapmentManeuver && Object.keys(state.pendingEntrapmentManeuver).length > 0) {
      debugWarn(1, `${ts()} [checkPendingInteractions] Found deprecated pendingEntrapmentManeuver state - cleaning up`);
      delete state.pendingEntrapmentManeuver;
    }
    
    // Clean up deprecated pendingModalChoice (now handled by Resolution Queue MODAL_CHOICE)
    if (state.pendingModalChoice && Object.keys(state.pendingModalChoice).length > 0) {
      debugWarn(1, `${ts()} [checkPendingInteractions] Found deprecated pendingModalChoice state - cleaning up`);
      delete state.pendingModalChoice;
    }
    
    // Clean up deprecated pendingManaColorSelection (now handled by Resolution Queue MANA_COLOR_SELECTION)
    if (state.pendingManaColorSelection && Object.keys(state.pendingManaColorSelection).length > 0) {
      debugWarn(1, `${ts()} [checkPendingInteractions] Found deprecated pendingManaColorSelection state - cleaning up`);
      delete state.pendingManaColorSelection;
    }
    
    // Clean up deprecated pendingCreatureTypeSelection (now handled by Resolution Queue CREATURE_TYPE_CHOICE)
    if (state.pendingCreatureTypeSelection && Object.keys(state.pendingCreatureTypeSelection).length > 0) {
      debugWarn(1, `${ts()} [checkPendingInteractions] Found deprecated pendingCreatureTypeSelection state - cleaning up`);
      delete state.pendingCreatureTypeSelection;
    }
    
    // pendingFlickerReturns is processed during the END step (best-effort automation).
    // It should not block auto-advance.

    // Clean up deprecated pendingLinkedExileReturns (linked-exile is handled by triggers/linked-exile.ts)
    if (Array.isArray(state.pendingLinkedExileReturns) && state.pendingLinkedExileReturns.length > 0) {
      debugWarn(1, `${ts()} [checkPendingInteractions] Found deprecated pendingLinkedExileReturns state - cleaning up`);
      state.pendingLinkedExileReturns = [];
    }
    
    // Clean up deprecated pendingJoinForces (now handled by Resolution Queue JOIN_FORCES)
    if (Array.isArray(state.pendingJoinForces) && state.pendingJoinForces.length > 0) {
      debugWarn(1, `${ts()} [checkPendingInteractions] Found deprecated pendingJoinForces state - cleaning up`);
      state.pendingJoinForces = [];
    }
    
    // Clean up deprecated pendingTemptingOffer (now handled by Resolution Queue TEMPTING_OFFER)
    if (Array.isArray(state.pendingTemptingOffer) && state.pendingTemptingOffer.length > 0) {
      debugWarn(1, `${ts()} [checkPendingInteractions] Found deprecated pendingTemptingOffer state - cleaning up`);
      state.pendingTemptingOffer = [];
    }
    
    // Check for non-empty stack (spells/abilities waiting to resolve)
    // Note: This is a deliberate choice - if the stack has items, players should
    // explicitly pass priority to advance, not just click "next step"
    if (Array.isArray(state.stack) && state.stack.length > 0) {
      result.hasPending = true;
      result.pendingTypes.push('stack_not_empty');
      result.details.stackCount = state.stack.length;
    }
    
    const currentStep = (state.step || '').toString().toUpperCase();

    // Check for pending attacker declarations during DECLARE_ATTACKERS step.
    // Per Rule 508.1, the active player must declare attackers before the step can end.
    if (currentStep === 'DECLARE_ATTACKERS' || (currentStep.includes('ATTACKERS') && !currentStep.includes('BLOCKERS'))) {
      const turnPlayer = String(state.turnPlayer || '').trim();
      const attackersDeclaredBy: string[] = Array.isArray(state.attackersDeclaredBy) ? state.attackersDeclaredBy : [];

      if (turnPlayer && !attackersDeclaredBy.includes(turnPlayer)) {
        result.hasPending = true;
        result.pendingTypes.push('attacker_declaration');
        result.details.attackersNeeded = true;
        result.details.turnPlayer = turnPlayer;
        debug(2, `${ts()} [checkPendingInteractions] Waiting for ${turnPlayer} to declare attackers`);
      }
    }

    // Check for pending blocker declarations during DECLARE_BLOCKERS step
    // Per Rule 509, defending players must be given the opportunity to declare blockers
    // Blockers are declared in APNAP (Active Player, Non-Active Player) order
    // Don't auto-advance if there are attackers and potential blockers, unless all defenders have declared
    if (currentStep === 'DECLARE_BLOCKERS' || currentStep.includes('BLOCKERS')) {
      const battlefield = state.battlefield || [];
      const hasAttackers = battlefield.some((perm: any) => perm && perm.attacking);
      
      if (hasAttackers) {
        const activePlayerIds = new Set(
          (Array.isArray(state.players) ? state.players : [])
            .filter((player: any) => player && !player.hasLost && !player.eliminated && !player.conceded && !player.spectator && !player.isSpectator)
            .map((player: any) => String(player.id))
        );

        // Get all defending players (players being attacked)
        const defendingPlayersSet = new Set<string>();
        for (const perm of battlefield) {
          if (perm && perm.attacking) {
            const defenderId = String(perm.attacking || '').trim();
            if (defenderId && activePlayerIds.has(defenderId)) {
              defendingPlayersSet.add(defenderId);
            }
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
