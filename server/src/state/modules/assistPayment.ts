/**
 * Assist (CR 702.132): another player may pay up to N of the generic mana in this
 * spell's total cost. Minimal payment hook: a helper offers mana from their own pool,
 * which reduces the caster's remaining generic cost. Follows the manaPool shape
 * used elsewhere ({ white, blue, black, red, green, colorless }).
 */

const POOL_KEYS = ['colorless', 'white', 'blue', 'black', 'red', 'green'] as const;

export function hasAssist(oracleText: string): boolean {
  return /(?:^|\n)\s*assist\b/i.test(String(oracleText || ''));
}

/** Generic mana in a cost string like "{5}{G}" -> 5 ({X} counts as the chosen X). */
export function genericManaInCost(cost: string, xValue = 0): number {
  let total = 0;
  for (const m of String(cost || '').matchAll(/\{([^}]+)\}/g)) {
    const sym = m[1].toUpperCase();
    if (/^\d+$/.test(sym)) total += parseInt(sym, 10);
    else if (sym === 'X') total += Math.max(0, xValue);
  }
  return total;
}

/** Maximum an assisting player may pay: all generic mana in the total cost (CR 702.132a). */
export function maxAssistAmount(totalCost: string, xValue = 0): number {
  return genericManaInCost(totalCost, xValue);
}

function poolTotal(pool: any): number {
  return POOL_KEYS.reduce((n, k) => n + Math.max(0, Number(pool?.[k] || 0)), 0);
}

export interface AssistContributionResult {
  ok: boolean;
  paid: number;
  reason?: string;
}

/**
 * Apply an assisting player's contribution: removes `amount` mana (any type) from the
 * helper's pool and records it on the spell as `assistPaid` / `assistedBy`.
 */
export function applyAssistContribution(
  state: any,
  spell: any,
  casterId: string,
  helperId: string,
  amount: number,
  totalCost: string,
  xValue = 0,
): AssistContributionResult {
  if (!spell || !hasAssist(String(spell.oracle_text || spell.card?.oracle_text || ''))) {
    return { ok: false, paid: 0, reason: 'NO_ASSIST' };
  }
  if (!helperId || helperId === casterId) return { ok: false, paid: 0, reason: 'HELPER_MUST_BE_OTHER_PLAYER' };
  const already = Math.max(0, Number(spell.assistPaid || 0));
  const cap = maxAssistAmount(totalCost, xValue) - already;
  const want = Math.floor(Number(amount) || 0);
  if (want <= 0) return { ok: false, paid: 0, reason: 'INVALID_AMOUNT' };
  if (want > cap) return { ok: false, paid: 0, reason: 'EXCEEDS_GENERIC_COST' };
  const pool = state?.manaPool?.[helperId];
  if (!pool || poolTotal(pool) < want) return { ok: false, paid: 0, reason: 'INSUFFICIENT_MANA' };
  let left = want;
  for (const k of POOL_KEYS) {
    const have = Math.max(0, Number(pool[k] || 0));
    const take = Math.min(have, left);
    pool[k] = have - take;
    left -= take;
    if (!left) break;
  }
  spell.assistPaid = already + want;
  spell.assistedBy = helperId;
  return { ok: true, paid: want };
}

/** Caster's remaining cost after assist: strips assisted generic mana from the cost string. */
export function remainingCostAfterAssist(totalCost: string, assistPaid: number, xValue = 0): string {
  const generic = Math.max(0, genericManaInCost(totalCost, xValue) - Math.max(0, assistPaid));
  const colored = String(totalCost || '').replace(/\{(?:\d+|X)\}/gi, '');
  return `${generic > 0 ? `{${generic}}` : ''}${colored}` || '{0}';
}