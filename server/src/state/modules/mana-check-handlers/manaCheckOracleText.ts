// Origin parent: server/src/state/modules/mana-check.ts
// Cluster moved: stripReminderTextFromOracle (keep parenthetical mana abilities).
// Public entry symbols: stripReminderTextFromOracle.
// Leaf must not import mana-check.ts or mana-check-handlers/index.ts.

/**
 * Strip reminder parentheticals from oracle text without removing mana abilities
 * wrapped in parentheses (e.g. shock lands: "({T}: Add {U} or {B}.)").
 */
export function stripReminderTextFromOracle(oracleText: string): string {
  return String(oracleText || '').replace(/\(([^(){}]+)\)/g, '');
}
