// Origin parent: rules-engine/src/RulesEngineAdapter.ts
// Cluster moved: buildTimingContext.
// Public entry symbols: buildTimingContext.
// Class methods become thin wrappers that call these via .call(this, ...).
// Leaf must not import RulesEngineAdapter.ts or RulesEngineAdapter-handlers/index.ts.

import type { GameState } from '../../../shared/src';

/** Adapter instance passed as `this` from RulesEngineAdapter thin wrappers. */
export type AdapterTimingContextHost = any;

  /**
   * Build timing context for spell validation
   */
export function buildTimingContext(this: AdapterTimingContextHost, state: GameState, playerId: string): {
    isMainPhase: boolean;
    isOwnTurn: boolean;
    stackEmpty: boolean;
    hasPriority: boolean;
  } {
    // Get phase info
    const phase = state.phase;
    // Support both enum values and string variants for phase comparison
    const phaseStr = String(phase || '').toLowerCase();
    const isMainPhase = phaseStr === 'precombatmain' || phaseStr === 'postcombatmain' ||
                        phaseStr === 'precombat_main' || phaseStr === 'postcombat_main' ||
                        phaseStr === 'first_main' || phaseStr === 'main1' || phaseStr === 'main2';
    
    // Check if it's the player's turn
    const activePlayerIndex = state.activePlayerIndex || 0;
    const activePlayer = state.players[activePlayerIndex];
    const isOwnTurn = activePlayer?.id === playerId;
    
    // Check stack
    const stackItems = Array.isArray((state as any).stack)
      ? (state as any).stack
      : Array.isArray(((state as any).stack || {}).objects)
        ? ((state as any).stack || {}).objects
        : [];
    const stackEmpty = stackItems.length === 0;
    
    // Check priority
    const priorityIndex = state.priorityPlayerIndex ?? activePlayerIndex;
    const priorityPlayer = state.players[priorityIndex];
    const hasPriority = priorityPlayer?.id === playerId;
    
    return {
      isMainPhase,
      isOwnTurn,
      stackEmpty,
      hasPriority,
    };
  }
