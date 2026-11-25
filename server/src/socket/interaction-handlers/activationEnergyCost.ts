/**
 * Energy ({E}) activation costs mixed with mana and other costs, e.g. "{2}, Pay {E}",
 * "{T}, Pay {E}{E}", "{1}, Pay {E}{E}, Sacrifice this artifact", "Pay eight {E}".
 * {E} is not mana: the clause is split off so the remaining cost still pays normally,
 * and the energy is paid when the activation commits (CR 602.2b/h).
 */

const ENERGY_COUNT_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const PAY_ENERGY_RE = /\bpay\s+(?:((?:\{E\})+)|(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten)\s+\{E\})/gi;
const BARE_ENERGY_RE = /(?:\{E\})+/gi;

function countEnergySymbols(text: string): number {
  return (String(text || '').match(/\{E\}/gi) || []).length;
}

/** Split the energy clause off an activation cost; amount 0 when the cost has no energy. */
export function extractActivationEnergyCost(cost: unknown): { amount: number; remainingCost: string } {
  let amount = 0;
  let rest = String(cost || '').replace(PAY_ENERGY_RE, (_m: string, symbols?: string, count?: string) => {
    if (symbols) amount += countEnergySymbols(symbols);
    else {
      const word = String(count || '').toLowerCase();
      amount += /^\d+$/.test(word) ? Number(word) : (ENERGY_COUNT_WORDS[word] || 0);
    }
    return ' ';
  });
  rest = rest.replace(BARE_ENERGY_RE, (m: string) => {
    amount += countEnergySymbols(m);
    return ' ';
  });
  if (amount <= 0) return { amount: 0, remainingCost: String(cost || '') };
  const remainingCost = rest
    .split(',')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(', ');
  return { amount, remainingCost };
}

/**
 * Non-mana cost text left once the costs this path pays when the activation commits are removed
 * (life, sacrifice/exile this, counters removed from this, exert). Anything left needs its own
 * prompt, which does not carry energy yet.
 */
export function unsupportedEnergyCostCompanions(remainingCost: unknown): string {
  return String(remainingCost || '')
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
    .replace(/\bsacrifice\s+(?:~|this\b)[^,]*/gi, ' ')
    .replace(/\bexile\s+(?:~|this\b)[^,]*/gi, ' ')
    .replace(/\bremove\s+[^,]*?counters?\s+from\s+(?:~|this\b)[^,]*/gi, ' ')
    .replace(/\bexert\s+(?:this creature|~)\b/gi, ' ')
    .replace(/[\s,]+/g, ' ')
    .trim();
}

/** Pay energy the activation carried to commit time. Returns the amount paid (0 if short). */
export function payCommittedActivationEnergy(state: any, playerId: string, amount: unknown): number {
  const n = Math.max(0, Math.floor(Number(amount || 0)));
  if (!state || !playerId || n <= 0) return 0;
  const have = Number(state.energy?.[playerId] || 0);
  if (have < n) return 0;
  state.energy = state.energy || {};
  state.energy[playerId] = have - n;
  if (state.energyCount && typeof state.energyCount === 'object') state.energyCount[playerId] = state.energy[playerId];
  return n;
}
