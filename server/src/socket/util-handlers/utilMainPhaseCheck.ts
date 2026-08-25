// server/src/socket/util-handlers/utilMainPhaseCheck.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: isInMainPhase - main-phase step token check shared by
//   getPlayableCardIds and getGraveyardAbilityHints.
// Public entry symbols: isInMainPhase.

/**
 * Check if game is in main phase
 */
export function isInMainPhase(state: any): boolean {
  try {
    const step = state.step;
    if (!step) return false;
    const stepStr = String(step).toUpperCase();
    // Check for main phase steps (with or without underscore for compatibility)
    return stepStr === 'MAIN1' || stepStr === 'MAIN2' ||
           stepStr === 'MAIN_1' || stepStr === 'MAIN_2' ||
           stepStr === 'MAIN' || stepStr.includes('MAIN');
  } catch {
    return false;
  }
}
