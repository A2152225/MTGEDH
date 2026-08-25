/**
 * turn-phases-handlers/turnPhaseEffectChoiceHelpers.ts
 * Origin parent: server/src/state/modules/triggers/turn-phases.ts
 * Cluster moved: detectRequiresChoice, detectAffectsAllPlayers.
 * Public entry symbols: detectRequiresChoice, detectAffectsAllPlayers.
 */

/**
 * Detect if an effect requires player choice based on oracle text patterns
 */
export function detectRequiresChoice(effectText: string): boolean {
  const lowerEffect = effectText.toLowerCase();
  
  // Patterns that indicate player choice is required
  const choicePatterns = [
    /each player may/i,                    // Kynaios style
    /you may/i,                            // Optional effects
    /choose (?:one|two|a|an)/i,            // Modal choices
    /target/i,                             // Targeting requires selection
    /search your library/i,                // Search requires selection
    /put a .* card .* onto the battlefield/i,  // Card selection for battlefield
    /return .* card .* from .* to/i,       // Return effects with card selection
  ];
  
  return choicePatterns.some(pattern => pattern.test(lowerEffect));
}

/**
 * Detect if an effect affects all players based on oracle text patterns
 */
export function detectAffectsAllPlayers(effectText: string): boolean {
  const lowerEffect = effectText.toLowerCase();
  
  // Patterns that indicate all players are affected
  const allPlayersPatterns = [
    /each player/i,                        // "Each player may..."
    /each opponent/i,                      // "Each opponent..."
    /all players/i,                        // "All players..."
    /every player/i,                       // "Every player..."
    /each other player/i,                  // "Each other player..."
  ];
  
  return allPlayersPatterns.some(pattern => pattern.test(lowerEffect));
}
