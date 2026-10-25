/**
 * Repeatable mana-cost payments ("you may pay {1}{G} any number of times" /
 * "pay {G} up to three times. When you pay this cost one or more times, ...").
 * A repeat-cost payment unit is a full mana cost string such as "{1}{G}";
 * paying N means paying that cost N times from the mana pool.
 */
import { resolveManaCostForPoolPayment } from '../../socket/util-handlers/manaPoolCostPayment.js';
import { consumeManaFromPool } from '../../socket/util-handlers/consumeManaFromPool.js';

const SINGLE_UNITS = new Set(['{W}', '{U}', '{B}', '{R}', '{G}', '{C}']);
const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twice: 2 };
const REPEAT_CAP = 20;

export interface ReflexiveRepeatCostPayment {
  cost: string;
  maxTimes: number;
  followupText: string;
}

export function isRepeatCostPaymentUnit(unit: unknown): boolean {
  const u = String(unit || '').trim();
  if (!u || u === 'mana' || SINGLE_UNITS.has(u.toUpperCase())) return false;
  return /^(?:\{[^{}]+\})+$/.test(u);
}

export function parseReflexiveRepeatCostPayment(text: string): ReflexiveRepeatCostPayment | null {
  const normalized = String(text || '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
  const m = normalized.match(/\byou may pay ((?:\{[^{}]+\})+) (any number of times|up to (\w+) times)\.?\s*when you pay this cost one or more times,\s*(.+)$/i);
  if (!m) return null;
  let maxTimes = REPEAT_CAP;
  if (m[3]) {
    const w = String(m[3]).toLowerCase();
    const n = /^\d+$/.test(w) ? Number.parseInt(w, 10) : WORD_NUMBERS[w];
    if (!n || n <= 0) return null;
    maxTimes = Math.min(REPEAT_CAP, n);
  }
  const followupText = String(m[4] || '').trim();
  if (!followupText) return null;
  return { cost: String(m[1]).toUpperCase(), maxTimes, followupText };
}

/**
 * Trigger emitters that split oracle text at ". When ..." keep only "you may pay {X} up to N times";
 * re-attach the printed "When you pay this cost one or more times, ..." rider from the source's oracle text.
 */
export function withRepeatCostPaymentRider(description: string, oracleTexts: readonly unknown[]): string {
  const desc = String(description || '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  if (!desc || !/\byou may pay (?:\{[^{}]+\})+ (?:any number of times|up to \w+ times)$/i.test(desc)) return description;
  if (/when you pay this cost/i.test(desc)) return description;
  for (const raw of oracleTexts) {
    const text = String(raw || '').replace(/\u2019/g, "'").replace(/\s+/g, ' ');
    const i = text.toLowerCase().indexOf(desc.toLowerCase());
    if (i < 0) continue;
    const rider = /^\.?\s*(when you pay this cost one or more times,[^.]*)/i.exec(text.slice(i + desc.length));
    if (rider) return desc + '. ' + rider[1].replace(/\.\s*$/, '').trim() + '.';
  }
  return description;
}

function repeatCost(cost: string, times: number): string {
  let out = '';
  for (let i = 0; i < times; i++) out += cost;
  return out;
}

export function getMaxRepeatCostPaymentsFromPool(state: any, playerId: string, cost: string, cap: number = REPEAT_CAP): number {
  const pool = state?.manaPool?.[playerId] || {};
  let best = 0;
  for (let n = 1; n <= Math.max(0, Math.min(REPEAT_CAP, cap)); n++) {
    let ok = false;
    try { ok = !!(resolveManaCostForPoolPayment(pool, repeatCost(cost, n)) as any)?.ok; } catch { ok = false; }
    if (!ok) break;
    best = n;
  }
  return best;
}

export function consumeRepeatCostPaymentFromPool(state: any, playerId: string, cost: string, times: number): boolean {
  const n = Math.max(0, Math.floor(Number(times || 0)));
  if (n <= 0) return true;
  state.manaPool = state.manaPool || {};
  const pool = state.manaPool[playerId] = state.manaPool[playerId] || { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
  const resolved: any = resolveManaCostForPoolPayment(pool, repeatCost(cost, n));
  if (!resolved?.ok) return false;
  consumeManaFromPool(pool, resolved.coloredCost || {}, resolved.genericCost || 0);
  return true;
}

/** Replace "that many" / "twice that many" with the paid count. */
export function materializeThatManyCount(text: string, amount: number): string {
  const n = Math.max(0, Math.floor(Number(amount || 0)));
  return String(text || '')
    .replace(/\btwice that many\b/gi, String(n * 2))
    .replace(/\bthree times that many\b/gi, String(n * 3))
    .replace(/\bthat many\b/gi, String(n));
}
