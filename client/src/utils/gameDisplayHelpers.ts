/**
 * gameDisplayHelpers.ts
 * 
 * Utility functions for displaying game state information in the UI.
 * 
 * This module contains:
 * - Phase/Step formatting for human-readable display
 * - Card type detection helpers
 */

/**
 * Map engine/internal phase enum to human-friendly name
 */
export function prettyPhase(phase?: string | null): string {
  if (!phase) return "-";
  const p = String(phase);
  switch (p) {
    case "PRE_GAME":
    case "preGame":
      return "Pre-game";
    case "beginning":
      return "Beginning phase";
    case "precombatMain":
    case "main1":
      return "Main phase";
    case "combat":
      return "Combat phase";
    case "postcombatMain":
    case "main2":
      return "Main phase 2";
    case "ending":
      return "Ending phase";
    default:
      return p
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ")
        .replace(/^\w/, (c) => c.toUpperCase());
  }
}

/**
 * Map engine/internal step enum to human-friendly name
 */
export function prettyStep(step?: string | null): string {
  if (!step) return "";
  const s = String(step);
  switch (s) {
    case "untap":
      return "Untap step";
    case "upkeep":
      return "Upkeep step";
    case "draw":
      return "Draw step";
    case "main":
      return "Main phase";
    case "beginCombat":
      return "Beginning of combat step";
    case "declareAttackers":
      return "Declare attackers step";
    case "declareBlockers":
      return "Declare blockers step";
    case "combatDamage":
      return "Combat damage step";
    case "endCombat":
      return "End of combat step";
    case "endStep":
    case "end":
      return "End step";
    case "cleanup":
      return "Cleanup step";
    default:
      return s
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ")
        .replace(/^\w/, (c) => c.toUpperCase());
  }
}

/**
 * Check if a type line indicates a land card
 */
export function isLandTypeLine(tl?: string | null): boolean {
  return !!tl && /\bland\b/i.test(tl);
}
