// server/src/socket/combat-handlers/combatControlState.ts
// Origin parent: server/src/socket/combat.ts
// Cluster moved: CombatControlEffect plus getCombatControl / setCombatControl.
// Public entry symbols: CombatControlEffect, getCombatControl, setCombatControl.

import type { PlayerID } from "../../../../shared/src/types.js";

/**
 * Combat control effect type for type-safe access
 */
export interface CombatControlEffect {
  controllerId: PlayerID;
  sourceId: string;
  sourceName: string;
  controlsAttackers: boolean;
  controlsBlockers: boolean;
  mandatoryAttackers?: readonly string[];
  mandatoryBlockers?: Readonly<Record<string, readonly string[]>>;
  preventedAttackers?: readonly string[];
  preventedBlockers?: readonly string[];
}

/**
 * Helper to get combat control effect from game state (type-safe)
 */
export function getCombatControl(game: any): CombatControlEffect | undefined {
  return game?.state?.combat?.combatControl as CombatControlEffect | undefined;
}

// Attack/block legality gates moved to ./combat-handlers/combatLegalityGates.js
// (imported at the top of this file).

/**
 * Helper to set combat control effect on game state
 */
export function setCombatControl(game: any, combatControl: CombatControlEffect): void {
  if (!game.state.combat) {
    game.state.combat = {
      phase: 'declareAttackers',
      attackers: [],
      blockers: [],
    };
  }
  game.state.combat.combatControl = combatControl;
}
