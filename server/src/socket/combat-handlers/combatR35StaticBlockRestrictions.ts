// server/src/socket/combat-handlers/combatR35StaticBlockRestrictions.ts
// Origin parent: combatLegalityGates.ts (canBlockAttacker).
// R35: block restrictions that come from continuous (static-spec) granted abilities:
//   attacker has "can't be blocked" (conditional self statics: Jeskai Infiltrator, Hazy Homunculus, Illvoi Infiltrator)
//   blocker has "can't block while goaded" and is goaded (Bothersome Quasit).
// Public entry symbols: staticGrantBlockRestrictionReason.

import { getCreatureGoadStatus } from './combatDeclareAttackersForceTapSupport.js';

export function staticGrantBlockRestrictionReason(
  blocker: any,
  attackerContinuous: readonly string[],
  blockerContinuous: readonly string[],
  battlefield: any[],
  gameState?: unknown,
): string | null {
  if (attackerContinuous.some((a) => a === "can't be blocked")) return "Attacker can't be blocked";
  if (blockerContinuous.some((a) => a === "can't block while goaded")) {
    const turn = Number((gameState as any)?.turn || 0);
    if (getCreatureGoadStatus(blocker, battlefield, String(blocker?.controller || ''), turn, gameState).isGoaded) {
      return "Goaded creatures can't block";
    }
  }
  return null;
}
