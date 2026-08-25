// server/src/socket/util-handlers/permanentHasManaBatteryCounterLoop.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: permanentHasManaBatteryCounterLoop.
// Public entry symbols: permanentHasManaBatteryCounterLoop.
// Re-exported from util.ts so the "./util.js" import path keeps working.

import {
  parseRemoveCounterActivationCost,
  normalizeRemoveCounterTypePhrase,
} from "./manaRemoveCounterCostParse.js";

/**
 * True when a permanent both invests counters via a paid activated ability and can
 * later remove those counters for mana (Gemstone Array, Trigon charge lines, etc.).
 */
export function permanentHasManaBatteryCounterLoop(permanent: any): {
  invests: boolean;
  paysOut: boolean;
  counterTypes: string[];
} {
  const oracleText = String(permanent?.card?.oracle_text || '');
  const lines = oracleText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const investTypes = new Set<string>();
  const payoutTypes = new Set<string>();

  for (const line of lines) {
    const lower = line.toLowerCase();
    const putMatch = lower.match(
      /(?:^|:\s*)(?:\{[^}]+\}(?:,\s*\{[^}]+\})*\s*,?\s*)?put\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+([^\s]+(?:\s+[^\s]+)?)\s+counters?\s+on\b/i,
    );
    if (putMatch && /\{[^}]+\}/.test(line.split(':')[0] || '')) {
      const counterType = normalizeRemoveCounterTypePhrase(String(putMatch[1] || ''));
      if (counterType) investTypes.add(counterType);
    }

    const colonSplit = line.split(':');
    if (colonSplit.length < 2) continue;
    const costPart = colonSplit[0] || '';
    const effectPart = colonSplit.slice(1).join(':');
    const remove = parseRemoveCounterActivationCost(costPart, String(permanent?.card?.name || ''));
    if (remove?.refersToSource && /\badd\b/i.test(effectPart) && /\bmana\b|\{[wubrgc]\}/i.test(effectPart)) {
      payoutTypes.add(remove.counterType);
    }
  }

  const shared = [...investTypes].filter((type) => payoutTypes.has(type));
  return {
    invests: investTypes.size > 0,
    paysOut: payoutTypes.size > 0,
    counterTypes: shared.length > 0 ? shared : [...payoutTypes],
  };
}
