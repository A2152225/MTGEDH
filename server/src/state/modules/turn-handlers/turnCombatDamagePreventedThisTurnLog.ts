// Batch 20: "prevent all combat damage that would be dealt to it this turn" (granted temp ability) with a
// damageReplacementLog entry so the client toast shows it. Wraps isCombatDamagePreventedForPermanent.
// Public entry symbols: combatDamagePreventedThisTurnLogged.

import type { GameContext } from "../../context.js";
import { isCombatDamagePreventedForPermanent } from "./turnCombatDamagePermanentApply.js";
import { getCombatCreatureStats } from "./turnCombatDamageStatsPrevention.js";
import { combatDamageAssignmentAmount } from "./turnCombatDamageByToughness.js";
import { recordDamageReplacementMessages } from "../replacementDamageLog.js";

type NamedPermanent = { id?: unknown; card?: { name?: unknown } | null } | null | undefined;

const nameOf = (p: NamedPermanent): string => String(p?.card?.name || p?.id || 'creature');

/**
 * True when combat damage to `target` is prevented by a this-turn "prevent all combat damage" grant.
 * `amount` is the assigned damage; when omitted it is computed from `source`'s combat assignment amount.
 */
export function combatDamagePreventedThisTurnLogged(
  ctx: GameContext,
  target: Parameters<typeof isCombatDamagePreventedForPermanent>[0],
  source: Parameters<typeof getCombatCreatureStats>[1] | null,
  amount?: number,
): boolean {
  if (!isCombatDamagePreventedForPermanent(target)) return false;
  let n = Number(amount);
  if (!Number.isFinite(n) && source) {
    try { n = combatDamageAssignmentAmount(ctx, source, getCombatCreatureStats(ctx, source)); } catch { n = 0; }
  }
  n = Math.max(0, Number(n) || 0);
  if (n > 0) {
    recordDamageReplacementMessages(ctx.state, [`${nameOf(target)}: prevented ${n} combat damage (prevent all combat damage dealt to it this turn)`], n, 0);
  }
  return true;
}
