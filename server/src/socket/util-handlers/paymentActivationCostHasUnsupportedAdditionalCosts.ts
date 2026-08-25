// server/src/socket/util-handlers/paymentActivationCostHasUnsupportedAdditionalCosts.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: paymentActivationCostHasUnsupportedAdditionalCosts.
// Public entry symbols: paymentActivationCostHasUnsupportedAdditionalCosts.
// Re-exported from util.ts so the "./util.js" import path keeps working.

import { parseRemoveCounterActivationCost } from "./manaRemoveCounterCostParse.js";

/**
 * True when an activation cost includes costs spell-payment cannot currently pay
 * (discard, exile, pay life text residue, remove-from-other, etc.). Shared by cast
 * payment and AI payment planning so the AI never selects sources the caster rejects.
 * Self remove-counter clauses are supported and stripped before the residue check.
 */
export function paymentActivationCostHasUnsupportedAdditionalCosts(
  activationCost?: string | null,
  sourceCardName?: string,
): boolean {
  const normalizedCost = String(activationCost || '').trim();
  if (!normalizedCost) return false;

  let residue = normalizedCost;
  residue = residue.replace(/\{(?:[tq]|\d+|[wubrgc])\}/gi, ' ');
  residue = residue.replace(/sacrifice\s+[^,;:]*/gi, ' ');
  // Self remove-counter costs are paid during spell payment; strip only those.
  const parsedRemove = parseRemoveCounterActivationCost(normalizedCost, sourceCardName);
  if (parsedRemove?.refersToSource) {
    residue = residue.replace(parsedRemove.matchPattern, ' ');
  }
  residue = residue.replace(/[().]/g, ' ');
  residue = residue.replace(/,/g, ' ');
  residue = residue.replace(/\s+/g, ' ').trim();

  return residue.length > 0;
}

