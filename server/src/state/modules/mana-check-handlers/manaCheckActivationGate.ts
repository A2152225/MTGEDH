// Origin parent: server/src/state/modules/mana-check.ts
// Cluster moved: canCountPermanentManaAbilities (metalcraft / threshold activation gate).
// Public entry symbols: canCountPermanentManaAbilities.
// Leaf must not import mana-check.ts or mana-check-handlers/index.ts.

import type { PlayerID } from "../../../../../shared/src/index.js";
import { detectActivatedAbilityConditionRequirement } from "../activated-ability-conditions.js";
import { getActiveAbilityConditions } from "../game-state-effects.js";

/**
 * Metalcraft / threshold-style activation restrictions (e.g. Mox Opal) must gate
 * optimistic mana availability the same way live activation does. Otherwise canAct /
 * playable-card checks inflate available mana and block auto-pass.
 */
export function canCountPermanentManaAbilities(state: any, playerId: PlayerID, oracleText: string): boolean {
  const requirement = detectActivatedAbilityConditionRequirement(String(oracleText || ''));
  if (!requirement) return true;
  const activeConditions = getActiveAbilityConditions({ state } as any, String(playerId));
  return activeConditions[requirement.key] === true;
}
